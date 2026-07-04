const TG_API = 'https://api.telegram.org';

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return t;
}

async function call<T = any>(method: string, payload?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TG_API}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description || res.status}`);
  return json.result as T;
}

export type InlineButton = { text: string; callback_data?: string; url?: string };

/** Lazily apply the admin-configured emoji → custom_emoji_id map so any emoji
 *  that has a Premium ID is auto-wrapped in <tg-emoji> before we call Telegram.
 *  Only runs for HTML parse mode. Never throws — falls back to the raw text. */
async function withPremiumEmojis(text: string, parse_mode?: string): Promise<string> {
  if (parse_mode && parse_mode !== 'HTML') return text;
  try {
    const { getBotConfig, applyPremiumEmojis } = await import('./telegram-bot-config.server');
    const cfg = await getBotConfig();
    const buttonEmojiMap = Object.fromEntries(
      Object.values(cfg.buttons ?? {})
        .filter((button) => button?.emoji && button?.premium_id)
        .map((button) => [button.emoji, button.premium_id as string]),
    );
    return applyPremiumEmojis(text, { ...cfg.emoji_map, ...buttonEmojiMap });
  } catch {
    return text;
  }
}

export async function sendMessage(chat_id: number | string, text: string, opts: {
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: { inline_keyboard: InlineButton[][] };
  disable_web_page_preview?: boolean;
} = {}) {
  const parse_mode = opts.parse_mode ?? 'HTML';
  const rendered = await withPremiumEmojis(text, parse_mode);
  return call('sendMessage', { chat_id, text: rendered, parse_mode, ...opts });
}

export async function editMessageText(chat_id: number | string, message_id: number, text: string, opts: {
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: { inline_keyboard: InlineButton[][] };
  disable_web_page_preview?: boolean;
} = {}) {
  const parse_mode = opts.parse_mode ?? 'HTML';
  const rendered = await withPremiumEmojis(text, parse_mode);
  return call('editMessageText', { chat_id, message_id, text: rendered, parse_mode, ...opts });
}

export function answerCallbackQuery(callback_query_id: string, text?: string, show_alert = false) {
  return call('answerCallbackQuery', { callback_query_id, text, show_alert });
}

export function sendPhoto(chat_id: number | string, photo: string, caption?: string, opts: {
  reply_markup?: { inline_keyboard: InlineButton[][] };
  parse_mode?: 'HTML' | 'MarkdownV2';
} = {}) {
  return call('sendPhoto', { chat_id, photo, caption, parse_mode: opts.parse_mode ?? 'HTML', ...opts });
}

export function setWebhook(url: string, secret_token?: string) {
  return call('setWebhook', {
    url,
    secret_token,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

export function deleteWebhook() {
  return call('deleteWebhook', { drop_pending_updates: true });
}

export function getWebhookInfo() {
  return call('getWebhookInfo');
}

export function formatPrice(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export const EMOJI = {
  shop: '🛒', gem: '💎', trending: '🔥', gift: '🎁', star: '⭐',
  orders: '📦', key: '🔑', pay: '💳', coupon: '🎟', user: '👤',
  support: '💬', bell: '📢', settings: '⚙️', lock: '🔐', rocket: '🚀',
  bolt: '⚡', back: '↩️', check: '✅', cross: '❌', clock: '⏳',
};