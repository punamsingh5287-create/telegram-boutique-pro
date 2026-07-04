import { createServerFn } from "@tanstack/react-start";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

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