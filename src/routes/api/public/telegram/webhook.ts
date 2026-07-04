import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { createHash, timingSafeEqual } from 'crypto';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  formatPrice,
  EMOJI,
  type InlineButton,
  deleteMessage,
  sendRawMessage,
} from '@/lib/telegram.server';
import {
  getBotConfig,
  saveBotConfig,
  renderEmoji,
  renderButtonText,
  isAdmin,
  ensureFirstAdmin,
  getAdminState,
  setAdminState,
  clearAdminState,
  BUTTON_KEYS,
  type ButtonKey,
  type BotConfig,
} from '@/lib/telegram-bot-config.server';

function deriveWebhookSecret(botToken: string): string {
  return createHash('sha256').update(`telegram-webhook:${botToken}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

let _admin: ReturnType<typeof createClient<Database>> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

function siteBase(): string {
  return process.env.SITE_URL
    ?? 'https://project--8d1bf028-91ae-4c3e-a101-f975bbf3c319-dev.lovable.app';
}

async function upsertTelegramUser(u: {
  id: number; chat_id: number; username?: string; first_name?: string; last_name?: string; language_code?: string;
}) {
  await admin().from('telegram_users').upsert(
    {
      telegram_id: u.id,
      chat_id: u.chat_id,
      username: u.username ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      language_code: u.language_code ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' },
  );
}

function homeKeyboard(cfg: BotConfig): InlineButton[][] {
  const b = cfg.buttons;
  const mk = (key: ButtonKey, cb: string): InlineButton => {
    const btn = b[key];
    const out: InlineButton = { text: renderButtonText(btn), callback_data: cb };
    if (btn?.style) out.style = btn.style;
    return out;
  };
  return [
    [mk('shop', 'shop'),         mk('trending', 'trending')],
    [mk('orders', 'orders'),     mk('products', 'products')],
    [mk('coupons', 'coupons'),   mk('profile', 'profile')],
    [mk('support', 'support'),   mk('news', 'news')],
  ];
}

function homeMenuPreviewText(cfg: BotConfig): string {
  const rows: ButtonKey[][] = [
    ['shop', 'trending'],
    ['orders', 'products'],
    ['coupons', 'profile'],
    ['support', 'news'],
  ];
  return rows
    .map((row) => row
      .map((key) => {
        const button = cfg.buttons[key];
        return `${renderEmoji(button)} ${escapeHtml(button.label)}`;
      })
      .join('  ·  '))
    .join('\n');
}

function welcomeText(cfg: BotConfig, firstName?: string): string {
  const name_line = firstName ? `, <b>${escapeHtml(firstName)}</b>` : '';
  let text = cfg.welcome_text.replace(/\{name_line\}/g, name_line).replace(/\{name\}/g, firstName ? escapeHtml(firstName) : '');
  if (cfg.welcome_footer) text += '\n\n' + cfg.welcome_footer;
  return text;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}

function firstCustomEmoji(text: string, entities?: Array<{ type: string; offset: number; length: number; custom_emoji_id?: string }>) {
  const htmlMatch = text.match(/<tg-emoji\s+emoji-id=["'](\d+)["'][^>]*>([\s\S]*?)<\/tg-emoji>/i);
  if (htmlMatch) return { emoji: htmlMatch[2], id: htmlMatch[1] };
  const entity = entities?.find((item) => item.type === 'custom_emoji' && item.custom_emoji_id);
  if (!entity) return null;
  return {
    emoji: text.slice(entity.offset, entity.offset + entity.length),
    id: entity.custom_emoji_id!,
  };
}

async function sendHome(chat_id: number, firstName?: string) {
  const cfg = await getBotConfig();
  await sendMessage(chat_id, welcomeText(cfg, firstName), {
    reply_markup: { inline_keyboard: homeKeyboard(cfg) },
  });
}

const START_SPLASH_EMOJI_ID = '5384145649073663083';

// Fire-and-forget splash: sends the premium emoji, schedules its deletion
// after a short delay in the background, and returns immediately so the
// welcome message can be sent right after with no perceptible lag.
async function flashStartSplash(chat_id: number): Promise<void> {
  try {
    const stateKey = `start_splash:${chat_id}`;
    const { data: previous } = await admin()
      .from('app_settings')
      .select('value')
      .eq('key', stateKey)
      .maybeSingle();
    const previousId = Number((previous?.value as any)?.message_id ?? 0);
    if (previousId) deleteMessage(chat_id, previousId).catch(() => {});

    const sent: any = await sendRawMessage(chat_id, `<tg-emoji emoji-id="${START_SPLASH_EMOJI_ID}">✨</tg-emoji>`);
    if (!sent?.message_id) return;
    await admin().from('app_settings').upsert(
      { key: stateKey, value: { message_id: sent.message_id } as any, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    await new Promise((r) => setTimeout(r, 250));
    await deleteMessage(chat_id, sent.message_id).catch(() => null);
    await admin().from('app_settings').delete().eq('key', stateKey).catch(() => null as any);
  } catch {
    // Decorative only — never block /start.
  }
}

// ────────────────────────────────────────────────────────────────
// In-bot admin panel
// ────────────────────────────────────────────────────────────────

function adminMenuKeyboard(): InlineButton[][] {
  return [
    [{ text: '✏️ Welcome text',   callback_data: 'adm:edit:welcome' }],
    [{ text: '📝 Welcome footer', callback_data: 'adm:edit:footer' }],
    [{ text: '🔘 Buttons & emojis', callback_data: 'adm:btns' }],
    [{ text: '💎 Premium emoji map', callback_data: 'adm:emap' }],
    [{ text: '💬 Support handle', callback_data: 'adm:edit:support' }],
    [{ text: '👥 Admins',         callback_data: 'adm:edit:admins' }],
    [{ text: '👁 Preview /start', callback_data: 'adm:preview' }],
    [{ text: '❌ Close',          callback_data: 'adm:close' }],
  ];
}

function adminButtonsKeyboard(cfg: BotConfig): InlineButton[][] {
  const rows: InlineButton[][] = BUTTON_KEYS.map((k) => ([{
    text: `${cfg.buttons[k].emoji} ${cfg.buttons[k].label}`,
    callback_data: `adm:btn:${k}`,
  }]));
  rows.push([{ text: '↩️ Back', callback_data: 'adm:menu' }]);
  return rows;
}

function adminButtonEditKeyboard(k: ButtonKey): InlineButton[][] {
  return [
    [{ text: '✏️ Edit label',  callback_data: `adm:be:${k}:label` }],
    [{ text: '😀 Edit emoji',  callback_data: `adm:be:${k}:emoji` }],
    [{ text: '💎 Set Premium emoji', callback_data: `adm:be:${k}:premium` }],
    [{ text: '🗑 Clear Premium emoji',  callback_data: `adm:be:${k}:clearpremium` }],
    [{ text: '↩️ Back', callback_data: 'adm:btns' }],
  ];
}

async function sendAdminMenu(chat_id: number) {
  await sendMessage(chat_id,
    '⚙️ <b>Bot Admin Panel</b>\n\nChoose what you want to edit. Every change is live immediately for all users.',
    { reply_markup: { inline_keyboard: adminMenuKeyboard() } },
  );
}

async function sendAdminButtons(chat_id: number) {
  const cfg = await getBotConfig();
  await sendMessage(chat_id,
    '🔘 <b>Buttons</b>\n\nTap a button to change its label, emoji, or Premium emoji ID.',
    { reply_markup: { inline_keyboard: adminButtonsKeyboard(cfg) } },
  );
}

async function sendAdminButtonEdit(chat_id: number, k: ButtonKey) {
  const cfg = await getBotConfig();
  const b = cfg.buttons[k];
  const premium = b.premium_id ? `<code>${b.premium_id}</code>` : '<i>none</i>';
  await sendMessage(chat_id,
    [
      `🔘 <b>${escapeHtml(b.label)}</b>`,
      ``,
      `Emoji preview: ${renderEmoji(b)}`,
      `Premium emoji: ${premium}`,
      ``,
      `<i>Premium emoji IDs are sent as Telegram's button icon field on supported clients. The plain emoji stays as a fallback.</i>`,
    ].join('\n'),
    { reply_markup: { inline_keyboard: adminButtonEditKeyboard(k) } },
  );
}

async function sendAdminEmojiMap(chat_id: number) {
  const cfg = await getBotConfig();
  const entries = Object.entries(cfg.emoji_map);
  const rows: InlineButton[][] = entries.map(([emoji, id]) => ([
    { text: `${emoji} → …${id.slice(-6)}`, callback_data: `adm:emap:rm:${encodeURIComponent(emoji)}` },
  ]));
  rows.push([{ text: '➕ Add mapping', callback_data: 'adm:emap:add' }]);
  rows.push([{ text: '↩️ Back', callback_data: 'adm:menu' }]);
  const list = entries.length
    ? entries.map(([e, id]) => `• ${e} → <code>${id}</code>`).join('\n')
    : '<i>No mappings yet.</i>';
  await sendMessage(chat_id,
    [
      '💎 <b>Premium emoji map</b>',
      '',
      'Every mapped emoji is auto-replaced with its Telegram Premium animated version in <b>all bot messages</b> (welcome text, orders, catalog, everything).',
      '',
      '<b>Current mappings:</b>',
      list,
      '',
      '<i>Send the Premium emoji itself when adding a mapping. The bot captures its value automatically. Tap a row to remove it.</i>',
    ].join('\n'),
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function promptFor(chat_id: number, tg: number, action: any, prompt: string) {
  await setAdminState(tg, action);
  await sendMessage(chat_id, prompt + '\n\nSend the new value as your next message, or /cancel to abort.');
}

async function handleAdminCallback(chat_id: number, tg: number, data: string): Promise<boolean> {
  if (!data.startsWith('adm:')) return false;
  if (!(await isAdmin(tg))) return true; // silently ignore

  const parts = data.split(':');
  const op = parts[1];

  if (op === 'menu') { await sendAdminMenu(chat_id); return true; }
  if (op === 'btns') { await sendAdminButtons(chat_id); return true; }
  if (op === 'close') { await sendMessage(chat_id, '✅ Admin panel closed.'); return true; }
  if (op === 'preview') { await sendHome(chat_id, 'Preview'); return true; }

  if (op === 'emap') {
    const sub = parts[2];
    if (!sub) { await sendAdminEmojiMap(chat_id); return true; }
    if (sub === 'add') {
      await promptFor(chat_id, tg, { action: 'add_emoji_map' },
        '➕ <b>Add premium emoji mapping</b>\n\nSend the <b>Premium emoji itself</b>. Do not send an ID. The bot will read the emoji ID automatically.');
      return true;
    }
    if (sub === 'rm') {
      const emoji = decodeURIComponent(parts.slice(3).join(':'));
      const cfg = await getBotConfig();
      if (cfg.emoji_map[emoji]) {
        delete cfg.emoji_map[emoji];
        await saveBotConfig(cfg);
      }
      await sendMessage(chat_id, `🗑 Removed mapping for ${emoji}.`);
      await sendAdminEmojiMap(chat_id);
      return true;
    }
  }

  if (op === 'edit') {
    const target = parts[2];
    if (target === 'welcome') {
      const cfg = await getBotConfig();
      await promptFor(chat_id, tg, { action: 'edit_welcome' },
        `✏️ <b>Welcome text</b>\n\nCurrent:\n<code>${escapeHtml(cfg.welcome_text)}</code>\n\nUse HTML tags. Placeholder <code>{name_line}</code> inserts <i>, First Name</i>. Plain emojis from your Premium emoji map will auto-render as Premium emojis.`);
    } else if (target === 'footer') {
      const cfg = await getBotConfig();
      await promptFor(chat_id, tg, { action: 'edit_footer' },
        `📝 <b>Welcome footer</b>\n\nCurrent:\n<code>${escapeHtml(cfg.welcome_footer || '(empty)')}</code>\n\nSend "-" to clear.`);
    } else if (target === 'support') {
      const cfg = await getBotConfig();
      await promptFor(chat_id, tg, { action: 'edit_support' },
        `💬 <b>Support handle</b>\n\nCurrent: @${cfg.support_handle}\n\nSend the new username without @.`);
    } else if (target === 'admins') {
      const cfg = await getBotConfig();
      await promptFor(chat_id, tg, { action: 'edit_admins' },
        `👥 <b>Admins</b>\n\nCurrent IDs: <code>${cfg.admin_ids.join(', ')}</code>\n\nSend a comma-separated list of Telegram numeric IDs. You must include your own (${tg}) to keep access.`);
    }
    return true;
  }

  if (op === 'btn') {
    const k = parts[2] as ButtonKey;
    if (BUTTON_KEYS.includes(k)) await sendAdminButtonEdit(chat_id, k);
    return true;
  }

  if (op === 'be') {
    const k = parts[2] as ButtonKey;
    const kind = parts[3];
    if (!BUTTON_KEYS.includes(k)) return true;
    if (kind === 'label') {
      await promptFor(chat_id, tg, { action: 'edit_btn_label', key: k },
        `✏️ Send the new <b>label</b> for the "${k}" button.`);
    } else if (kind === 'emoji') {
      await promptFor(chat_id, tg, { action: 'edit_btn_emoji', key: k },
        `😀 Send the new <b>emoji</b> for the "${k}" button (one emoji character).`);
    } else if (kind === 'premium') {
      await promptFor(chat_id, tg, { action: 'edit_btn_premium', key: k },
        `💎 Send the <b>Premium emoji itself</b> for the "${k}" button. Do not send an ID — paste/send the animated emoji here.`);
    } else if (kind === 'clearpremium') {
      const cfg = await getBotConfig();
      cfg.buttons[k].premium_id = null;
      await saveBotConfig(cfg);
      await sendMessage(chat_id, `🗑 Premium emoji cleared for "${k}".`);
      await sendAdminButtonEdit(chat_id, k);
    }
    return true;
  }

  return true;
}

/** Returns true if the message consumed an admin-input state. */
async function handleAdminInputText(chat_id: number, tg: number, msg: any): Promise<boolean> {
  const state = await getAdminState(tg);
  if (!state) return false;
  const text: string = msg.text ?? '';
  if (text.trim() === '/cancel') {
    await clearAdminState(tg);
    await sendMessage(chat_id, '❌ Cancelled.');
    return true;
  }
  const cfg = await getBotConfig();
  try {
    switch (state.action) {
      case 'edit_welcome': cfg.welcome_text = text; break;
      case 'edit_footer':  cfg.welcome_footer = text.trim() === '-' ? '' : text; break;
      case 'edit_support': cfg.support_handle = text.trim().replace(/^@/, ''); break;
      case 'edit_admins': {
        const ids = text.split(/[,\s]+/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
        if (!ids.includes(tg)) throw new Error(`You must include your own ID (${tg}).`);
        cfg.admin_ids = ids;
        break;
      }
      case 'edit_btn_label': cfg.buttons[state.key].label = text.trim().slice(0, 32); break;
      case 'edit_btn_emoji': {
        const custom = firstCustomEmoji(text, msg.entities);
        cfg.buttons[state.key].emoji = (custom?.emoji ?? text.trim()).slice(0, 8);
        if (custom?.id) cfg.buttons[state.key].premium_id = custom.id;
        break;
      }
      case 'edit_btn_premium': {
        const custom = firstCustomEmoji(text, msg.entities);
        if (!custom) throw new Error('Premium emoji send karo, ID nahi. Telegram ke emoji panel se animated premium emoji bhejo.');
        cfg.buttons[state.key].emoji = custom.emoji;
        cfg.buttons[state.key].premium_id = custom.id;
        break;
      }
      case 'add_emoji_map': {
        const custom = firstCustomEmoji(text, msg.entities);
        if (!custom) throw new Error('Premium emoji send karo, ID nahi. Telegram ke emoji panel se animated premium emoji bhejo.');
        cfg.emoji_map = { ...(cfg.emoji_map ?? {}), [custom.emoji]: custom.id };
        break;
      }
    }
    await saveBotConfig(cfg);
    await clearAdminState(tg);
    await sendMessage(chat_id, '✅ Saved. Here is a live preview:');
    if (state.action.startsWith('edit_btn')) {
      await sendAdminButtonEdit(chat_id, (state as any).key);
    } else if (state.action === 'add_emoji_map') {
      await sendAdminEmojiMap(chat_id);
    } else {
      await sendHome(chat_id, 'Preview');
      await sendAdminMenu(chat_id);
    }
  } catch (err: any) {
    await sendMessage(chat_id, `❌ ${escapeHtml(err.message ?? String(err))}\n\nStill waiting — send a valid value or /cancel.`);
  }
  return true;
}

async function sendShop(chat_id: number) {
  const { data: products } = await admin()
    .from('products')
    .select('id, slug, name, emoji, short_description, price_cents, currency, featured')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  if (!products?.length) {
    await sendMessage(chat_id, `${EMOJI.clock} <b>The catalog is empty.</b>\nOur team is preparing something premium — check back soon.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Back`, callback_data: 'home' }]] },
    });
    return;
  }

  await sendMessage(chat_id, `${EMOJI.shop} <b>Mateo Store · Catalog</b>\nSelect a product to view details.`, {
    reply_markup: {
      inline_keyboard: [
        ...products.map((p: any) => [{
          text: `${p.featured ? EMOJI.star + ' ' : ''}${p.emoji ? p.emoji + ' ' : ''}${p.name}  ·  ${formatPrice(p.price_cents, p.currency)}`,
          callback_data: `p:${p.id}`,
        }]),
        [{ text: `${EMOJI.back} Back`, callback_data: 'home' }],
      ],
    },
  });
}

async function sendProduct(chat_id: number, productId: string) {
  const { data: p } = await admin()
    .from('products')
    .select('id, name, emoji, custom_emoji_id, description, short_description, price_cents, currency, image_url')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();

  if (!p) {
    await sendMessage(chat_id, `${EMOJI.cross} Product not available.`);
    return;
  }

  const price = formatPrice((p as any).price_cents, (p as any).currency);
  const pe = (p as any).emoji as string | null;
  const pid = (p as any).custom_emoji_id as string | null;
  const emojiHtml = pe
    ? (pid ? `<tg-emoji emoji-id="${pid}">${pe}</tg-emoji>` : pe)
    : EMOJI.gem;
  const text = [
    `${emojiHtml} <b>${(p as any).name}</b>`,
    ``,
    (p as any).short_description ? `<i>${(p as any).short_description}</i>\n` : '',
    (p as any).description ?? '',
    ``,
    `<b>Price:</b> ${price}`,
  ].filter(Boolean).join('\n');

  await sendMessage(chat_id, text, {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.pay} Buy · ${price}`, callback_data: `buy:${(p as any).id}` }],
        [{ text: `${EMOJI.back} Back to Shop`, callback_data: 'shop' }],
      ],
    },
  });
}

async function startCheckout(chat_id: number, telegram_id: number, productId: string) {
  const { data: product } = await admin()
    .from('products')
    .select('id, name, price_cents, currency')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();
  if (!product) {
    await sendMessage(chat_id, `${EMOJI.cross} Product not available.`);
    return;
  }

  const p = product as any;
  const { data: order, error } = await admin()
    .from('orders')
    .insert({
      telegram_id, chat_id,
      status: 'pending',
      total_cents: p.price_cents,
      currency: p.currency,
    })
    .select('id')
    .single();
  if (error || !order) {
    await sendMessage(chat_id, `${EMOJI.cross} Could not create order. Please try again.`);
    return;
  }
  await admin().from('order_items').insert({
    order_id: (order as any).id,
    product_id: p.id,
    quantity: 1,
    unit_price_cents: p.price_cents,
    product_name_snapshot: p.name,
  });

  const payUrl = `${siteBase()}/pay/${(order as any).id}`;
  await sendMessage(chat_id, [
    `${EMOJI.lock} <b>Secure Checkout</b>`,
    ``,
    `<b>${p.name}</b>`,
    `Total: <b>${formatPrice(p.price_cents, p.currency)}</b>`,
    ``,
    `Tap below to complete your payment. Your license will be delivered here automatically.`,
  ].join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.pay} Pay ${formatPrice(p.price_cents, p.currency)}`, url: payUrl }],
        [{ text: `${EMOJI.back} Cancel`, callback_data: 'shop' }],
      ],
    },
  });
}

async function sendOrders(chat_id: number, telegram_id: number) {
  const { data: orders } = await admin()
    .from('orders')
    .select('id, status, total_cents, currency, created_at')
    .eq('telegram_id', telegram_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!orders?.length) {
    await sendMessage(chat_id, `${EMOJI.orders} You have no orders yet.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.shop} Browse Shop`, callback_data: 'shop' }]] },
    });
    return;
  }

  const lines = orders.map((o: any) => {
    const status = o.status === 'delivered' ? EMOJI.check
      : o.status === 'paid' ? EMOJI.bolt
      : o.status === 'pending' ? EMOJI.clock
      : EMOJI.cross;
    const date = new Date(o.created_at).toLocaleDateString();
    return `${status}  ${formatPrice(o.total_cents, o.currency)}  ·  <code>${String(o.id).slice(0, 8)}</code>  ·  ${date}`;
  });

  await sendMessage(chat_id, `${EMOJI.orders} <b>Your Orders</b>\n\n${lines.join('\n')}`, {
    reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Home`, callback_data: 'home' }]] },
  });
}

async function sendMyProducts(chat_id: number, telegram_id: number) {
  const { data: deliveries } = await admin()
    .from('deliveries')
    .select('id, payload_snapshot, delivered_at, products(name), orders!inner(telegram_id)')
    .eq('orders.telegram_id', telegram_id)
    .order('delivered_at', { ascending: false })
    .limit(20);

  if (!deliveries?.length) {
    await sendMessage(chat_id, `${EMOJI.key} You have no delivered products yet.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.shop} Browse Shop`, callback_data: 'shop' }]] },
    });
    return;
  }

  const text = [
    `${EMOJI.key} <b>My Products</b>`,
    ``,
    ...deliveries.map((d: any) =>
      `${EMOJI.gem} <b>${d.products?.name ?? 'Product'}</b>\n<code>${d.payload_snapshot}</code>`,
    ),
  ].join('\n\n');

  await sendMessage(chat_id, text, {
    reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Home`, callback_data: 'home' }]] },
  });
}

async function handleUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    const chat_id = msg.chat.id;
    const from = msg.from;
    if (from) await upsertTelegramUser({ id: from.id, chat_id, ...from });

    const text: string = msg.text ?? '';

    // Admin input state takes priority so free-form values don't fall through
    // to /start.
    if (from && await handleAdminInputText(chat_id, from.id, msg)) return;

    if (text.startsWith('/admin')) {
      if (!from) return;
      const ok = await ensureFirstAdmin(from.id);
      if (!ok) {
        await sendMessage(chat_id, '⛔ You are not an admin.');
        return;
      }
      await sendAdminMenu(chat_id);
    } else if (text.startsWith('/start')) {
      // Kick off splash and welcome in parallel so the user sees the home
      // menu instantly instead of waiting on the decorative emoji.
      await Promise.all([
        flashStartSplash(chat_id),
        sendHome(chat_id, from?.first_name),
      ]);
    } else if (text.startsWith('/shop')) {
      await sendShop(chat_id);
    } else if (text.startsWith('/orders')) {
      await sendOrders(chat_id, from.id);
    } else if (text.startsWith('/products')) {
      await sendMyProducts(chat_id, from.id);
    } else if (text.startsWith('/help')) {
      await sendMessage(chat_id, [
        `${EMOJI.gem} <b>Mateo Store · Commands</b>`,
        `/start — Home`,
        `/shop — Browse products`,
        `/orders — Your orders`,
        `/products — Delivered licenses`,
        `/admin — Bot admin panel (admins only)`,
      ].join('\n'));
    } else {
      await sendHome(chat_id, from?.first_name);
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chat_id = cq.message?.chat?.id;
    const from = cq.from;
    const data: string = cq.data ?? '';
    if (from && chat_id) await upsertTelegramUser({ id: from.id, chat_id, ...from });

    try {
      if (data.startsWith('adm:')) {
        await handleAdminCallback(chat_id, from.id, data);
      }
      if (data === 'home') await sendHome(chat_id, from?.first_name);
      else if (data === 'shop' || data === 'trending') await sendShop(chat_id);
      else if (data === 'orders') await sendOrders(chat_id, from.id);
      else if (data === 'products') await sendMyProducts(chat_id, from.id);
      else if (data === 'coupons') await sendMessage(chat_id, `${EMOJI.coupon} Coupons launching soon.`);
      else if (data === 'profile') await sendMessage(chat_id, `${EMOJI.user} <b>Profile</b>\n\nTelegram ID: <code>${from.id}</code>\nUsername: @${from.username ?? '—'}`);
      else if (data === 'support') {
        const cfg = await getBotConfig();
        await sendMessage(chat_id, `${EMOJI.support} Contact @${cfg.support_handle} for help.`);
      }
      else if (data === 'news') await sendMessage(chat_id, `${EMOJI.bell} No announcements yet.`);
      else if (data.startsWith('p:')) await sendProduct(chat_id, data.slice(2));
      else if (data.startsWith('buy:')) await startCheckout(chat_id, from.id, data.slice(4));
    } finally {
      await answerCallbackQuery(cq.id).catch(() => {});
    }
    return;
  }
}

export const Route = createFileRoute('/api/public/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return new Response('Not configured', { status: 500 });
        const expected = deriveWebhookSecret(botToken);
        const actual = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
        if (!safeEqual(actual, expected)) {
          return new Response('Unauthorized', { status: 401 });
        }

        const update = await request.json();
        // Always ack fast; don't let Telegram retry on internal errors.
        try { await handleUpdate(update); }
        catch (err) { console.error('telegram handler error', err); }
        return Response.json({ ok: true });
      },
    },
  },
});