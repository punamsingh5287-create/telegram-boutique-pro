import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPaymentStats, listPayments } from "@/lib/admin-payments.functions";
import { Card, CardContent } from "@/components/ui/card";
import { TgEmoji } from "@/components/ui/tg-emoji";

export const Route = createFileRoute("/_authenticated/admin/payments")({
  head: () => ({ meta: [{ title: "Payments · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: PaymentsPage,
});

function money(c: number, cur: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "USD").toUpperCase() }).format(c / 100);
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    delivered: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20",
    refunded: "bg-muted text-muted-foreground border-transparent",
  };
  return map[s] ?? "bg-muted text-muted-foreground border-transparent";
}

function PaymentsPage() {
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const statsQ = useQuery({
    queryKey: ["admin", "payments", "stats"],
    queryFn: async () => {
      const r = await getPaymentStats();
      if ("error" in r) throw new Error(r.error);
      return r;
    },
  });

  const listQ = useQuery({
    queryKey: ["admin", "payments", "list", { filter, page }],
    queryFn: async () => {
      const r = await listPayments({ data: { status: filter, page, pageSize: 25 } });
      if ("error" in r) throw new Error(r.error);
      return r;
    },
  });

  const s = statsQ.data;
  const rows = listQ.data?.payments ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">
          <TgEmoji animated variant="gold">💳</TgEmoji> Payments
        </h1>
        <p className="text-sm text-muted-foreground">
          <TgEmoji>📊</TgEmoji> Track revenue, transactions and gateway config
        </p>
      </header>

      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total revenue" value={money(s.totalCents, s.currency)} emoji="💰" />
          <Stat label="Today" value={money(s.todayCents, s.currency)} emoji="⚡" />
          <Stat label="Paid orders" value={String(s.paidCount)} emoji="✅" />
          <Stat label="Failed" value={String(s.failedCount)} emoji="❌" />
        </div>
      )}

      {s && (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="mb-2 font-semibold"><TgEmoji>⚙️</TgEmoji> Gateway configuration</div>
            <ConfigRow label="Stripe sandbox key" ok={s.sandboxConfigured} />
            <ConfigRow label="Stripe live key" ok={s.liveConfigured} note={s.liveConfigured ? undefined : "Complete Stripe go-live to accept real payments"} />
            <ConfigRow label="Webhook secret" ok={s.webhookConfigured} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "paid", "pending", "failed", "refunded"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "bg-background"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Order</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Env</th>
                  <th className="p-3">Chat</th>
                  <th className="p-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!listQ.isLoading && rows.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No transactions yet</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.orderId} className="border-b last:border-0">
                    <td className="p-3 font-mono text-xs">{r.orderId.slice(0, 8)}…</td>
                    <td className="p-3">
                      <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="p-3 font-semibold">{money(r.totalCents, r.currency)}</td>
                    <td className="p-3 text-xs uppercase text-muted-foreground">{r.environment}</td>
                    <td className="p-3 font-mono text-xs">{r.chatId ?? "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
              <span>Page {page} of {totalPages} · {total} total</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, emoji }: { label: string; value: string; emoji: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground"><TgEmoji>{emoji}</TgEmoji> {label}</div>
        <div className="mt-1 text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ConfigRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span>{label}</span>
      <span className={ok ? "text-emerald-600" : "text-amber-600"}>
        {ok ? "✅ Connected" : "⚠️ Not configured"}
        {note && <span className="ml-2 text-xs text-muted-foreground">— {note}</span>}
      </span>
    </div>
  );
}