import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminCheckResult = { isAdmin: boolean };

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCheckResult> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    const granted = Boolean(isAdmin);

    // Log the access check to the audit trail (best-effort; ignore errors)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("admin_audit_log").insert({
        action: granted ? "admin.access.granted" : "admin.access.denied",
        actor_user_id: context.userId,
        success: granted,
        context: {},
      });
    } catch {
      // Non-fatal
    }

    return { isAdmin: granted };
  });