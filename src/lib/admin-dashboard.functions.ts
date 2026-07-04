import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardStats = {
  revenue: { today: number; week: number; month: number; lifetime: number };
  orders: { total: number; paid: number; pending: number; failed: number; delivered: number };
  users: { total: number; new7d: number };
  currency: string;
  recentOrders: Array<{
    id: string;
    status: string;
    totalCents: number;
    currency: string;
    createdAt: string;
    chatId: number | null;
  }>;
  bestSellers: Array<{
    productId: string;
    name: string;
    unitsSold: number;
    revenueCents: number;
  }>;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats | { error: string }> => {
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch paid orders (for revenue) — cap to sane limit
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("id,total_cents,currency,paid_at,status,chat_id,created_at")
      .in("status", ["paid", "delivered"])
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(5000);

    const rev = { today: 0, week: 0, month: 0, lifetime: 0 };
    let currency = "USD";
    for (const o of paidOrders ?? []) {
      const paid = o.paid_at ? new Date(o.paid_at) : null;
      if (!paid) continue;
      currency = o.currency || currency;
      rev.lifetime += o.total_cents;
      if (paid >= monthAgo) rev.month += o.total_cents;
      if (paid >= weekAgo) rev.week += o.total_cents;
      if (paid >= startOfDay) rev.today += o.total_cents;
    }

    // Order status counts
    const statuses = ["paid", "pending", "failed", "delivered"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        counts[s] = count ?? 0;
      }),
    );
    const { count: totalOrders } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true });

    // Users
    const { count: totalUsers } = await supabaseAdmin
      .from("telegram_users")
      .select("telegram_id", { count: "exact", head: true });
    const { count: newUsers } = await supabaseAdmin
      .from("telegram_users")
      .select("telegram_id", { count: "exact", head: true })
      .gte("created_at", weekAgo.toISOString());

    // Recent orders
    const { data: recent } = await supabaseAdmin
      .from("orders")
      .select("id,status,total_cents,currency,created_at,chat_id")
      .order("created_at", { ascending: false })
      .limit(10);

    // Best sellers (last 90 days)
    const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("product_id,product_name_snapshot,quantity,unit_price_cents,orders!inner(status,paid_at)")
      .in("orders.status", ["paid", "delivered"])
      .gte("orders.paid_at", ninetyAgo)
      .limit(5000);

    const bestMap = new Map<string, { name: string; units: number; revenue: number }>();
    for (const it of (items ?? []) as any[]) {
      const key = it.product_id ?? it.product_name_snapshot;
      const cur = bestMap.get(key) ?? { name: it.product_name_snapshot, units: 0, revenue: 0 };
      cur.units += it.quantity;
      cur.revenue += it.quantity * it.unit_price_cents;
      bestMap.set(key, cur);
    }
    const bestSellers = Array.from(bestMap.entries())
      .map(([productId, v]) => ({ productId, name: v.name, unitsSold: v.units, revenueCents: v.revenue }))
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5);

    return {
      revenue: rev,
      orders: {
        total: totalOrders ?? 0,
        paid: counts.paid ?? 0,
        pending: counts.pending ?? 0,
        failed: counts.failed ?? 0,
        delivered: counts.delivered ?? 0,
      },
      users: { total: totalUsers ?? 0, new7d: newUsers ?? 0 },
      currency,
      recentOrders: (recent ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        totalCents: r.total_cents,
        currency: r.currency,
        createdAt: r.created_at,
        chatId: r.chat_id,
      })),
      bestSellers,
    };
  });