// Server-only helper to append entries to the admin audit log.
// Failures never bubble up — auditing must not break the caller.

export type AuditEntry = {
  action: string;
  orderId?: string | null;
  actorUserId?: string | null;
  success?: boolean | null;
  attempts?: number | null;
  error?: string | null;
  permanent?: boolean | null;
  context?: Record<string, unknown>;
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_audit_log").insert({
      action: entry.action,
      order_id: entry.orderId ?? null,
      actor_user_id: entry.actorUserId ?? null,
      success: entry.success ?? null,
      attempts: entry.attempts ?? null,
      error: entry.error ? entry.error.slice(0, 2000) : null,
      permanent: entry.permanent ?? null,
      context: entry.context ?? {},
    });
  } catch (e) {
    console.error("Audit log write failed:", e);
  }
}