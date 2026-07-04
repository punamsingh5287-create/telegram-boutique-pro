import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats, type DashboardStats } from "@/lib/admin-dashboard.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  ShoppingBag,
  Clock,
  XCircle,
  CheckCircle2,
  Users,
  TrendingUp,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Mateo Store Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DashboardPage,
});

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function relTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    delivered: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20",
    refunded: "bg-muted text-muted-foreground",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function DashboardPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: async () => {
      const res = await getDashboardStats();
      if ("error" in res) throw new Error(res.error);
      return res as DashboardStats;
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Store performance at a glance</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {isLoading && <div className="text-sm text-muted-foreground">Loading stats…</div>}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          {/* Revenue */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Revenue today" value={money(data.revenue.today, data.currency)} icon={DollarSign} tone="emerald" />
            <StatCard label="Revenue 7d" value={money(data.revenue.week, data.currency)} icon={TrendingUp} tone="blue" />
            <StatCard label="Revenue 30d" value={money(data.revenue.month, data.currency)} icon={TrendingUp} tone="indigo" />
            <StatCard label="Lifetime revenue" value={money(data.revenue.lifetime, data.currency)} icon={DollarSign} tone="violet" />
          </section>

          {/* Orders + Users */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="Total orders" value={String(data.orders.total)} icon={ShoppingBag} />
            <StatCard label="Paid" value={String(data.orders.paid)} icon={CheckCircle2} tone="emerald" />
            <StatCard label="Pending" value={String(data.orders.pending)} icon={Clock} tone="amber" />
            <StatCard label="Failed" value={String(data.orders.failed)} icon={XCircle} tone="red" />
            <StatCard label="Users" value={String(data.users.total)} icon={Users} />
            <StatCard label="New (7d)" value={`+${data.users.new7d}`} icon={Users} tone="blue" />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Recent orders</CardTitle>
                <Link to="/admin/orders" className="text-xs text-primary hover:underline">
                  View all →
                </Link>
              </CardHeader>
              <CardContent>
                {data.recentOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 text-left font-medium">Order</th>
                          <th className="py-2 text-left font-medium">Status</th>
                          <th className="py-2 text-right font-medium">Total</th>
                          <th className="py-2 text-right font-medium">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentOrders.map((o) => (
                          <tr key={o.id} className="border-t">
                            <td className="py-2">
                              <Link
                                to="/admin/orders/$orderId"
                                params={{ orderId: o.id }}
                                className="font-mono text-xs text-primary hover:underline"
                              >
                                {o.id.slice(0, 8)}
                              </Link>
                              {o.chatId && (
                                <div className="text-[11px] text-muted-foreground">chat {o.chatId}</div>
                              )}
                            </td>
                            <td className="py-2">
                              <span className={`rounded border px-2 py-0.5 text-[11px] capitalize ${statusBadge(o.status)}`}>
                                {o.status}
                              </span>
                            </td>
                            <td className="py-2 text-right font-medium">
                              {money(o.totalCents, o.currency)}
                            </td>
                            <td className="py-2 text-right text-xs text-muted-foreground">
                              {relTime(o.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Best sellers (90d)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.bestSellers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales yet.</p>
                ) : (
                  data.bestSellers.map((p, i) => (
                    <div key={p.productId} className="flex items-center gap-3">
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-muted text-xs font-semibold">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.unitsSold} sold · {money(p.revenueCents, data.currency)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone?: "emerald" | "blue" | "amber" | "red" | "indigo" | "violet";
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600",
    blue: "bg-blue-500/10 text-blue-600",
    amber: "bg-amber-500/10 text-amber-600",
    red: "bg-red-500/10 text-red-600",
    indigo: "bg-indigo-500/10 text-indigo-600",
    violet: "bg-violet-500/10 text-violet-600",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${tones[tone ?? ""] ?? "bg-muted text-foreground"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}