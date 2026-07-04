import { loadPaymentConfig, type PaymentConfig } from "@/lib/payment-config.functions";
import { sendMessage, sendPhoto, formatPrice, EMOJI } from "@/lib/telegram.server";
import { recordAudit } from "@/lib/audit.server";
import { createHmac, randomBytes } from "crypto";

export type PayMethod = "upi" | "trc20" | "bep20" | "erc20" | "btc" | "binancepay";

export function methodLabel(m: PayMethod): string {
  return {
    upi: "UPI (INR)",
    trc20: "USDT · TRC-20 (Tron)",
    bep20: "USDT · BEP-20 (BSC)",
    erc20: "USDT · ERC-20 (Ethereum)",
    btc: "BTC (Bitcoin)",
    binancepay: "Binance Pay (USDT)",
  }[m];
}

export function enabledMethods(cfg: PaymentConfig): PayMethod[] {
  const out: PayMethod[] = [];
  if (cfg.upi.enabled && cfg.upi.upi_id) out.push("upi");
  if (cfg.crypto_trc20.enabled && cfg.crypto_trc20.address) out.push("trc20");
  if (cfg.crypto_bep20.enabled && cfg.crypto_bep20.address) out.push("bep20");
  if (cfg.crypto_erc20.enabled && cfg.crypto_erc20.address) out.push("erc20");
  if (cfg.crypto_btc.enabled && cfg.crypto_btc.address) out.push("btc");
  if (cfg.binance?.enabled && (cfg.binance.pay_id || cfg.binance.api_key)) out.push("binancepay");
  return out;
}

// USDT-BEP20 & USDT-ERC20 & USDT-TRC20 contract addresses
const USDT_BEP20 = "0x55d398326f99059fF775485246999027B3197955";
const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BTC_USD_RATE_DEFAULT = 60000; // fallback if not in cfg

/** Convert order USD-cents into the payment method's target amount. */
export function expectedAmount(order: { total_cents: number; currency: string }, method: PayMethod, cfg: PaymentConfig) {
  const usd = order.total_cents / 100; // assume order currency is USD
  if (method === "upi") {
    const inr = usd * (cfg.usd_to_inr_rate || 83);
    return { display: `₹${inr.toFixed(2)}`, human: `₹${inr.toFixed(2)}`, num: inr, unit: "INR" as const };
  }
  if (method === "btc") {
    const btc = usd / BTC_USD_RATE_DEFAULT;
    return { display: `${btc.toFixed(8)} BTC`, human: `${btc.toFixed(8)} BTC`, num: btc, unit: "BTC" as const };
  }
  if (method === "binancepay") {
    const usdt = usd / (cfg.usdt_to_usd_rate || 1);
    return { display: `${usdt.toFixed(2)} USDT`, human: `${usdt.toFixed(2)} USDT`, num: usdt, unit: "USDT" as const };
  }
  const usdt = usd / (cfg.usdt_to_usd_rate || 1);
  return { display: `${usdt.toFixed(2)} USDT`, human: `${usdt.toFixed(2)} USDT`, num: usdt, unit: "USDT" as const };
}

function withinTolerance(actual: number, expected: number, pct: number): boolean {
  if (expected <= 0) return false;
  const diff = Math.abs(actual - expected) / expected * 100;
  return diff <= pct;
}

export function normalizeReference(method: PayMethod, ref: string): string {
  const t = ref.trim();
  if (method === "upi") return t.replace(/\D/g, "");
  if (method === "btc") return t.toLowerCase();
  // eth-style: keep 0x + 64 hex
  return t.toLowerCase().startsWith("0x") ? t.toLowerCase() : t.toLowerCase();
}

/** Loose detector to route free-form chat messages that look like a reference. */
export function detectReference(text: string): { method: PayMethod | "any"; ref: string } | null {
  const t = text.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(t)) return { method: "any", ref: t.toLowerCase() };
  if (/^[a-fA-F0-9]{64}$/.test(t)) return { method: "any", ref: t.toLowerCase() };
  // Tron tx hashes are 64 hex without 0x, handled above.
  if (/^\d{10,22}$/.test(t)) return { method: "upi", ref: t };
  return null;
}

// ---- Verifiers ----

type VerifyResult =
  | { ok: true; provider: string; payload: any }
  | { ok: false; provider: string; reason: string; payload?: any };

async function verifyUpi(ref: string, expectedInr: number, cfg: PaymentConfig): Promise<VerifyResult> {
  if (!cfg.razorpay.enabled || !cfg.razorpay.key_id || !cfg.razorpay.key_secret) {
    return { ok: false, provider: "manual", reason: "Razorpay not configured — awaiting manual approval." };
  }
  const auth = Buffer.from(`${cfg.razorpay.key_id}:${cfg.razorpay.key_secret}`).toString("base64");
  const fromEpoch = Math.floor(Date.now() / 1000) - (cfg.reference_window_minutes || 30) * 60;
  const url = `https://api.razorpay.com/v1/payments?count=100&from=${fromEpoch}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) return { ok: false, provider: "razorpay", reason: `Razorpay ${res.status}` };
  const data: any = await res.json();
  const items: any[] = data?.items ?? [];
  const expectedPaise = Math.round(expectedInr * 100);
  const hit = items.find((p) => {
    const rrn = String(p?.acquirer_data?.rrn ?? p?.acquirer_data?.upi_transaction_id ?? "").replace(/\D/g, "");
    return rrn === ref
      && p.status === "captured"
      && withinTolerance(p.amount, expectedPaise, cfg.amount_tolerance_pct || 2);
  });
  if (hit) return { ok: true, provider: "razorpay", payload: { id: hit.id, amount: hit.amount, rrn: hit.acquirer_data?.rrn } };
  return { ok: false, provider: "razorpay", reason: "UTR not found or amount mismatch in last window" };
}

async function verifyTron(txHash: string, expectedUsdt: number, cfg: PaymentConfig): Promise<VerifyResult> {
  const url = `https://apilist.tronscanapi.com/api/transaction-info?hash=${txHash}`;
  const res = await fetch(url, { headers: cfg.crypto_trc20.api_key ? { "TRON-PRO-API-KEY": cfg.crypto_trc20.api_key } : {} });
  if (!res.ok) return { ok: false, provider: "tronscan", reason: `Tronscan ${res.status}` };
  const data: any = await res.json();
  if (!data || data.contractRet !== "SUCCESS") return { ok: false, provider: "tronscan", reason: "Tx not confirmed" };
  const transfers: any[] = data.trc20TransferInfo ?? data.tokenTransferInfo ? [data.tokenTransferInfo] : [];
  const list: any[] = data.trc20TransferInfo ?? [];
  const match = list.find((t) => {
    const decimals = Number(t.decimals ?? 6);
    const amt = Number(t.amount_str ?? t.amount ?? 0) / 10 ** decimals;
    return String(t.contract_address).toLowerCase() === USDT_TRC20.toLowerCase()
      && String(t.to_address) === cfg.crypto_trc20.address
      && withinTolerance(amt, expectedUsdt, cfg.amount_tolerance_pct || 2);
  });
  if (match) return { ok: true, provider: "tronscan", payload: { hash: txHash, to: match.to_address, amount_str: match.amount_str } };
  return { ok: false, provider: "tronscan", reason: "No matching USDT transfer to our address" };
}

async function verifyEvm(kind: "bep20" | "erc20", txHash: string, expectedUsdt: number, cfg: PaymentConfig): Promise<VerifyResult> {
  const api = kind === "bep20" ? "https://api.bscscan.com/api" : "https://api.etherscan.io/api";
  const contract = kind === "bep20" ? USDT_BEP20 : USDT_ERC20;
  const key = kind === "bep20" ? cfg.crypto_bep20.api_key : cfg.crypto_erc20.api_key;
  const addr = kind === "bep20" ? cfg.crypto_bep20.address : cfg.crypto_erc20.address;
  if (!key) return { ok: false, provider: kind, reason: `Missing ${kind === "bep20" ? "BscScan" : "Etherscan"} API key` };
  const url = `${api}?module=account&action=tokentx&contractaddress=${contract}&address=${addr}&page=1&offset=100&sort=desc&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) return { ok: false, provider: kind, reason: `${kind} ${res.status}` };
  const data: any = await res.json();
  if (data.status !== "1" || !Array.isArray(data.result)) return { ok: false, provider: kind, reason: data.message || "no txs" };
  const target = data.result.find((t: any) => String(t.hash).toLowerCase() === txHash.toLowerCase());
  if (!target) return { ok: false, provider: kind, reason: "Tx hash not found in recent transfers" };
  if (String(target.to).toLowerCase() !== addr.toLowerCase()) return { ok: false, provider: kind, reason: "Transfer not to our wallet" };
  const decimals = Number(target.tokenDecimal ?? 18);
  const amount = Number(target.value) / 10 ** decimals;
  if (!withinTolerance(amount, expectedUsdt, cfg.amount_tolerance_pct || 2)) {
    return { ok: false, provider: kind, reason: `Amount ${amount} != ${expectedUsdt}` };
  }
  const confs = Number(target.confirmations ?? 0);
  const need = kind === "bep20" ? cfg.crypto_bep20.min_confirmations : cfg.crypto_erc20.min_confirmations;
  if (confs < (need || 0)) return { ok: false, provider: kind, reason: `Only ${confs} confirmations, need ${need}` };
  return { ok: true, provider: kind, payload: { hash: txHash, amount, confs } };
}

async function verifyBtc(txHash: string, expectedBtc: number, cfg: PaymentConfig): Promise<VerifyResult> {
  const res = await fetch(`https://blockstream.info/api/tx/${txHash}`);
  if (!res.ok) return { ok: false, provider: "blockstream", reason: `Blockstream ${res.status}` };
  const tx: any = await res.json();
  const vout: any[] = tx.vout ?? [];
  const expectedSats = Math.round(expectedBtc * 1e8);
  const match = vout.find((v) => v.scriptpubkey_address === cfg.crypto_btc.address
    && withinTolerance(v.value, expectedSats, cfg.amount_tolerance_pct || 2));
  if (!match) return { ok: false, provider: "blockstream", reason: "No matching output to our address" };
  const confirmed = tx.status?.confirmed;
  if (!confirmed) return { ok: false, provider: "blockstream", reason: "Tx not yet confirmed on-chain" };
  return { ok: true, provider: "blockstream", payload: { hash: txHash, sats: match.value } };
}

export async function verifyReference(method: PayMethod, ref: string, order: { total_cents: number; currency: string }, cfg: PaymentConfig): Promise<VerifyResult> {
  const exp = expectedAmount(order, method, cfg);
  switch (method) {
    case "upi":  return verifyUpi(ref, exp.num, cfg);
    case "trc20": return verifyTron(ref, exp.num, cfg);
    case "bep20": return verifyEvm("bep20", ref, exp.num, cfg);
    case "erc20": return verifyEvm("erc20", ref, exp.num, cfg);
    case "btc":  return verifyBtc(ref, exp.num, cfg);
    case "binancepay": return verifyBinancePayByTradeNo(order as any, cfg);
  }
}

// ---- Binance Pay ----

const BINANCE_PAY_BASE = "https://bpay.binanceapi.com";

function binanceSign(payload: string, secret: string): { ts: string; nonce: string; sig: string } {
  const ts = Date.now().toString();
  const nonce = randomBytes(16).toString("hex").slice(0, 32);
  const data = `${ts}\n${nonce}\n${payload}\n`;
  const sig = createHmac("sha512", secret).update(data).digest("hex").toUpperCase();
  return { ts, nonce, sig };
}

async function binanceCall(path: string, body: any, cfg: PaymentConfig): Promise<any> {
  const payload = JSON.stringify(body);
  const { ts, nonce, sig } = binanceSign(payload, cfg.binance.api_secret);
  const res = await fetch(`${BINANCE_PAY_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "BinancePay-Timestamp": ts,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": cfg.binance.api_key,
      "BinancePay-Signature": sig,
    },
    body: payload,
  });
  return res.json().catch(() => ({}));
}

/** Create a Binance Pay order pinned to our order id so we can later query it. */
export async function createBinancePayOrder(
  order: { id: string; total_cents: number; currency: string },
  cfg: PaymentConfig,
): Promise<{ ok: true; checkoutUrl: string; qrcodeLink: string; deeplink: string; prepayId: string } | { ok: false; reason: string }> {
  if (!cfg.binance.api_key || !cfg.binance.api_secret) {
    return { ok: false, reason: "Binance Pay API keys not configured" };
  }
  const exp = expectedAmount(order as any, "binancepay", cfg);
  const body = {
    env: { terminalType: "WEB" },
    merchantTradeNo: order.id.replace(/-/g, "").slice(0, 32),
    orderAmount: Number(exp.num.toFixed(2)),
    currency: "USDT",
    goods: {
      goodsType: "02",
      goodsCategory: "Z000",
      referenceGoodsId: order.id.slice(0, 32),
      goodsName: `Order ${order.id.slice(0, 8)}`,
    },
  };
  const json = await binanceCall("/binancepay/openapi/v3/order", body, cfg);
  if (json?.status !== "SUCCESS" || json?.code !== "000000") {
    return { ok: false, reason: json?.errorMessage || json?.code || "Binance createOrder failed" };
  }
  return {
    ok: true,
    checkoutUrl: json.data.checkoutUrl,
    qrcodeLink: json.data.qrcodeLink,
    deeplink: json.data.deeplink,
    prepayId: json.data.prepayId,
  };
}

async function verifyBinancePayByTradeNo(
  order: { id: string },
  cfg: PaymentConfig,
): Promise<VerifyResult> {
  if (!cfg.binance?.api_key || !cfg.binance?.api_secret) {
    return { ok: false, provider: "manual", reason: "Binance Pay API keys not configured — awaiting manual approval." };
  }
  const merchantTradeNo = order.id.replace(/-/g, "").slice(0, 32);
  const json = await binanceCall("/binancepay/openapi/v2/order/query", { merchantTradeNo }, cfg);
  if (json?.status !== "SUCCESS" || json?.code !== "000000") {
    return { ok: false, provider: "binancepay", reason: json?.errorMessage || json?.code || "Binance queryOrder failed" };
  }
  const status = json.data?.status;
  if (status === "PAID") {
    return { ok: true, provider: "binancepay", payload: { prepayId: json.data.prepayId, transactionId: json.data.transactionId } };
  }
  return { ok: false, provider: "binancepay", reason: `Binance status: ${status || "unknown"} — pay first, then tap verify.` };
}

/** Public helper used by the bot when the buyer taps "I've paid — verify". */
export async function verifyBinanceForOrder(orderId: string): Promise<{ ok: boolean; message: string; provider?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,total_cents,currency,status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  if (order.status !== "pending") return { ok: false, message: `Order already ${order.status}.` };
  const cfg = await loadPaymentConfig();
  const result = await verifyBinancePayByTradeNo(order as any, cfg);
  if (!result.ok) return { ok: false, message: result.reason, provider: result.provider };
  await fulfillOrder(order.id, "binancepay", (result as any).payload?.transactionId ?? (result as any).payload?.prepayId ?? "binancepay");
  return { ok: true, message: "Payment verified — check your delivery message.", provider: result.provider };
}

/** Take a bot text message, find user's pending order + method, verify and fulfill. */
export async function submitReferenceFromChat(params: {
  telegram_id: number;
  chat_id: number;
  ref: string;
  method: PayMethod | "any";
}): Promise<{ handled: boolean; message?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Find most-recent pending order for this user
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,total_cents,currency,status,chat_id,telegram_id,created_at")
    .eq("telegram_id", params.telegram_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order) return { handled: false };

  const cfg = await loadPaymentConfig();

  // Determine method: if caller said 'any', try enabled crypto methods first (hash) or UPI (numeric)
  const candidateMethods: PayMethod[] = params.method === "any"
    ? (/^\d+$/.test(params.ref) ? ["upi"] : ["trc20", "bep20", "erc20", "btc"].filter((m) => enabledMethods(cfg).includes(m as PayMethod)) as PayMethod[])
    : [params.method];

  const normalized = normalizeReference(candidateMethods[0] ?? "upi", params.ref);

  // Insert a claim (unique on normalized_reference). Row conflict -> already used.
  const method = candidateMethods[0];
  const exp = expectedAmount(order, method, cfg);
  const amount_cents = method === "upi" ? Math.round(exp.num * 100) : Math.round(exp.num * 1e6);
  const claimCurrency = exp.unit;
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("payment_claims")
    .insert({
      order_id: order.id,
      telegram_id: params.telegram_id,
      chat_id: params.chat_id,
      method: method === "upi" ? "inr_utr" : "crypto",
      reference: params.ref.trim(),
      normalized_reference: normalized,
      amount_cents,
      currency: claimCurrency,
      status: "submitted",
    })
    .select("id")
    .single();
  if (claimErr) {
    return {
      handled: true,
      message: `${EMOJI.cross} Yeh reference pehle se use ho chuki hai. Support se contact karein.`,
    };
  }

  // Try each candidate method until one succeeds
  let lastFail: VerifyResult | null = null;
  for (const m of candidateMethods) {
    if (!cfg.auto_verify) break;
    const result = await verifyReference(m, params.ref.trim(), order, cfg);
    if (result.ok) {
      await supabaseAdmin.from("payment_claims").update({
        status: "verified",
        provider: result.provider,
        provider_payload: result.payload,
        verified_at: new Date().toISOString(),
        method: m === "upi" ? "inr_utr" : "crypto",
      }).eq("id", claim.id);
      await fulfillOrder(order.id, m, params.ref.trim());
      return { handled: true };
    }
    lastFail = result;
  }

  // Not verified: either auto disabled → manual, or failed → maybe manual fallback
  const msg = cfg.auto_verify
    ? (cfg.manual_approval_fallback
      ? `${EMOJI.clock} Auto-verify fail: <i>${lastFail?.reason ?? "unknown"}</i>. Admin manually verify karega — thoda ruk jaiye.`
      : `${EMOJI.cross} Verify nahi ho paya: <i>${lastFail?.reason ?? "unknown"}</i>. Sahi UTR/Hash bhejein.`)
    : `${EMOJI.clock} Reference receive ho gaya. Admin manually verify karega.`;

  await recordAudit({ action: "payment.claim.pending", success: false, orderId: order.id, context: { method, ref: params.ref, reason: lastFail?.reason } });
  return { handled: true, message: msg };
}

/** Claim digital-asset keys for an order, insert deliveries, DM the buyer. */
export async function fulfillOrder(orderId: string, method: PayMethod, reference: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,status,chat_id,currency,total_cents,order_items(id,product_id,quantity,product_name_snapshot)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;
  if (order.status === "paid" || order.status === "delivered") return;

  await supabaseAdmin.from("orders").update({
    status: "paid",
    paid_at: new Date().toISOString(),
  }).eq("id", orderId).eq("status", "pending");

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
        .eq("id", asset.id).eq("claimed", false);
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

  const shortId = order.id.slice(0, 8);
  const text =
    `${EMOJI.check} <b>Payment verified — delivery below</b>\n` +
    `Order <code>${shortId}</code> · ${formatPrice(order.total_cents, order.currency)}\n` +
    `Method: <b>${methodLabel(method)}</b> · Ref: <code>${reference.slice(0, 24)}</code>\n\n` +
    deliveryLines.join("\n\n") +
    `\n\nThanks for your purchase.`;

  if (order.chat_id) {
    try {
      await sendMessage(order.chat_id, text, { disable_web_page_preview: true });
      await supabaseAdmin.from("orders").update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        notified_at: new Date().toISOString(),
        last_delivery_error: null,
      }).eq("id", order.id);
    } catch (e: any) {
      await supabaseAdmin.from("orders").update({
        last_delivery_error: String(e?.message ?? e).slice(0, 500),
      }).eq("id", order.id);
    }
  }

  await recordAudit({ action: "payment.claim.verified", success: true, orderId: order.id, context: { method, provider: "bot" } });
}

/** Render the pay-instructions message for a chosen method. */
export async function buildPaymentInstruction(order: { id: string; total_cents: number; currency: string }, method: PayMethod) {
  const cfg = await loadPaymentConfig();
  const exp = expectedAmount(order, method, cfg);
  const shortId = order.id.slice(0, 8);
  const header = `${EMOJI.pay} <b>${methodLabel(method)}</b>\nOrder <code>${shortId}</code> · ${formatPrice(order.total_cents, order.currency)}`;
  let body = "";
  let photo: string | null = null;
  if (method === "upi") {
    body =
      `\n\n💠 <b>Send exactly ${exp.display}</b>\n` +
      `UPI ID: <code>${cfg.upi.upi_id}</code>\n` +
      (cfg.upi.payee_name ? `Payee: <b>${cfg.upi.payee_name}</b>\n` : "") +
      `\nPayment ke baad UTR (12-digit) yahi chat me bhej dijiye — auto-verify + delivery.`;
    if (cfg.upi.qr_image_url) photo = cfg.upi.qr_image_url;
  } else if (method === "btc") {
    body =
      `\n\n💠 <b>Send exactly ${exp.display}</b>\n` +
      `BTC address: <code>${cfg.crypto_btc.address}</code>\n` +
      `\nTx confirm hone ke baad transaction hash (txid) yahi bhej dijiye.`;
  } else {
    const c = method === "trc20" ? cfg.crypto_trc20 : method === "bep20" ? cfg.crypto_bep20 : cfg.crypto_erc20;
    body =
      `\n\n💠 <b>Send exactly ${exp.display}</b> (USDT ${method.toUpperCase()})\n` +
      `Wallet: <code>${c.address}</code>\n` +
      `\nTx confirm ke baad Transaction Hash yahi chat me bhej dijiye — auto-verify + delivery.`;
  }
  const text = header + body + `\n\n<i>${cfg.instructions}</i>`;
  return { text, photo };
}

export async function loadCfg(): Promise<PaymentConfig> {
  return loadPaymentConfig();
}