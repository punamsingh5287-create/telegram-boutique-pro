import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BotConfig, ButtonKey } from "./telegram-bot-config.server";

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

export type { BotConfig, ButtonKey } from "./telegram-bot-config.server";

export const getBotConfigAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ config: BotConfig } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { getBotConfig } = await import("./telegram-bot-config.server");
    const config = await getBotConfig();
    return { config };
  });

export const saveBotConfigAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: BotConfig) => data)
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { saveBotConfig } = await import("./telegram-bot-config.server");
    // Sanitize emoji map: drop empty rows, trim IDs
    const emoji_map: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.emoji_map ?? {})) {
      const key = (k ?? "").trim();
      const val = (v ?? "").toString().trim();
      if (key && val) emoji_map[key] = val;
    }
    await saveBotConfig({ ...data, emoji_map });
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("admin_audit_log").insert({
        action: "bot_config.updated",
        actor_user_id: context.userId,
        success: true,
        context: { emoji_map_size: Object.keys(emoji_map).length },
      });
    } catch {}
    return { ok: true };
  });

/** Preview helper: wrap plain emojis with <tg-emoji> tags using the given map. */
export const previewPremiumText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; emoji_map: Record<string, string> }) => data)
  .handler(async ({ data, context }): Promise<{ rendered: string } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { applyPremiumEmojis } = await import("./telegram-bot-config.server");
    return { rendered: applyPremiumEmojis(data.text, data.emoji_map) };
  });