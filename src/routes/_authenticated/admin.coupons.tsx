import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listCoupons, createCoupon, toggleCoupon, deleteCoupon } from "@/lib/admin-coupons.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/coupons")({
  head: () => ({ meta: [{ title: "Coupons · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: CouponsPage,
});

function CouponsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "coupons"],
    queryFn: async () => {
      const res = await listCoupons();
      if ("error" in res) throw new Error(res.error);
      return res.coupons;
    },
  });

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(10);
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await createCoupon({
        data: {
          code, discountType, discountValue,
          maxUses: maxUses ? Number(maxUses) : null,
          expiresAt: expiresAt || null,
        },
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Coupon created");
      setCode(""); setDiscountValue(10); setMaxUses(""); setExpiresAt("");
      qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const res = await toggleCoupon({ data: v });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteCoupon({ data: { id } });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Coupons</h1>
        <p className="text-sm text-muted-foreground">Discount codes for the Telegram bot</p>
      </header>

      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (code) create.mutate(); }}
            className="grid gap-3 sm:grid-cols-6"
          >
            <input
              required value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="CODE" className="sm:col-span-2 rounded-md border bg-background px-3 py-2 text-sm uppercase"
            />
            <select
              value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}
              className="rounded-md border bg-background px-2 py-2 text-sm"
            >
              <option value="percent">Percent %</option>
              <option value="fixed">Fixed (cents)</option>
            </select>
            <input
              type="number" min={1} required value={discountValue}
              onChange={(e) => setDiscountValue(+e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Value"
            />
            <input
              type="number" min={1} value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Max uses"
            />
            <input
              type="datetime-local" value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit" disabled={create.isPending}
              className="sm:col-span-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> {create.isPending ? "Creating…" : "Create coupon"}
            </button>
          </form>
        </CardContent>
      </Card>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</div>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Discount</th>
                  <th className="px-3 py-2 text-right font-medium">Uses</th>
                  <th className="px-3 py-2 text-right font-medium">Expires</th>
                  <th className="px-3 py-2 text-center font-medium">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No coupons yet</td></tr>
                )}
                {data?.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2 font-mono font-semibold">{c.code}</td>
                    <td className="px-3 py-2">{c.discountType === "percent" ? `${c.discountValue}%` : `${c.discountValue} cents off`}</td>
                    <td className="px-3 py-2 text-right">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                    <td className="px-3 py-2 text-right text-xs">{c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.active ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                      >
                        {c.active ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => { if (confirm(`Delete coupon ${c.code}?`)) del.mutate(c.id); }}
                        className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}