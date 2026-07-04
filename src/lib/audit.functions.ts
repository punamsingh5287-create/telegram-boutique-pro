import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AuditRow = {
  id: string;
  action: string;
  orderId: string | null;
  actorUserId: string | null;
  success: boolean | null;
  attempts: number | null;
  error: string | null;
  permanent: boolean | null;
  context: Record<string, unknown>;
  createdAt: string;
};

export type ListAuditInput = {
  page: number;
  pageSize: number;
  result: "all" | "success" | "failure" | "pending";
  action: string;
};

export type ListAuditResult =
  | { rows: AuditRow[]; total: number; page: number; pageSize: number }
  | { error: string };

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListAuditInput) => {
    const page = Math.max(1, Math.floor(data.page || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(data.pageSize || 25)));
    const result = ["all", "success", "failure", "pending"].includes(data.result) ? data.result : "all";
    const action = typeof data.action === "string" ? data.action.slice(0, 100) : "";
    return { page, pageSize, result, action };
  })
  .handler(async ({ data, context }): Promise<ListAuditResult> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = supabaseAdmin
      .from("admin_audit_log")
      .select("id,action,order_id,actor_user_id,success,attempts,error,permanent,context,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.action) q = q.ilike("action", `%${data.action}%`);
    if (data.result === "success") q = q.eq("success", true);
    else if (data.result === "failure") q = q.eq("success", false);
    else if (data.result === "pending") q = q.is("success", null);

    const { data: rows, error, count } = await q;
    if (error) return { error: error.message };

    return {
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        action: r.action,
        orderId: r.order_id,
        actorUserId: r.actor_user_id,
        success: r.success,
        attempts: r.attempts,
        error: r.error,
        permanent: r.permanent,
        context: r.context ?? {},
        createdAt: r.created_at,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });