import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StoreSettings = {
  name: string;
  welcome_message: string;
  default_currency: string;
};

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

const DEFAULTS: StoreSettings = {
  name: "Mateo Store",
  welcome_message: "Welcome! Browse products and buy in seconds.",
  default_currency: "USD",
};

export const getStoreSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ settings: StoreSettings } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "store")
      .maybeSingle();
    const value = (data?.value ?? {}) as Partial<StoreSettings>;
    return {
      settings: {
        name: value.name ?? DEFAULTS.name,
        welcome_message: value.welcome_message ?? DEFAULTS.welcome_message,
        default_currency: value.default_currency ?? DEFAULTS.default_currency,
      },
    };
  });

export const saveStoreSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: StoreSettings) => ({
    name: (data.name || "").trim().slice(0, 100) || DEFAULTS.name,
    welcome_message: (data.welcome_message || "").slice(0, 1000),
    default_currency: (data.default_currency || "USD").toUpperCase().slice(0, 3),
  }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "store", value: data, updated_by: context.userId }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "settings.updated",
      actor_user_id: context.userId,
      success: true,
      context: { key: "store" },
    });
    return { ok: true };
  });