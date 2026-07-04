import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAdminOrder } from "@/lib/admin-orders.functions";
import { resendOrderDelivery } from "@/lib/orders.functions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Order · Mateo Store Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OrderDetailDrawer,
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

function OrderDetailDrawer() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "order", orderId],
    queryFn: async () => {
      const res = await getAdminOrder({ data: { orderId } });
      if ("error" in res) throw new Error(res.error);
      return res.order;
    },
  });

  const resend = useMutation({
    mutationFn: async () => {
      const res = await resendOrderDelivery({ data: { orderId } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Delivery sent (${res.attempts} attempt${res.attempts === 1 ? "" : "s"})`);
      qc.invalidateQueries({ queryKey: ["admin", "order", orderId] });
      qc.invalidateQueries({ queryKey: ["admin", "orders"] });
    },
    onError: (err: Error) => toast.error(err.message || "Resend failed"),
  });

  const close = () => {
    setOpen(false);
    setTimeout(() => navigate({ to: "/admin/orders", search: (s: any) => s ?? {} }), 150);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">
            {orderId.slice(0, 8)}…
          </SheetTitle>
          <SheetDescription>Order details</SheetDescription>
        </SheetHeader>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <p className="mt-6 text-sm text-destructive">{(error as Error).message}</p>
        )}

        {data && (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs capitalize ${statusBadge(data.status)}`}>
                {data.status}
              </span>
              {data.environment && (
                <span className="rounded border bg-muted/50 px-2 py-0.5 text-xs">
                  {data.environment}
                </span>
              )}
              <span className="ml-auto text-sm font-semibold">
                {money(data.totalCents, data.currency)}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <Meta label="Chat ID" value={data.chatId ?? "—"} />
              <Meta label="Attempts" value={data.deliveryAttempts} />
              <Meta label="Created" value={new Date(data.createdAt).toLocaleString()} />
              <Meta label="Paid" value={data.paidAt ? new Date(data.paidAt).toLocaleString() : "—"} />
              <Meta label="Delivered" value={data.deliveredAt ? new Date(data.deliveredAt).toLocaleString() : "—"} />
              <Meta label="Notified" value={data.notifiedAt ? new Date(data.notifiedAt).toLocaleString() : "—"} />
            </dl>

            {data.lastError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="mb-1 font-medium">Last delivery error</div>
                {data.lastError}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Items ({data.items.length})
              </h3>
              <div className="divide-y rounded-md border">
                {data.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.quantity} × {money(i.unitPriceCents, data.currency)}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-medium">
                      {money(i.lineTotalCents, data.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {data.stripeSessionId && (
              <div className="space-y-1 text-xs">
                <div className="text-muted-foreground">Stripe session</div>
                <div className="break-all font-mono">{data.stripeSessionId}</div>
              </div>
            )}

            {(data.status === "paid" || data.status === "failed" || data.lastError) && data.chatId && (
              <button
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {resend.isPending ? "Resending…" : "Resend delivery to Telegram"}
              </button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}