import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

let _admin: ReturnType<typeof createClient<Database>> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

// ------------------------------------------------------------------
// BotConfig — the single source of truth for every text/emoji/button
// the Telegram bot renders. Stored in app_settings.key='bot_config'.
// ------------------------------------------------------------------

export type BotButton = {
  label: string;
  emoji: string;
  /** Optional Telegram Premium custom_emoji id. Any bot can send them;
   *  only Premium users see the animated variant. */
  premium_id?: string | null;
};

export type BotConfig = {
  welcome_text: string;
  welcome_footer: string;
  support_handle: string;
  admin_ids: number[];
  buttons: Record<string, BotButton>;
};

export const BUTTON_KEYS = [
  'shop', 'trending', 'orders', 'products',
  'coupons', 'profile', 'support', 'news',
] as const;
export type ButtonKey = typeof BUTTON_KEYS[number];

const DEFAULTS: BotConfig = {
  welcome_text:
    '💎 <b>Welcome to Mateo Store</b>{name_line}\n\n' +
    'Premium digital goods, delivered instantly.\n' +
    '⚡ Instant activation · 🔐 Secure payments · ⭐ Trusted licenses\n\n' +
    'Choose an option below to get started.',
  welcome_footer: '',
  support_handle: 'MateoSupport',
  admin_ids: [],
  buttons: {
    shop:     { label: 'Shop',          emoji: '🛒' },
    trending: { label: 'Trending',      emoji: '🔥' },
    orders:   { label: 'My Orders',     emoji: '📦' },
    products: { label: 'My Products',   emoji: '🔑' },
    coupons:  { label: 'Coupons',       emoji: '🎟' },
    profile:  { label: 'Profile',       emoji: '👤' },
    support:  { label: 'Support',       emoji: '💬' },
    news:     { label: 'Announcements', emoji: '📢' },
  },
};

export async function getBotConfig(): Promise<BotConfig> {
  const { data } = await admin()
    .from('app_settings').select('value').eq('key', 'bot_config').maybeSingle();
  const stored = (data?.value as Partial<BotConfig> | null) ?? {};
  return {
    ...DEFAULTS,
    ...stored,
    buttons: { ...DEFAULTS.buttons, ...(stored.buttons ?? {}) },
  };
}

export async function saveBotConfig(cfg: BotConfig): Promise<void> {
  await admin().from('app_settings').upsert(
    { key: 'bot_config', value: cfg as any, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

/** Render a button's emoji with premium/custom_emoji when available. */
export function renderEmoji(b: BotButton): string {
  if (b.premium_id) {
    return `<tg-emoji emoji-id="${b.premium_id}">${b.emoji}</tg-emoji>`;
  }
  return b.emoji;
}

export function renderButtonText(b: BotButton): string {
  // Inline keyboard button.text is plain text — Telegram does not parse HTML
  // inside button labels — so premium emoji tags cannot animate here. We still
  // ship the fallback glyph so the button reads correctly.
  return `${b.emoji} ${b.label}`;
}

// ------------------------------------------------------------------
// Per-admin "awaiting input" state — persisted in app_settings so it
// survives cold starts. Keyed by telegram_id.
// ------------------------------------------------------------------

export type AdminState =
  | { action: 'edit_welcome' }
  | { action: 'edit_footer' }
  | { action: 'edit_support' }
  | { action: 'edit_admins' }
  | { action: 'edit_btn_label'; key: ButtonKey }
  | { action: 'edit_btn_emoji'; key: ButtonKey }
  | { action: 'edit_btn_premium'; key: ButtonKey };

function stateKey(tg: number) { return `bot_state:${tg}`; }

export async function getAdminState(tg: number): Promise<AdminState | null> {
  const { data } = await admin()
    .from('app_settings').select('value').eq('key', stateKey(tg)).maybeSingle();
  return (data?.value as AdminState | null) ?? null;
}

export async function setAdminState(tg: number, s: AdminState): Promise<void> {
  await admin().from('app_settings').upsert(
    { key: stateKey(tg), value: s as any, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

export async function clearAdminState(tg: number): Promise<void> {
  await admin().from('app_settings').delete().eq('key', stateKey(tg));
}

export async function isAdmin(tg: number): Promise<boolean> {
  const cfg = await getBotConfig();
  return cfg.admin_ids.includes(tg);
}

/** Auto-promote the first user who runs /admin when there are no admins yet. */
export async function ensureFirstAdmin(tg: number): Promise<boolean> {
  const cfg = await getBotConfig();
  if (cfg.admin_ids.length === 0) {
    cfg.admin_ids = [tg];
    await saveBotConfig(cfg);
    return true;
  }
  return cfg.admin_ids.includes(tg);
}