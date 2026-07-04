import { sendMessage, formatPrice, EMOJI, sendPhoto } from "@/lib/telegram.server";
import { recordAudit } from "@/lib/audit.server";

const MAX_DM_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendTelegramWithRetry(
  chatId: number | string,
  text: string,
  photoUrl?: string | null,
): Promise<{ ok: true; attempts: number } | { ok: false; error: string; permanent: boolean; attempts: number }> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= MAX_DM_ATTEMPTS; attempt++) {
    try {
      if (photoUrl) {
        try {
          await sendPhoto(chatId, photoUrl, text);
          return { ok: true, attempts: attempt };
        } catch (photoErr) {
          console.error("sendPhoto failed, falling back to text:", photoErr);
        }
      }
      await sendMessage(chatId, text, { disable_web_page_preview: true });
      return { ok: true, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const permanent = /chat not found|bot was blocked|user is deactivated|Forbidden|bad request/i.test(lastError);
      if (permanent || attempt === MAX_DM_ATTEMPTS) {
        return { ok: false, error: lastError, permanent, attempts: attempt };
      }
      await sleep(400 * 2 ** (attempt - 1));
    }
  }
  return { ok: false, error: lastError, permanent: false, attempts: MAX_DM_ATTEMPTS };
}

export async function notifyAdmin(text: string) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return;
  try {
    await sendMessage(adminId, text, { disable_web_page_preview: true });
  } catch (e) {
    console.error("Admin notify failed:", e);
  }
}

// Rebuild the delivery DM from persisted `deliveries` rows and (re)send it.
// Safe to run repeatedly: it never re-claims stock — keys are read from
// what was already recorded when the order was paid.
export async function sendOrderDeliveryDM(
  orderId: string,
): Promise<{ ok: true; attempts: number } | { ok: false; error: string; permanent: boolean; attempts: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id,chat_id,currency,total_cents,delivery_attempts,deliveries(payload_snapshot,order_items(product_name_snapshot,products(image_url)))")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return { ok: false, error: "Order not found", permanent: true, attempts: 0 };
  }
  if (!order.chat_id) {
    return { ok: false, error: "Order has no Telegram chat_id", permanent: true, attempts: 0 };
  }
  const deliveries = order.deliveries ?? [];
  if (!deliveries.length) {
    return { ok: false, error: "No deliveries recorded for this order", permanent: true, attempts: 0 };
  }

  const shortId = order.id.slice(0, 8);
  let firstImage: string | null = null;
  const lines = deliveries.map((d: any) => {
    const name = d.order_items?.product_name_snapshot ?? "Item";
    const img = d.order_items?.products?.image_url as string | null | undefined;
    if (img && !firstImage) firstImage = img;
    return `${EMOJI.key} <b>${name}</b>\n<code>${d.payload_snapshot}</code>`;
  });
  const text =
    `${EMOJI.check} <b>Your delivery — Mateo Store</b>\n` +
    `Order <code>${shortId}</code> · ${formatPrice(order.total_cents, order.currency)}\n\n` +
    lines.join("\n\n") +
    `\n\nThanks for your purchase.`;

  const result = await sendTelegramWithRetry(order.chat_id, text, firstImage);
  const priorAttempts = order.delivery_attempts ?? 0;

  if (result.ok) {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        notified_at: new Date().toISOString(),
        delivery_attempts: priorAttempts + result.attempts,
        last_delivery_error: null,
      })
      .eq("id", order.id);
    await recordAudit({
      action: "delivery.dm.sent",
      orderId: order.id,
      success: true,
      attempts: result.attempts,
      context: { chatId: order.chat_id, priorAttempts, itemCount: deliveries.length },
    });
  } else {
    await supabaseAdmin
      .from("orders")
      .update({
        delivery_attempts: priorAttempts + result.attempts,
        last_delivery_error: result.error.slice(0, 500),
      })
      .eq("id", order.id);
    await recordAudit({
      action: "delivery.dm.failed",
      orderId: order.id,
      success: false,
      attempts: result.attempts,
      error: result.error,
      permanent: result.permanent,
      context: { chatId: order.chat_id, priorAttempts, itemCount: deliveries.length },
    });
  }

  return result;
}