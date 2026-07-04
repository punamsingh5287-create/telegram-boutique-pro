import { createFileRoute, Link, useNavigate, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listAdminOrders } from "@/lib/admin-orders.functions";
import { Search } from "lucide-react";

const searchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(10).max(100), 25).default(25),
  status: fallback(
    z.enum(["all", "pending", "paid", "delivered", "failed", "refunded"]),
    "all",
  ).default("all"),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/admin/orders")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Orders · Mateo Store Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OrdersPage,
});

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    delivered: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20",
    refunded: "bg-muted text-muted-foreground border-transparent",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-transparent";
}

function OrdersPage() {
  const { page, pageSize, status, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["admin", "orders", { page, pageSize, status, q }],
    queryFn: async () => {
      const res = await listAdminOrders({ data: { page, pageSize, status, q } });
      if ("error" in res) throw new Error(res.error);
      return res;
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${total} order${total === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            defaultValue={q}
            placeholder="Search by order id, chat id, or Stripe session…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const value = (e.target as HTMLInputElement).value.trim();
                navigate({ search: (s) => ({ ...s, q: value, page: 1 }) });
              }
            }}
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "pending", "paid", "delivered", "failed", "refunded"] as const).map((s) => (
            <button
              key={s}
              onClick={() => navigate({ search: (prev) => ({ ...prev, status: s, page: 1 }) })}
              className={
                "rounded-md border px-3 py-1.5 text-xs capitalize transition-colors " +
                (status === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Order</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Chat</th>
                <th className="px-3 py-2.5 text-right font-medium">Items</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-right font-medium">Created</th>
                <th className="px-3 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No orders match these filters.
                  </td>
                </tr>
              )}
              {data?.rows.map((o) => (
                <tr key={o.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] capitalize ${statusBadge(o.status)}`}>
                      {o.status}
                    </span>
                    {o.lastError && (
                      <div className="mt-1 max-w-[240px] truncate text-[11px] text-red-600" title={o.lastError}>
                        {o.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{o.chatId ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{o.itemCount}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {money(o.totalCents, o.currency)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="text-xs text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-xs text-muted-foreground">
          Page {page} of {totalPages} {isFetching && "· refreshing…"}
        </div>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => navigate({ search: (s) => ({ ...s, page: Math.max(1, page - 1) }) })}
            className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => navigate({ search: (s) => ({ ...s, page: page + 1 }) })}
            className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <Outlet />
    </div>
  );
}