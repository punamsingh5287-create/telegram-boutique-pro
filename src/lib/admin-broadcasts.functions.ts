import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminBroadcast = {
  id: string;
  message: string;
  target: "all" | "paid_customers";
  status: "draft" | "sending" | "sent" | "failed";
  sentCount: number;
  failedCount: number;
  sentAt: string | null;
  createdAt: string;
};

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

function toRow(r: any): AdminBroadcast {
  return {
    id: r.id,
    message: r.message,
    target: r.target,
    status: r.status,
    sentCount: r.sent_count,
    failedCount: r.failed_count,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

export const listBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ broadcasts: AdminBroadcast[] } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { error: error.message };
    return { broadcasts: (data ?? []).map(toRow) };
  });

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

export const sendBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { message: string; target: "all" | "paid_customers" }) => ({
    message: data.message.trim().slice(0, 4000),
    target: data.target === "paid_customers" ? "paid_customers" : "all",
  }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; sent?: number; failed?: number; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    if (!data.message) return { ok: false, error: "Message required" };

    const lovableKey = process.env.LOVABLE_API_KEY;
    const tgKey = process.env.TELEGRAM_API_KEY;
    if (!lovableKey || !tgKey) return { ok: false, error: "Telegram connector not configured" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Collect chat IDs
    let chatIds: number[] = [];
    if (data.target === "paid_customers") {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("chat_id")
        .in("status", ["paid", "delivered"])
        .not("chat_id", "is", null);
      chatIds = Array.from(new Set((orders ?? []).map((o: any) => o.chat_id).filter(Boolean)));
    } else {
      const { data: users } = await supabaseAdmin
        .from("telegram_users")
        .select("chat_id")
        .not("chat_id", "is", null);
      chatIds = Array.from(new Set((users ?? []).map((u: any) => u.chat_id).filter(Boolean)));
    }

    if (chatIds.length === 0) {
      return { ok: false, error: "No recipients found" };
    }

    const { data: bc } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        message: data.message,
        target: data.target,
        status: "sending",
        created_by: context.userId,
      })
      .select("id")
      .single();

    let sent = 0;
    let failed = 0;
    for (const chatId of chatIds) {
      try {
        const res = await fetch(`${GATEWAY}/sendMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": tgKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chat_id: chatId, text: data.message, parse_mode: "HTML" }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
      // small pause to respect Telegram limits
      await new Promise((r) => setTimeout(r, 40));
    }

    await supabaseAdmin
      .from("broadcasts")
      .update({
        status: failed === 0 ? "sent" : sent === 0 ? "failed" : "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", bc?.id);

    await supabaseAdmin.from("admin_audit_log").insert({
      action: "broadcast.sent",
      actor_user_id: context.userId,
      success: failed === 0,
      attempts: chatIds.length,
      context: { broadcast_id: bc?.id, sent, failed, target: data.target },
    });

    return { ok: true, sent, failed };
  });