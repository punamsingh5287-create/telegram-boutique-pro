import { createFileRoute } from "@tanstack/react-router";
import { verifyStripeWebhook, type StripeEnv } from "@/lib/stripe.server";
import { sendMessage, sendPhoto, formatPrice, EMOJI } from "@/lib/telegram.server";

const MAX_DM_ATTEMPTS = 4;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Retry Telegram sendMessage with capped exponential backoff. Skips retry
// on permanent 4xx conditions (bot blocked, chat not found, invalid input)
// since retrying those never succeeds.
async function sendWithRetry(
  chatId: number | string,
  text: string,
  photoUrl?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; permanent: boolean; attempts: number }> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= MAX_DM_ATTEMPTS; attempt++) {
    try {
      if (photoUrl) {
        try {
          await sendPhoto(chatId, photoUrl, text);
          return { ok: true };
        } catch (photoErr) {
          console.error("sendPhoto failed, falling back to text:", photoErr);
        }
      }
      await sendMessage(chatId, text, { disable_web_page_preview: true });
      return { ok: true };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const permanent = /chat not found|bot was blocked|user is deactivated|Forbidden|bad request/i.test(lastError);
      if (permanent || attempt === MAX_DM_ATTEMPTS) {
        return { ok: false, error: lastError, permanent, attempts: attempt };
      }
      // 400ms, 800ms, 1600ms
      await sleep(400 * 2 ** (attempt - 1));
    }
  }
  return { ok: false, error: lastError, permanent: false, attempts: MAX_DM_ATTEMPTS };
}

async function notifyAdmin(text: string) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return;
  try {
    await sendMessage(adminId, text, { disable_web_page_preview: true });
  } catch (e) {
    console.error("Admin notify failed:", e);
  }
}

async function claimDeliveries(orderId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,chat_id,currency,total_cents,order_items(id,product_id,quantity,product_name_snapshot,products(image_url))")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const deliveryLines: string[] = [];
  let firstImage: string | null = null;

  for (const item of order.order_items ?? []) {
    const img = (item as any).products?.image_url as string | null | undefined;
    if (img && !firstImage) firstImage = img;
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

  // License keys are already persisted in `deliveries` above, so keys are
  // never lost even if the DM fails permanently. `delivered` = DM confirmed;
  // `paid` + non-null last_delivery_error = keys claimed, DM pending.
  const shortId = order.id.slice(0, 8);
  const text =
    `${EMOJI.check} <b>Payment received — Mateo Store</b>\n` +
    `Order <code>${shortId}</code> · ${formatPrice(order.total_cents, order.currency)}\n\n` +
    deliveryLines.join("\n\n") +
    `\n\nThanks for your purchase.`;

  if (!order.chat_id || !deliveryLines.length) {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        last_delivery_error: !order.chat_id ? "No chat_id on order" : "No deliverable items",
      })
      .eq("id", order.id);
    await notifyAdmin(
      `${EMOJI.cross} <b>Delivery blocked</b>\nOrder <code>${shortId}</code> — ${
        !order.chat_id ? "no chat_id" : "no deliverable items"
      }`,
    );
    return;
  }

  const result = await sendWithRetry(order.chat_id, text, firstImage);

  if (result.ok) {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        notified_at: new Date().toISOString(),
        last_delivery_error: null,
      })
      .eq("id", order.id);
    return;
  }

  // DM failed after retries — keep status='paid' so an admin can retry
  // without re-claiming already-issued keys. Log the failure and ping admin.
  const { data: current } = await supabaseAdmin
    .from("orders")
    .select("delivery_attempts")
    .eq("id", order.id)
    .maybeSingle();
  const priorAttempts = current?.delivery_attempts ?? 0;

  await supabaseAdmin
    .from("orders")
    .update({
      status: "paid",
      delivery_attempts: priorAttempts + result.attempts,
      last_delivery_error: result.error.slice(0, 500),
    })
    .eq("id", order.id);

  console.error(`Telegram delivery failed for order ${shortId} (permanent=${result.permanent}):`, result.error);
  await notifyAdmin(
    `${EMOJI.cross} <b>Telegram delivery failed</b>\n` +
      `Order <code>${shortId}</code> · chat <code>${order.chat_id}</code>\n` +
      `Attempts: ${result.attempts} · Permanent: ${result.permanent ? "yes" : "no"}\n` +
      `Error: ${result.error.slice(0, 300)}\n\n` +
      `Keys are stored in <b>deliveries</b> and can be resent from the admin dashboard.`,
  );
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

        let event: { id: string; type: string; data: { object: any } };
        try {
          event = await verifyStripeWebhook(request, env);
        } catch (e) {
          console.error("Stripe webhook verification failed:", e);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          // Idempotency: record the event id first. If it already exists,
          // Stripe is retrying a previously-processed event — skip handlers
          // so license keys are never claimed or DMed twice.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error: dupErr } = await supabaseAdmin
            .from("stripe_webhook_events")
            .insert({ event_id: event.id, type: event.type, environment: env });
          if (dupErr) {
            if ((dupErr as { code?: string }).code === "23505") {
              console.log("Duplicate Stripe event ignored:", event.id);
              return Response.json({ received: true, duplicate: true });
            }
            throw dupErr;
          }

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