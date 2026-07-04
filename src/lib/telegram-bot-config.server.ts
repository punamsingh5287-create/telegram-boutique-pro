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
  /** Bot API 9.4+: colored button style — "primary" (blue),
   *  "success" (green), or "danger" (red). Undefined = default. */
  style?: 'primary' | 'success' | 'danger' | null;
};

export type BotConfig = {
  welcome_text: string;
  welcome_footer: string;
  support_handle: string;
  admin_ids: number[];
  buttons: Record<string, BotButton>;
  /** Emoji → Telegram Premium custom_emoji_id. Applied automatically to every
   *  HTML message the bot sends: each occurrence of the emoji is wrapped with
   *  <tg-emoji emoji-id="..."> so all users see the premium/animated variant
   *  (requires the bot owner account to have Telegram Premium — Bot API 9.4). */
  emoji_map: Record<string, string>;
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
    shop:     { label: 'Shop',          emoji: '🛒', style: 'primary' },
    trending: { label: 'Trending',      emoji: '🔥', style: 'danger'  },
    orders:   { label: 'My Orders',     emoji: '📦', style: 'primary' },
    products: { label: 'My Products',   emoji: '🔑', style: 'success' },
    coupons:  { label: 'Coupons',       emoji: '🎟', style: 'success' },
    profile:  { label: 'Profile',       emoji: '👤', style: 'primary' },
    support:  { label: 'Support',       emoji: '💬', style: 'success' },
    news:     { label: 'Announcements', emoji: '📢', style: 'danger'  },
  },
  emoji_map: {},
};

function mergeButtons(storedButtons?: Partial<Record<string, Partial<BotButton>>>): Record<string, BotButton> {
  const merged: Record<string, BotButton> = { ...DEFAULTS.buttons };
  for (const key of BUTTON_KEYS) {
    merged[key] = {
      ...DEFAULTS.buttons[key],
      ...(storedButtons?.[key] ?? {}),
    };
  }
  return merged;
}

// Short in-memory cache so a single webhook request that sends 1–3 messages
// doesn't fetch bot_config from Postgres 4+ times (each sendMessage previously
// hit it twice — once for text, once for keyboard). This alone removes the
// dominant source of bot latency on hot workers.
const CFG_TTL_MS = 30_000;
let _cfgCache: { at: number; value: BotConfig } | null = null;

export async function getBotConfig(): Promise<BotConfig> {
  const now = Date.now();
  if (_cfgCache && now - _cfgCache.at < CFG_TTL_MS) return _cfgCache.value;
  const { data } = await admin()
    .from('app_settings').select('value').eq('key', 'bot_config').maybeSingle();
  const stored = (data?.value as Partial<BotConfig> | null) ?? {};
  const value: BotConfig = {
    ...DEFAULTS,
    ...stored,
    buttons: mergeButtons(stored.buttons),
    emoji_map: { ...DEFAULTS.emoji_map, ...(stored.emoji_map ?? {}) },
  };
  _cfgCache = { at: now, value };
  return value;
}

export async function saveBotConfig(cfg: BotConfig): Promise<void> {
  await admin().from('app_settings').upsert(
    { key: 'bot_config', value: cfg as any, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  // Invalidate cache so admin edits go live immediately.
  _cfgCache = { at: Date.now(), value: cfg };
}

/** Render a button's emoji with premium/custom_emoji when available. */
export function renderEmoji(b: BotButton): string {
  if (b.premium_id) {
    return `<tg-emoji emoji-id="${b.premium_id}">${b.emoji}</tg-emoji>`;
  }
  return b.emoji;
}

export function renderButtonText(b: BotButton): string {
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
  | { action: 'edit_btn_premium'; key: ButtonKey }
  | { action: 'add_emoji_map' };

/**
 * Rewrites `text` so every emoji that has a mapped custom_emoji_id gets
 * wrapped in a <tg-emoji> tag. Existing <tg-emoji> spans are preserved as-is
 * to avoid double-wrapping. Intended for HTML-parse-mode messages only.
 */
export function applyPremiumEmojis(text: string, map: Record<string, string>): string {
  const entries = Object.entries(map ?? {}).filter(([e, id]) => e && id && id.trim());
  if (entries.length === 0) return text;
  // Longest emoji first so multi-codepoint emojis (👨‍👩‍👧) win over their parts.
  entries.sort((a, b) => b[0].length - a[0].length);
  // Split on existing <tg-emoji> tags so we don't wrap them twice.
  const parts = text.split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // preserve existing tag
      let out = part;
      for (const [emoji, id] of entries) {
        if (!out.includes(emoji)) continue;
        out = out.split(emoji).join(`<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`);
      }
      return out;
    })
    .join('');
}

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