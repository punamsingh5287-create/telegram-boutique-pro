import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminOrderRow = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  chatId: number | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  itemCount: number;
  lastError: string | null;
};

export type ListOrdersInput = {
  page: number;
  pageSize: number;
  status: "all" | "pending" | "paid" | "delivered" | "failed" | "refunded";
  q: string;
};

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListOrdersInput) => ({
    page: Math.max(1, Math.floor(data.page || 1)),
    pageSize: Math.min(100, Math.max(10, Math.floor(data.pageSize || 25))),
    status: (["all", "pending", "paid", "delivered", "failed", "refunded"].includes(data.status)
      ? data.status
      : "all") as ListOrdersInput["status"],
    q: typeof data.q === "string" ? data.q.trim().slice(0, 100) : "",
  }))
  .handler(async ({ data, context }): Promise<{ rows: AdminOrderRow[]; total: number } | { error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = supabaseAdmin
      .from("orders")
      .select(
        "id,status,total_cents,currency,chat_id,created_at,paid_at,delivered_at,last_delivery_error,order_items(id)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.q) {
      if (UUID_RE.test(data.q)) q = q.eq("id", data.q);
      else if (/^\d+$/.test(data.q)) q = q.eq("chat_id", Number(data.q));
      else q = q.ilike("stripe_session_id", `%${data.q}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) return { error: error.message };

    return {
      total: count ?? 0,
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        totalCents: r.total_cents,
        currency: r.currency,
        chatId: r.chat_id,
        createdAt: r.created_at,
        paidAt: r.paid_at,
        deliveredAt: r.delivered_at,
        itemCount: r.order_items?.length ?? 0,
        lastError: r.last_delivery_error,
      })),
    };
  });

export type AdminOrderDetail = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  chatId: number | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  notifiedAt: string | null;
  deliveryAttempts: number;
  lastError: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  environment: string | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
};

export const getAdminOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => {
    if (!UUID_RE.test(data.orderId)) throw new Error("Invalid order id");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ order: AdminOrderDetail } | { error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: o, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id,status,total_cents,currency,chat_id,created_at,paid_at,delivered_at,notified_at,delivery_attempts,last_delivery_error,stripe_session_id,stripe_payment_intent_id,environment,order_items(id,product_name_snapshot,quantity,unit_price_cents)",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!o) return { error: "Order not found" };

    return {
      order: {
        id: o.id,
        status: o.status,
        totalCents: o.total_cents,
        currency: o.currency,
        chatId: o.chat_id,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        deliveredAt: o.delivered_at,
        notifiedAt: o.notified_at,
        deliveryAttempts: o.delivery_attempts ?? 0,
        lastError: o.last_delivery_error,
        stripeSessionId: o.stripe_session_id,
        stripePaymentIntentId: o.stripe_payment_intent_id,
        environment: o.environment,
        items: (o.order_items ?? []).map((i: any) => ({
          id: i.id,
          name: i.product_name_snapshot,
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          lineTotalCents: i.quantity * i.unit_price_cents,
        })),
      },
    };
  });