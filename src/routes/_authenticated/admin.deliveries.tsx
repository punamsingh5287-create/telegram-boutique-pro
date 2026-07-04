import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { listFailedDeliveries, resendOrderDelivery, type FailedDelivery } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/admin/deliveries")({
  head: () => ({
    meta: [
      { title: "Failed deliveries · Mateo Store Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminDeliveriesPage,
});

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function AdminDeliveriesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "failed-deliveries"],
    queryFn: async () => {
      const res = await listFailedDeliveries();
      if ("error" in res) throw new Error(res.error);
      return res.orders;
    },
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: async (orderId: string) => {
      setBusyId(orderId);
      const res = await resendOrderDelivery({ data: { orderId } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Delivery sent (${res.attempts} attempt${res.attempts === 1 ? "" : "s"})`);
      qc.invalidateQueries({ queryKey: ["admin", "failed-deliveries"] });
    },
    onError: (err: Error) => toast.error(err.message || "Resend failed"),
    onSettled: () => setBusyId(null),
  });

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <div className="relative mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gold">Admin</p>
            <h1 className="mt-1 text-3xl font-semibold text-foreground">Failed deliveries</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paid orders where the Telegram DM did not go through. License keys are already claimed and stored — resend to redeliver.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-foreground hover:bg-white/5"
          >
            Refresh
          </button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && data.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center">
            <p className="text-lg font-medium text-foreground">All caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">No orders are pending redelivery.</p>
          </div>
        )}

        {data && data.length > 0 && (
          <ul className="space-y-3">
            {data.map((o: FailedDelivery) => (
              <li key={o.id} className="glass rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-muted-foreground">
                        #{o.shortId}
                      </span>
                      <span className="text-sm text-foreground">{formatMoney(o.totalCents, o.currency)}</span>
                      <span className="text-xs text-muted-foreground">
                        · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Chat <code className="text-foreground">{o.chatId ?? "—"}</code> · Attempts {o.deliveryAttempts} ·{" "}
                      Paid {o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"}
                    </p>
                    {o.lastError && (
                      <p className="mt-2 break-words text-xs text-destructive">{o.lastError}</p>
                    )}
                  </div>
                  <button
                    onClick={() => resend.mutate(o.id)}
                    disabled={busyId === o.id || !o.chatId}
                    className="shrink-0 rounded-lg bg-gradient-royal px-4 py-2 text-sm font-medium text-primary-foreground shadow-royal disabled:opacity-60"
                  >
                    {busyId === o.id ? "Resending…" : "Resend delivery"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}