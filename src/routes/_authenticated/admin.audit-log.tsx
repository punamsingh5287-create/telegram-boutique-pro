import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listAuditLog, type AuditRow } from "@/lib/audit.functions";

const searchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(10).max(100), 25).default(25),
  result: fallback(z.enum(["all", "success", "failure", "pending"]), "all").default("all"),
  action: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/admin/audit-log")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Audit log · Mateo Store Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuditLogPage,
});

function AuditLogPage() {
  const { page, pageSize, result, action } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "audit-log", { page, pageSize, result, action }],
    queryFn: async () => {
      const res = await listAuditLog({ data: { page, pageSize, result, action } });
      if ("error" in res) throw new Error(res.error);
      return res;
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const setSearch = (patch: Partial<{ page: number; pageSize: number; result: typeof result; action: string }>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch }) });

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <div className="relative mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gold">Admin</p>
            <h1 className="mt-1 text-3xl font-semibold text-foreground">Audit log</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Delivery resends, DM outcomes, and handler errors — most recent first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/deliveries"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-foreground hover:bg-white/5"
            >
              Deliveries
            </Link>
            <button
              onClick={() => refetch()}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-foreground hover:bg-white/5"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Result</span>
            {(["all", "success", "failure", "pending"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setSearch({ result: r, page: 1 })}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  result === r
                    ? "bg-primary text-primary-foreground"
                    : "border border-white/10 text-muted-foreground hover:bg-white/5"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Action</span>
            <input
              value={action}
              onChange={(e) => setSearch({ action: e.target.value, page: 1 })}
              placeholder="filter action (e.g. delivery.resend)"
              className="flex-1 rounded-md border border-white/10 bg-transparent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-white/30 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Per page</span>
            <select
              value={pageSize}
              onChange={(e) => setSearch({ pageSize: Number(e.target.value), page: 1 })}
              className="rounded-md border border-white/10 bg-background px-2 py-1 text-sm text-foreground"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && data.rows.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center">
            <p className="text-lg font-medium text-foreground">No matching entries</p>
            <p className="mt-1 text-sm text-muted-foreground">Try changing the filters.</p>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <>
            <div className="glass overflow-hidden rounded-2xl">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Result</th>
                    <th className="px-4 py-2.5">Order</th>
                    <th className="px-4 py-2.5">Attempts</th>
                    <th className="px-4 py-2.5">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: AuditRow) => (
                    <tr key={r.id} className="border-t border-white/5 align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-foreground">{r.action}</code>
                      </td>
                      <td className="px-4 py-3">
                        <ResultBadge success={r.success} permanent={r.permanent} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.orderId ? <code className="text-foreground">{r.orderId.slice(0, 8)}</code> : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.attempts ?? "—"}</td>
                      <td className="max-w-[420px] px-4 py-3 text-xs">
                        {r.error && <p className="break-words text-destructive">{r.error}</p>}
                        {r.context && Object.keys(r.context).length > 0 && (
                          <pre className="mt-1 overflow-x-auto rounded bg-white/[0.03] p-2 text-[11px] text-muted-foreground">
                            {JSON.stringify(r.context, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Page {data.page} of {totalPages} · {data.total} entr{data.total === 1 ? "y" : "ies"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSearch({ page: Math.max(1, page - 1) })}
                  disabled={page <= 1 || isFetching}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-foreground hover:bg-white/5 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setSearch({ page: Math.min(totalPages, page + 1) })}
                  disabled={page >= totalPages || isFetching}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-foreground hover:bg-white/5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultBadge({ success, permanent }: { success: boolean | null; permanent: boolean | null }) {
  if (success === true) {
    return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">success</span>;
  }
  if (success === false) {
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
        {permanent ? "permanent" : "failure"}
      </span>
    );
  }
  return <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">pending</span>;
}