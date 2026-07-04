import { createFileRoute } from "@tanstack/react-router";
import { verifyStripeWebhook, type StripeEnv } from "@/lib/stripe.server";
import { sendMessage, formatPrice, EMOJI } from "@/lib/telegram.server";

async function claimDeliveries(orderId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,chat_id,currency,total_cents,order_items(id,product_id,quantity,product_name_snapshot)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const deliveryLines: string[] = [];

  for (const item of order.order_items ?? []) {
    for (let i = 0; i < item.quantity; i++) {
      const { data: asset } = await supabaseAdmin
        .from("digital_assets")
        .select("id,payload")
        .eq("product_id", item.product_id)
        .eq("claimed", false)
        .limit(1)
        .maybeSingle();

      if (!asset) {
        deliveryLines.push(`${EMOJI.cross} <b>${item.product_name_snapshot}</b> — out of stock, contact support`);
        continue;
      }

      const { error: claimErr } = await supabaseAdmin
        .from("digital_assets")
        .update({ claimed: true, claimed_at: new Date().toISOString(), order_item_id: item.id })
        .eq("id", asset.id)
        .eq("claimed", false);
      if (claimErr) continue;

      await supabaseAdmin.from("deliveries").insert({
        order_id: order.id,
        order_item_id: item.id,
        product_id: item.product_id,
        digital_asset_id: asset.id,
        payload_snapshot: asset.payload,
      });

      deliveryLines.push(`${EMOJI.key} <b>${item.product_name_snapshot}</b>\n<code>${asset.payload}</code>`);
    }
  }

  await supabaseAdmin
    .from("orders")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", order.id);

  if (order.chat_id && deliveryLines.length) {
    const text =
      `${EMOJI.check} <b>Payment received — Mateo Store</b>\n` +
      `Order <code>${order.id.slice(0, 8)}</code> · ${formatPrice(order.total_cents, order.currency)}\n\n` +
      deliveryLines.join("\n\n") +
      `\n\nThanks for your purchase.`;
    try {
      await sendMessage(order.chat_id, text, { disable_web_page_preview: true });
    } catch (e) {
      console.error("Telegram delivery send failed", e);
    }
  }
}

async function handleCheckoutCompleted(session: any) {
  const orderId: string | undefined = session?.metadata?.orderId;
  if (!orderId) {
    console.error("checkout.session.completed without orderId metadata", session?.id);
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id,status")
    .eq("id", orderId)
    .maybeSingle();
  if (!existing) return;
  if (existing.status === "paid" || existing.status === "delivered") return;

  await supabaseAdmin
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    })
    .eq("id", orderId);

  await claimDeliveries(orderId);
}

async function handlePaymentFailed(intent: any) {
  const orderId: string | undefined = intent?.metadata?.orderId;
  if (!orderId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("orders")
    .update({ status: "failed" })
    .eq("id", orderId)
    .in("status", ["pending"]);
}

async function handleChargeRefunded(charge: any) {
  const orderId: string | undefined = charge?.metadata?.orderId;
  if (!orderId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("orders").update({ status: "refunded" }).eq("id", orderId);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received with invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;

        let event: { type: string; data: { object: any } };
        try {
          event = await verifyStripeWebhook(request, env);
        } catch (e) {
          console.error("Stripe webhook verification failed:", e);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          switch (event.type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded":
              await handleCheckoutCompleted(event.data.object);
              break;
            case "checkout.session.async_payment_failed":
            case "payment_intent.payment_failed":
              await handlePaymentFailed(event.data.object);
              break;
            case "charge.refunded":
              await handleChargeRefunded(event.data.object);
              break;
            default:
              console.log("Unhandled Stripe event:", event.type);
          }
        } catch (e) {
          console.error("Webhook processing error:", e);
          return new Response("Processing error", { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});