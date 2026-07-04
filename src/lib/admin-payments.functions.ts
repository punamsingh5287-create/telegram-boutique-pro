import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PaymentRow = {
  orderId: string;
  status: string;
  totalCents: number;
  currency: string;
  environment: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  chatId: number | null;
  createdAt: string;
  paidAt: string | null;
};

export type PaymentStats = {
  totalCents: number;
  currency: string;
  paidCount: number;
  pendingCount: number;
  failedCount: number;
  refundedCount: number;
  todayCents: number;
  sandboxConfigured: boolean;
  liveConfigured: boolean;
  webhookConfigured: boolean;
};

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

export const getPaymentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentStats | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: paid } = await supabaseAdmin
      .from("orders")
      .select("total_cents,currency,paid_at,status")
      .in("status", ["paid", "delivered"])
      .not("paid_at", "is", null)
      .limit(5000);

    let totalCents = 0;
    let todayCents = 0;
    let currency = "USD";
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    for (const o of paid ?? []) {
      totalCents += o.total_cents;
      currency = o.currency || currency;
      if (o.paid_at && new Date(o.paid_at) >= startOfDay) todayCents += o.total_cents;
    }

    const counts: Record<string, number> = {};
    for (const s of ["paid", "pending", "failed", "refunded"]) {
      const { count } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      counts[s] = count ?? 0;
    }

    return {
      totalCents,
      todayCents,
      currency,
      paidCount: counts.paid ?? 0,
      pendingCount: counts.pending ?? 0,
      failedCount: counts.failed ?? 0,
      refundedCount: counts.refunded ?? 0,
      sandboxConfigured: Boolean(process.env.STRIPE_SANDBOX_API_KEY),
      liveConfigured: Boolean(process.env.STRIPE_LIVE_API_KEY),
      webhookConfigured: Boolean(process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET),
    };
  });

export const listPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { status?: string; page?: number; pageSize?: number }) => ({
    status: data.status ?? "all",
    page: Math.max(1, data.page ?? 1),
    pageSize: Math.min(100, Math.max(10, data.pageSize ?? 25)),
  }))
  .handler(async ({ data, context }): Promise<{ payments: PaymentRow[]; total: number } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = supabaseAdmin
      .from("orders")
      .select("id,status,total_cents,currency,environment,stripe_session_id,stripe_payment_intent_id,chat_id,created_at,paid_at", { count: "exact" })
      .order("created_at", { ascending: false });

    if (data.status !== "all") q = q.eq("status", data.status);

    const { data: rows, count, error } = await q.range(from, to);
    if (error) return { error: error.message };

    return {
      total: count ?? 0,
      payments: (rows ?? []).map((r: any) => ({
        orderId: r.id,
        status: r.status,
        totalCents: r.total_cents,
        currency: r.currency,
        environment: r.environment,
        stripeSessionId: r.stripe_session_id,
        stripePaymentIntentId: r.stripe_payment_intent_id,
        chatId: r.chat_id,
        createdAt: r.created_at,
        paidAt: r.paid_at,
      })),
    };
  });