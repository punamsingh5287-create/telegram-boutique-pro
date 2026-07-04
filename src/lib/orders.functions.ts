import { createServerFn } from "@tanstack/react-start";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderSummaryItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type OrderSummary = {
  id: string;
  status: "pending" | "paid" | "delivered" | "failed" | "refunded";
  currency: string;
  totalCents: number;
  items: OrderSummaryItem[];
  createdAt: string;
  paidAt: string | null;
};

type OrderLookupResult = { order: OrderSummary } | { error: string };

export const getOrderForCheckout = createServerFn({ method: "GET" })
  .inputValidator((data: { orderId: string }) => {
    if (!UUID_RE.test(data.orderId)) throw new Error("Invalid order id");
    return data;
  })
  .handler(async ({ data }): Promise<OrderLookupResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,status,currency,total_cents,created_at,paid_at,order_items(product_name_snapshot,quantity,unit_price_cents)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) return { error: "Unable to load order" };
    if (!order) return { error: "Order not found" };
    const items = (order.order_items ?? []).map((i) => ({
      name: i.product_name_snapshot,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
    }));
    return {
      order: {
        id: order.id,
        status: order.status as OrderSummary["status"],
        currency: order.currency,
        totalCents: order.total_cents,
        items,
        createdAt: order.created_at,
        paidAt: order.paid_at,
      },
    };
  });

type CheckoutResult = { clientSecret: string } | { error: string };

export const createOrderCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!UUID_RE.test(data.orderId)) throw new Error("Invalid order id");
    if (!/^https?:\/\//.test(data.returnUrl)) throw new Error("Invalid return url");
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("Invalid environment");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CheckoutResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: order, error } = await supabaseAdmin
        .from("orders")
        .select("id,status,currency,total_cents,stripe_session_id,order_items(product_name_snapshot,quantity,unit_price_cents)")
        .eq("id", data.orderId)
        .maybeSingle();
      if (error || !order) return { error: "Order not found" };
      if (order.status !== "pending") return { error: `Order is ${order.status} and cannot be paid` };
      if (!order.order_items?.length) return { error: "Order has no items" };

      const stripe = createStripeClient(data.environment);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        line_items: order.order_items.map((i) => ({
          quantity: i.quantity,
          price_data: {
            currency: order.currency.toLowerCase(),
            product_data: { name: i.product_name_snapshot },
            unit_amount: i.unit_price_cents,
          },
        })),
        payment_intent_data: {
          description: `Mateo Store · Order ${order.id.slice(0, 8)}`,
          metadata: { orderId: order.id },
        },
        metadata: { orderId: order.id },
      });

      await supabaseAdmin
        .from("orders")
        .update({
          stripe_session_id: session.id,
          environment: data.environment,
        })
        .eq("id", order.id);

      return { clientSecret: session.client_secret ?? "" };
    } catch (err) {
      return { error: getStripeErrorMessage(err) };
    }
  });

type PaymentClaimResult =
  | { ok: true; status: "submitted"; message: string }
  | { ok: false; error: string };

function normalizePaymentReference(method: "crypto" | "inr_utr", reference: string) {
  const compact = reference.trim().replace(/[\s-]+/g, "");
  if (method === "crypto") return compact.toLowerCase();
  return compact.toUpperCase();
}

export const submitPaymentClaim = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; method: "crypto" | "inr_utr"; reference: string }) => {
    if (!UUID_RE.test(data.orderId)) throw new Error("Invalid order id");
    if (data.method !== "crypto" && data.method !== "inr_utr") throw new Error("Invalid payment method");
    const reference = data.reference.trim();
    if (data.method === "crypto" && !/^(0x)?[a-fA-F0-9]{64}$/.test(reference.replace(/[\s-]+/g, ""))) {
      throw new Error("Enter a valid crypto transaction hash");
    }
    if (data.method === "inr_utr" && !/^[a-zA-Z0-9\s-]{6,30}$/.test(reference)) {
      throw new Error("Enter a valid UTR/reference number");
    }
    return { orderId: data.orderId, method: data.method, reference };
  })
  .handler(async ({ data }): Promise<PaymentClaimResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,status,total_cents,currency,telegram_id,chat_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !order) return { ok: false, error: "Order not found" };
    if (order.status !== "pending") return { ok: false, error: `Order is already ${order.status}` };

    const normalized = normalizePaymentReference(data.method, data.reference);
    const { error: claimError } = await (supabaseAdmin as any).from("payment_claims").insert({
      order_id: order.id,
      telegram_id: order.telegram_id,
      chat_id: order.chat_id,
      method: data.method,
      reference: data.reference,
      normalized_reference: normalized,
      amount_cents: order.total_cents,
      currency: order.currency,
      status: "submitted",
      provider: data.method === "crypto" ? "block_explorer" : "razorpay_cashfree",
    });
    if (claimError) {
      if ((claimError as { code?: string }).code === "23505") {
        return { ok: false, error: "This transaction reference was already used" };
      }
      return { ok: false, error: claimError.message };
    }
    return {
      ok: true,
      status: "submitted",
      message: "Reference submitted. Delivery will start only after verified payment confirmation.",
    };
  });

export type FailedDelivery = {
  id: string;
  shortId: string;
  chatId: number | null;
  totalCents: number;
  currency: string;
  paidAt: string | null;
  deliveryAttempts: number;
  lastError: string | null;
  itemCount: number;
};

export const listFailedDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: FailedDelivery[] } | { error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id,chat_id,total_cents,currency,paid_at,delivery_attempts,last_delivery_error,deliveries(id)")
      .not("last_delivery_error", "is", null)
      .in("status", ["paid"])
      .order("paid_at", { ascending: false })
      .limit(100);
    if (error) return { error: error.message };

    return {
      orders: (data ?? []).map((o: any) => ({
        id: o.id,
        shortId: o.id.slice(0, 8),
        chatId: o.chat_id,
        totalCents: o.total_cents,
        currency: o.currency,
        paidAt: o.paid_at,
        deliveryAttempts: o.delivery_attempts ?? 0,
        lastError: o.last_delivery_error,
        itemCount: o.deliveries?.length ?? 0,
      })),
    };
  });

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const resendOrderDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => {
    if (!UUID_ONLY.test(data.orderId)) throw new Error("Invalid order id");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; attempts: number } | { ok: false; error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, error: "Forbidden" };

    const { sendOrderDeliveryDM } = await import("@/lib/delivery.server");
    const { recordAudit } = await import("@/lib/audit.server");
    await recordAudit({
      action: "delivery.resend.requested",
      orderId: data.orderId,
      actorUserId: context.userId,
      context: { mode: "single" },
    });
    try {
      const result = await sendOrderDeliveryDM(data.orderId);
      await recordAudit({
        action: "delivery.resend.completed",
        orderId: data.orderId,
        actorUserId: context.userId,
        success: result.ok,
        attempts: result.attempts,
        error: result.ok ? null : result.error,
        permanent: result.ok ? null : result.permanent,
        context: { mode: "single" },
      });
      if (result.ok) return { ok: true, attempts: result.attempts };
      return { ok: false, error: result.error };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordAudit({
        action: "delivery.resend.handler_error",
        orderId: data.orderId,
        actorUserId: context.userId,
        success: false,
        error: msg,
        context: { mode: "single", stack: e instanceof Error ? e.stack?.slice(0, 1000) : null },
      });
      return { ok: false, error: msg };
    }
  });

export type BulkResendItem =
  | { orderId: string; ok: true; attempts: number }
  | { orderId: string; ok: false; error: string };

export const bulkResendOrderDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderIds: string[] }) => {
    if (!Array.isArray(data.orderIds) || data.orderIds.length === 0) {
      throw new Error("No orders selected");
    }
    if (data.orderIds.length > 50) throw new Error("Too many orders (max 50)");
    for (const id of data.orderIds) {
      if (!UUID_ONLY.test(id)) throw new Error("Invalid order id");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; results: BulkResendItem[] } | { ok: false; error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, error: "Forbidden" };

    const { sendOrderDeliveryDM } = await import("@/lib/delivery.server");
    const { recordAudit } = await import("@/lib/audit.server");
    await recordAudit({
      action: "delivery.resend.requested",
      actorUserId: context.userId,
      context: { mode: "bulk", count: data.orderIds.length, orderIds: data.orderIds },
    });
    const results: BulkResendItem[] = [];
    for (const orderId of data.orderIds) {
      try {
        const r = await sendOrderDeliveryDM(orderId);
        results.push(r.ok ? { orderId, ok: true, attempts: r.attempts } : { orderId, ok: false, error: r.error });
        await recordAudit({
          action: "delivery.resend.completed",
          orderId,
          actorUserId: context.userId,
          success: r.ok,
          attempts: r.attempts,
          error: r.ok ? null : r.error,
          permanent: r.ok ? null : r.permanent,
          context: { mode: "bulk" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({ orderId, ok: false, error: msg });
        await recordAudit({
          action: "delivery.resend.handler_error",
          orderId,
          actorUserId: context.userId,
          success: false,
          error: msg,
          context: { mode: "bulk", stack: e instanceof Error ? e.stack?.slice(0, 1000) : null },
        });
      }
    }
    return { ok: true, results };
  });