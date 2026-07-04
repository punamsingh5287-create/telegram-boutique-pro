import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { sendMessage } from '@/lib/telegram.server';

let _admin: ReturnType<typeof createClient<Database>> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

export type FakeBroadcastConfig = {
  enabled: boolean;
  names: string[];
  templates: string[];
  maxRecipients: number;
};

export const FAKE_DEFAULTS: FakeBroadcastConfig = {
  enabled: false,
  names: [
    'Rahul', 'Priya', 'Aman', 'Neha', 'Vikram', 'Ananya', 'Rohan', 'Sneha',
    'Karan', 'Pooja', 'Arjun', 'Ishita', 'Siddharth', 'Kavya', 'Aditya', 'Meera',
    'Alex', 'Sara', 'Chris', 'Emma', 'Daniel', 'Sophia', 'Michael', 'Olivia',
  ],
  templates: [
    '🔥 <b>{name}</b> just purchased <b>{product}</b>!',
    '⚡ New sale! <b>{name}</b> got <b>{product}</b> for {price}',
    '🎉 <b>{name}</b> unlocked <b>{product}</b> — join {count}+ happy customers',
    '💎 <b>{product}</b> is trending! <b>{name}</b> just grabbed one',
    '✨ Order confirmed for <b>{name}</b> · <b>{product}</b> ({price})',
  ],
  maxRecipients: 500,
};

export async function getFakeBroadcastConfig(): Promise<FakeBroadcastConfig> {
  const { data } = await admin().from('app_settings').select('value').eq('key', 'fake_broadcast').maybeSingle();
  const stored = (data?.value as Partial<FakeBroadcastConfig> | null) ?? {};
  return {
    ...FAKE_DEFAULTS,
    ...stored,
    names: stored.names?.length ? stored.names : FAKE_DEFAULTS.names,
    templates: stored.templates?.length ? stored.templates : FAKE_DEFAULTS.templates,
  };
}

export async function saveFakeBroadcastConfig(cfg: FakeBroadcastConfig): Promise<void> {
  await admin().from('app_settings').upsert(
    { key: 'fake_broadcast', value: cfg as any, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmtPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export async function runFakeBroadcast(): Promise<{ ok: boolean; sent: number; failed: number; skipped?: string }> {
  const cfg = await getFakeBroadcastConfig();
  if (!cfg.enabled) return { ok: true, sent: 0, failed: 0, skipped: 'disabled' };

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, sent: 0, failed: 0, skipped: 'telegram not configured' };
  }

  const { data: products } = await admin()
    .from('products')
    .select('name, emoji, custom_emoji_id, price_cents, currency')
    .eq('active', true)
    .limit(50);
  if (!products?.length) return { ok: true, sent: 0, failed: 0, skipped: 'no products' };

  const { data: users } = await admin()
    .from('telegram_users')
    .select('chat_id')
    .not('chat_id', 'is', null)
    .limit(cfg.maxRecipients);
  const chatIds = Array.from(new Set((users ?? []).map((u: any) => u.chat_id).filter(Boolean)));
  if (chatIds.length === 0) return { ok: true, sent: 0, failed: 0, skipped: 'no users' };

  // Totals for "join N+ happy customers"
  const { count: paidCount } = await admin()
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['paid', 'delivered']);
  const socialCount = Math.max(50, (paidCount ?? 0) + Math.floor(Math.random() * 500) + 100);

  const product = pick(products as any[]);
  const name = pick(cfg.names);
  const template = pick(cfg.templates);
  const productLabel = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">${product.emoji || '💎'}</tg-emoji> ${product.name}`
    : `${product.emoji ? product.emoji + ' ' : ''}${product.name}`;

  const text = template
    .replaceAll('{name}', name)
    .replaceAll('{product}', productLabel)
    .replaceAll('{price}', fmtPrice(product.price_cents, product.currency))
    .replaceAll('{count}', String(socialCount));

  let sent = 0;
  let failed = 0;
  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      sent++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  await admin().from('broadcasts').insert({
    message: text,
    target: 'all',
    status: failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'sent',
    sent_count: sent,
    failed_count: failed,
    sent_at: new Date().toISOString(),
  } as any);

  return { ok: true, sent, failed };
}