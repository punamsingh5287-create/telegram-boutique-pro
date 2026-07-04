import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminUserRow = {
  telegramId: number;
  chatId: number | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  linkedUserId: string | null;
  createdAt: string;
  orderCount: number;
  totalSpentCents: number;
  isAdmin: boolean;
  email: string | null;
};

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q?: string }) => ({ q: (data?.q ?? "").trim().slice(0, 100) }))
  .handler(async ({ data, context }): Promise<{ users: AdminUserRow[] } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("telegram_users")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.q) {
      if (/^\d+$/.test(data.q)) q = q.or(`telegram_id.eq.${data.q},chat_id.eq.${data.q}`);
      else q = q.or(`username.ilike.%${data.q}%,first_name.ilike.%${data.q}%,last_name.ilike.%${data.q}%`);
    }
    const { data: users, error } = await q;
    if (error) return { error: error.message };

    // aggregate orders per chat
    const chatIds = (users ?? []).map((u: any) => u.chat_id).filter((x: any): x is number => typeof x === "number");
    const orderMap = new Map<number, { count: number; total: number }>();
    if (chatIds.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("chat_id,total_cents,status")
        .in("chat_id", chatIds)
        .in("status", ["paid", "delivered"]);
      for (const o of orders ?? []) {
        if (typeof o.chat_id !== "number") continue;
        const cur = orderMap.get(o.chat_id) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += o.total_cents;
        orderMap.set(o.chat_id, cur);
      }
    }

    // Admin flags + emails
    const linkedIds = (users ?? []).map((u: any) => u.linked_user_id).filter(Boolean) as string[];
    const adminSet = new Set<string>();
    const emailMap = new Map<string, string>();
    if (linkedIds.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("user_id,role")
        .in("user_id", linkedIds)
        .eq("role", "admin");
      for (const r of roles ?? []) adminSet.add(r.user_id);
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id,email")
        .in("id", linkedIds);
      for (const p of profs ?? []) if (p.email) emailMap.set(p.id, p.email);
    }

    return {
      users: (users ?? []).map((u: any) => {
        const agg = u.chat_id ? orderMap.get(u.chat_id) : undefined;
        return {
          telegramId: u.telegram_id,
          chatId: u.chat_id,
          username: u.username,
          firstName: u.first_name,
          lastName: u.last_name,
          linkedUserId: u.linked_user_id,
          createdAt: u.created_at,
          orderCount: agg?.count ?? 0,
          totalSpentCents: agg?.total ?? 0,
          isAdmin: u.linked_user_id ? adminSet.has(u.linked_user_id) : false,
          email: u.linked_user_id ? emailMap.get(u.linked_user_id) ?? null : null,
        };
      }),
    };
  });

export const listAdminAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id,role,created_at")
      .eq("role", "admin");
    const ids = (roles ?? []).map((r: any) => r.user_id);
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id,email,display_name").in("id", ids)
      : { data: [] as any[] };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return {
      admins: (roles ?? []).map((r: any) => ({
        userId: r.user_id,
        email: map.get(r.user_id)?.email ?? null,
        displayName: map.get(r.user_id)?.display_name ?? null,
        grantedAt: r.created_at,
      })),
    };
  });

export const grantAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) => ({ email: data.email.trim().toLowerCase() }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (!prof) return { ok: false, error: "No user with that email — ask them to sign up first" };
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: prof.id, role: "admin" }, { onConflict: "user_id,role" });
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "role.granted",
      actor_user_id: context.userId,
      success: true,
      context: { target_user_id: prof.id, role: "admin", email: data.email },
    });
    return { ok: true };
  });

export const revokeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    if (data.userId === context.userId) return { ok: false, error: "You cannot revoke your own admin role" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "role.revoked",
      actor_user_id: context.userId,
      success: true,
      context: { target_user_id: data.userId, role: "admin" },
    });
    return { ok: true };
  });