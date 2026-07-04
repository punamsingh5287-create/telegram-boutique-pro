import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UpiConfig = {
  enabled: boolean;
  upi_id: string;
  payee_name: string;
  qr_image_url: string;
};

export type RazorpayConfig = {
  enabled: boolean;
  key_id: string;
  key_secret: string;
};

export type CryptoConfig = {
  enabled: boolean;
  address: string;
  api_key: string;
  min_confirmations: number;
};

export type PaymentConfig = {
  upi: UpiConfig;
  razorpay: RazorpayConfig;
  crypto_trc20: CryptoConfig;
  crypto_bep20: CryptoConfig;
  crypto_erc20: CryptoConfig;
  crypto_btc: CryptoConfig;
  usd_to_inr_rate: number;
  usdt_to_usd_rate: number;
  amount_tolerance_pct: number;
  reference_window_minutes: number;
  auto_verify: boolean;
  manual_approval_fallback: boolean;
  instructions: string;
};

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  upi: { enabled: false, upi_id: "", payee_name: "", qr_image_url: "" },
  razorpay: { enabled: false, key_id: "", key_secret: "" },
  crypto_trc20: { enabled: false, address: "", api_key: "", min_confirmations: 19 },
  crypto_bep20: { enabled: false, address: "", api_key: "", min_confirmations: 15 },
  crypto_erc20: { enabled: false, address: "", api_key: "", min_confirmations: 12 },
  crypto_btc:   { enabled: false, address: "", api_key: "", min_confirmations: 1 },
  usd_to_inr_rate: 83,
  usdt_to_usd_rate: 1,
  amount_tolerance_pct: 2,
  reference_window_minutes: 30,
  auto_verify: true,
  manual_approval_fallback: true,
  instructions:
    "Payment karne ke baad UTR / Transaction Hash yahi chat me bhej dijiye — 1-2 minute me automatic delivery mil jayegi.",
};

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

function merge(raw: any): PaymentConfig {
  const v = (raw ?? {}) as Partial<PaymentConfig>;
  const d = DEFAULT_PAYMENT_CONFIG;
  return {
    upi: { ...d.upi, ...(v.upi ?? {}) },
    razorpay: { ...d.razorpay, ...(v.razorpay ?? {}) },
    crypto_trc20: { ...d.crypto_trc20, ...(v.crypto_trc20 ?? {}) },
    crypto_bep20: { ...d.crypto_bep20, ...(v.crypto_bep20 ?? {}) },
    crypto_erc20: { ...d.crypto_erc20, ...(v.crypto_erc20 ?? {}) },
    crypto_btc:   { ...d.crypto_btc,   ...(v.crypto_btc ?? {}) },
    usd_to_inr_rate: Number(v.usd_to_inr_rate ?? d.usd_to_inr_rate) || d.usd_to_inr_rate,
    usdt_to_usd_rate: Number(v.usdt_to_usd_rate ?? d.usdt_to_usd_rate) || d.usdt_to_usd_rate,
    amount_tolerance_pct: Number(v.amount_tolerance_pct ?? d.amount_tolerance_pct),
    reference_window_minutes: Number(v.reference_window_minutes ?? d.reference_window_minutes) || d.reference_window_minutes,
    auto_verify: v.auto_verify ?? d.auto_verify,
    manual_approval_fallback: v.manual_approval_fallback ?? d.manual_approval_fallback,
    instructions: (v.instructions ?? d.instructions) as string,
  };
}

/** Server-only helper for the bot / verifier. Not exposed via RPC. */
export async function loadPaymentConfig(): Promise<PaymentConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "payments")
    .maybeSingle();
  return merge(data?.value);
}

export const getPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ config: PaymentConfig } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    return { config: await loadPaymentConfig() };
  });

export const savePaymentConfig = createServerFn({ method: "POST" })
  .inputValidator((data: PaymentConfig) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const cfg = merge(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "payments", value: cfg as any, updated_by: context.userId }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "settings.payments.updated",
      actor_user_id: context.userId,
      success: true,
      context: { keys: Object.keys(cfg) },
    });
    return { ok: true };
  });