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
  sendPhoto,
  deleteMessage,
  type InlineButton,
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
  const text = welcomeText(cfg, firstName);
  const reply_markup = { inline_keyboard: homeKeyboard(cfg) };
  if (cfg.welcome_image_url) {
    try {
      await sendPhoto(chat_id, cfg.welcome_image_url, text, { reply_markup });
      return;
    } catch (err) {
      console.error('welcome photo failed, falling back to text', err);
    }
  }
  await sendMessage(chat_id, text, { reply_markup });
}

// Splash is intentionally disabled in the webhook fast path. It used to wait
// 3 seconds before acknowledging Telegram, which made /start feel slow and can
// cause Telegram retries under load.
async function flashStartSplash(chat_id: number): Promise<void> {
  void chat_id;
}

// Best-effort cleanup of recent bot messages so /start opens a fresh chat.
// Telegram silently rejects deletes for messages the bot didn't send or that
// are older than 48h, so this is safe to fire across a range of ids.
async function clearRecentChat(chat_id: number, currentMessageId: number, depth = 30): Promise<void> {
  const ids: number[] = [];
  for (let i = 0; i <= depth; i++) {
    const id = currentMessageId - i;
    if (id > 0) ids.push(id);
  }
  await Promise.all(ids.map((id) => deleteMessage(chat_id, id).catch(() => {})));
}

async function ensureMenuInstalled(chat_id?: number): Promise<void> {
  // Keep the webhook response fast. Command/menu registration is not required
  // to answer messages and making these Telegram API calls on cold starts slows
  // the first user interaction.
  void chat_id;
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
  // Start the premium emoji popup immediately and keep the webhook alive until
  // its delete finishes, so the message reliably vanishes after the effect starts.
  const popupCleanup = flashShopPopup(chat_id);

  try {
    const { data: products } = await admin()
      .from('products')
      .select('id, slug, name, emoji, custom_emoji_id, short_description, price_cents, currency, featured')
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
            ...(p.custom_emoji_id ? { icon_custom_emoji_id: p.custom_emoji_id } : {}),
          }]),
          [{ text: `${EMOJI.back} Back`, callback_data: 'home' }],
        ],
      },
    });
  } finally {
    await popupCleanup;
  }
}

const SHOP_POPUP_EMOJI_ID = '5384508509385669657';
const SHOP_POPUP_FALLBACK = '✨';
const SHOP_POPUP_VISIBLE_MS = 3800;

async function flashShopPopup(chat_id: number) {
  try {
    const sent = await sendMessage(
      chat_id,
      `<tg-emoji emoji-id="${SHOP_POPUP_EMOJI_ID}">${SHOP_POPUP_FALLBACK}</tg-emoji>`,
    );
    const message_id = (sent as any)?.message_id;
    // Telegram stops the native premium effect when the source message is deleted,
    // so keep it visible long enough for the original animation to finish first.
    await new Promise((r) => setTimeout(r, SHOP_POPUP_VISIBLE_MS));
    if (message_id) await deleteMessage(chat_id, message_id);
  } catch (err) {
    console.error('shop popup failed', err);
  }
}

type BulkTier = { min: number; max: number | null; unitCents: number };

const DEFAULT_BULK_TIERS: BulkTier[] = [
  { min: 1, max: 9, unitCents: 110 },
  { min: 10, max: 19, unitCents: 100 },
  { min: 20, max: 49, unitCents: 90 },
  { min: 50, max: 99, unitCents: 80 },
  { min: 100, max: 199, unitCents: 70 },
  { min: 200, max: 299, unitCents: 65 },
  { min: 300, max: null, unitCents: 60 },
];

function sanitizeTiers(raw: any): BulkTier[] {
  if (!Array.isArray(raw)) return [];
  const out: BulkTier[] = [];
  for (const r of raw) {
    if (!r) continue;
    const min = Math.max(1, Math.floor(Number(r.min ?? 0)));
    const maxRaw = r.max;
    const max = maxRaw === null || maxRaw === undefined || maxRaw === '' ? null : Math.max(min, Math.floor(Number(maxRaw)));
    const unitCents = Math.max(0, Math.floor(Number(r.unitCents ?? r.unit_cents ?? 0)));
    if (min > 0) out.push({ min, max, unitCents });
  }
  return out.sort((a, b) => a.min - b.min);
}

function productBulkTiers(raw: any): BulkTier[] {
  const saved = sanitizeTiers(raw);
  return saved.length ? saved : DEFAULT_BULK_TIERS;
}

function unitPriceFor(qty: number, basePrice: number, tiers: BulkTier[]): { unit: number; tier: BulkTier | null } {
  for (const t of tiers) {
    if (qty >= t.min && (t.max === null || qty <= t.max)) return { unit: t.unitCents, tier: t };
  }
  return { unit: basePrice, tier: null };
}

async function productStock(productId: string): Promise<number> {
  const { count } = await admin().from('digital_assets')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId).eq('claimed', false);
  return count ?? 0;
}

async function renderProductCard(productId: string, qty: number) {
  const { data: p } = await admin()
    .from('products')
    .select('id, name, emoji, custom_emoji_id, description, short_description, price_cents, currency, image_url, bulk_tiers')
    .eq('id', productId).eq('active', true).maybeSingle();
  if (!p) return null;
  const anyP = p as any;
  const stock = await productStock(productId);
  const tiers = productBulkTiers(anyP.bulk_tiers);
  const maxSelectable = Math.max(1, Math.min(999, stock || 999));
  const cappedQty = Math.min(Math.max(1, qty), maxSelectable);
  const { unit, tier } = unitPriceFor(cappedQty, anyP.price_cents, tiers);
  const total = unit * cappedQty;
  const cur = anyP.currency as string;

  const pe = anyP.emoji as string | null;
  const pid = anyP.custom_emoji_id as string | null;
  const emojiHtml = pe ? (pid ? `<tg-emoji emoji-id="${pid}">${pe}</tg-emoji>` : pe) : EMOJI.gem;

  const lines: string[] = [
    `📦 ${emojiHtml} <b>${anyP.name}</b>`,
    ``,
  ];
  if (anyP.short_description) lines.push(`<i>${anyP.short_description}</i>`, '');
  if (anyP.description) lines.push(anyP.description, '');
  lines.push(
    `💰 <b>Price:</b> ${formatPrice(unit, cur)} each`,
    `📦 <b>In stock:</b> ${stock}`,
    ``,
    `🧮 <b>Selected Qty:</b> ${cappedQty}`,
    `✏️ <b>Total:</b> ${formatPrice(total, cur)}${tier ? `  <i>(bulk tier)</i>` : ''}`,
  );

  if (tiers.length > 0) {
    lines.push('', `🎁 <b>Bulk Discounts — Buy more, save more</b>`);
    const basePrice = anyP.price_cents as number;
    for (const t of tiers) {
      const range = t.max === null
        ? `Buy ${t.min}+ codes`
        : `Buy ${t.min}-${t.max} codes`;
      const active = cappedQty >= t.min && (t.max === null || cappedQty <= t.max);
      const savedPct = basePrice > 0 && t.unitCents < basePrice
        ? Math.round(((basePrice - t.unitCents) / basePrice) * 100)
        : 0;
      const savedLabel = savedPct > 0 ? `  <b>(-${savedPct}%)</b>` : '';
      lines.push(`${active ? '✅' : '▫️'} ${range} → <b>${formatPrice(t.unitCents, cur)}</b> each${savedLabel}`);
    }
    lines.push('', `<i>💡 Discount auto-applies at checkout based on quantity.</i>`);
  }

  const dec = Math.max(1, cappedQty - 1);
  const inc = Math.min(maxSelectable, cappedQty + 1);
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '➖', callback_data: `q:${productId}:${dec}` },
        { text: String(cappedQty), callback_data: `q:${productId}:${cappedQty}` },
        { text: '➕', callback_data: `q:${productId}:${inc}` },
      ],
      [{ text: '🔢 Custom Quantity', callback_data: `qc:${productId}` }],
      [{ text: `${EMOJI.pay} Buy Now · ${formatPrice(total, cur)}`, callback_data: `b:${productId}:${cappedQty}` }],
      [{ text: `${EMOJI.back} Back`, callback_data: 'shop' }],
    ],
  };
  return { text: lines.join('\n'), reply_markup, outOfStock: stock <= 0 };
}

async function sendProduct(chat_id: number, productId: string) {
  const card = await renderProductCard(productId, 1);
  if (!card) { await sendMessage(chat_id, `${EMOJI.cross} Product not available.`); return; }
  const { data: p } = await admin()
    .from('products')
    .select('image_url')
    .eq('id', productId)
    .maybeSingle();
  const imageUrl = (p as any)?.image_url as string | null | undefined;
  if (imageUrl) {
    try {
      // Telegram caption limit is 1024 chars; fall back to text-only if it overflows.
      if (card.text.length <= 1024) {
        await sendPhoto(chat_id, imageUrl, card.text, { reply_markup: card.reply_markup });
        return;
      }
      await sendPhoto(chat_id, imageUrl, '');
    } catch (err) {
      console.error('sendProduct photo failed, falling back to text:', err);
    }
  }
  await sendMessage(chat_id, card.text, { disable_web_page_preview: true, reply_markup: card.reply_markup });
}

// ────────────────────────────────────────────────────────────────
// Per-user "waiting for custom quantity" state
// ────────────────────────────────────────────────────────────────
function qtyKey(tg: number) { return `pending_qty:${tg}`; }

async function setPendingQty(tg: number, productId: string) {
  await admin().from('app_settings').upsert(
    { key: qtyKey(tg), value: { productId, at: Date.now() } as any, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}
async function getPendingQty(tg: number): Promise<{ productId: string } | null> {
  const { data } = await admin().from('app_settings').select('value').eq('key', qtyKey(tg)).maybeSingle();
  const v = data?.value as any;
  if (!v?.productId) return null;
  // Expire after 5 minutes
  if (v.at && Date.now() - v.at > 5 * 60 * 1000) {
    await clearPendingQty(tg);
    return null;
  }
  return { productId: v.productId };
}
async function clearPendingQty(tg: number) {
  await admin().from('app_settings').delete().eq('key', qtyKey(tg));
}

async function promptCustomQty(chat_id: number, tg: number, productId: string) {
  await setPendingQty(tg, productId);
  await sendMessage(chat_id, [
    '🔢 <b>Custom Quantity</b>',
    '',
    'Send the number of items you want to buy as your next message.',
    '',
    '<i>Example: 47</i>',
    '',
    'Send /cancel to abort.',
  ].join('\n'));
}

/** Returns true if the message was consumed as a pending-qty entry. */
async function handlePendingQty(chat_id: number, tg: number, text: string): Promise<boolean> {
  const pending = await getPendingQty(tg);
  if (!pending) return false;
  const trimmed = (text ?? '').trim();
  if (trimmed === '/cancel') {
    await clearPendingQty(tg);
    await sendMessage(chat_id, '❌ Cancelled.');
    return true;
  }
  const qty = parseInt(trimmed, 10);
  if (!Number.isFinite(qty) || qty < 1) {
    await sendMessage(chat_id, '❌ Please send a positive whole number (or /cancel).');
    return true;
  }
  await clearPendingQty(tg);
  const card = await renderProductCard(pending.productId, Math.min(qty, 9999));
  if (!card) { await sendMessage(chat_id, `${EMOJI.cross} Product not available.`); return true; }
  await sendMessage(chat_id, card.text, { disable_web_page_preview: true, reply_markup: card.reply_markup });
  return true;
}


async function updateProductQty(chat_id: number, message_id: number, productId: string, qty: number) {
  const card = await renderProductCard(productId, qty);
  if (!card) return;
  try {
    await editMessageText(chat_id, message_id, card.text, { disable_web_page_preview: true, reply_markup: card.reply_markup });
  } catch {
    // Card may have been sent as a photo (editMessageText fails on photo messages).
    // Silently ignore — quantity changes still work on the buttons themselves.
  }
}

async function startCheckout(chat_id: number, telegram_id: number, productId: string, qty = 1) {
  const { data: product } = await admin()
    .from('products')
    .select('id, name, price_cents, currency, bulk_tiers')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();
  if (!product) {
    await sendMessage(chat_id, `${EMOJI.cross} Product not available.`);
    return;
  }

  const p = product as any;
  const stock = await productStock(productId);
  const q = Math.max(1, Math.min(qty, Math.max(1, stock || 999)));
  if (stock > 0 && q > stock) {
    await sendMessage(chat_id, `${EMOJI.cross} Only ${stock} in stock.`);
    return;
  }
  const tiers = productBulkTiers(p.bulk_tiers);
  const { unit } = unitPriceFor(q, p.price_cents, tiers);
  const total = unit * q;
  const { data: order, error } = await admin()
    .from('orders')
    .insert({
      telegram_id, chat_id,
      status: 'pending',
      total_cents: total,
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
    quantity: q,
    unit_price_cents: unit,
    product_name_snapshot: p.name,
  });

  const payUrl = `${siteBase()}/pay/${(order as any).id}`;
  await sendMessage(chat_id, [
    `${EMOJI.lock} <b>Secure Checkout</b>`,
    ``,
    `<b>${p.name}</b> × ${q}`,
    `Unit: ${formatPrice(unit, p.currency)}`,
    `Total: <b>${formatPrice(total, p.currency)}</b>`,
    ``,
    `Tap below to complete your payment. Your license will be delivered here automatically.`,
  ].join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.pay} Pay ${formatPrice(total, p.currency)}`, url: payUrl }],
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
    const userUpsert = from
      ? upsertTelegramUser({ id: from.id, chat_id, ...from }).catch((err) => console.error('telegram user upsert failed', err))
      : Promise.resolve();

    const text: string = msg.text ?? '';

    // Admin input state takes priority so free-form values don't fall through
    // to /start.
    if (from && await handleAdminInputText(chat_id, from.id, msg)) return;
    if (from && await handlePendingQty(chat_id, from.id, text)) return;

    if (text.startsWith('/admin')) {
      await userUpsert;
      if (!from) return;
      const ok = await ensureFirstAdmin(from.id);
      if (!ok) {
        await sendMessage(chat_id, '⛔ You are not an admin.');
        return;
      }
      await sendAdminMenu(chat_id);
    } else if (text.startsWith('/start')) {
      // Clear previous bot messages (catalog, product cards, etc.) so /start
      // always opens a fresh chat instead of piling on top of old content.
      await clearRecentChat(chat_id, msg.message_id);
      // Send welcome menu first, then splash appears BELOW the menu for 3s.
      await sendHome(chat_id, from?.first_name);
      await flashStartSplash(chat_id);
    } else if (text.startsWith('/shop')) {
      await sendShop(chat_id);
    } else if (text.startsWith('/orders')) {
      await userUpsert;
      await sendOrders(chat_id, from.id);
    } else if (text.startsWith('/products')) {
      await userUpsert;
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
    const userUpsert = from && chat_id
      ? upsertTelegramUser({ id: from.id, chat_id, ...from }).catch((err) => console.error('telegram user upsert failed', err))
      : Promise.resolve();
    await answerCallbackQuery(cq.id).catch(() => {});

    // Navigation clicks replace the previous view instead of stacking a new
    // message in the chat. Skip for in-place edits (quantity picker) and
    // admin flows which manage their own message lifecycle.
    const prevMessageId = (cq as any).message?.message_id;
    const isInPlaceEdit = data.startsWith('q:') || data.startsWith('adm:');
    if (chat_id && prevMessageId && !isInPlaceEdit) {
      await deleteMessage(chat_id, prevMessageId);
    }

    try {
      if (data.startsWith('adm:')) {
        await userUpsert;
        await handleAdminCallback(chat_id, from.id, data);
      }
      if (data === 'home') await sendHome(chat_id, from?.first_name);
      else if (data === 'shop' || data === 'trending') await sendShop(chat_id);
      else if (data === 'orders') { await userUpsert; await sendOrders(chat_id, from.id); }
      else if (data === 'products') { await userUpsert; await sendMyProducts(chat_id, from.id); }
      else if (data === 'coupons') await sendMessage(chat_id, `${EMOJI.coupon} Coupons launching soon.`);
      else if (data === 'profile') await sendMessage(chat_id, `${EMOJI.user} <b>Profile</b>\n\nTelegram ID: <code>${from.id}</code>\nUsername: @${from.username ?? '—'}`);
      else if (data === 'support') {
        const cfg = await getBotConfig();
        await sendMessage(chat_id, `${EMOJI.support} Contact @${cfg.support_handle} for help.`);
      }
      else if (data === 'news') await sendMessage(chat_id, `${EMOJI.bell} No announcements yet.`);
      else if (data.startsWith('p:')) await sendProduct(chat_id, data.slice(2));
      else if (data.startsWith('buy:')) await startCheckout(chat_id, from.id, data.slice(4), 1);
      else if (data.startsWith('q:')) {
        const [, pid, n] = data.split(':');
        const message_id = (cq as any).message?.message_id;
        if (message_id && pid) await updateProductQty(chat_id, message_id, pid, Math.max(1, parseInt(n) || 1));
      }
      else if (data.startsWith('qc:')) {
        const pid = data.slice(3);
        if (pid && from) await promptCustomQty(chat_id, from.id, pid);
      }
      else if (data.startsWith('b:')) {
        const [, pid, n] = data.split(':');
        if (pid) await startCheckout(chat_id, from.id, pid, Math.max(1, parseInt(n) || 1));
      }
    } finally {}
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