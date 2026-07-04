import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listAdminProducts, saveProduct, deleteProduct, type AdminProduct } from "@/lib/admin-products.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/products")({
  head: () => ({ meta: [{ title: "Products · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: ProductsPage,
});

function money(c: number, cur: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(c / 100);
}

const empty = {
  slug: "", name: "", shortDescription: "", description: "",
  priceCents: 0, currency: "USD", imageUrl: "", deliveryType: "digital",
  active: true, featured: false,
};

function ProductsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "products"],
    queryFn: async () => {
      const res = await listAdminProducts();
      if ("error" in res) throw new Error(res.error);
      return res.products;
    },
  });

  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<AdminProduct | null>(null);

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const res = await saveProduct({ data: payload });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null); setCreating(false);
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteProduct({ data: { id } });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Deleted");
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">{data?.length ?? 0} products</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New product
        </button>
      </header>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</div>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((p) => (
          <Card key={p.id} className={p.active ? "" : "opacity-60"}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{p.slug}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold">{money(p.priceCents, p.currency)}</div>
                  <div className="flex items-center justify-end gap-1 text-[10px] uppercase">
                    {!p.active && <span className="rounded bg-muted px-1.5 py-0.5">inactive</span>}
                    {p.featured && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-600">featured</span>}
                  </div>
                </div>
              </div>
              {p.shortDescription && (
                <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{p.shortDescription}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(p)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => setToDelete(p)}
                  className="inline-flex items-center justify-center gap-1 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProductSheet
        open={creating || !!editing}
        onOpenChange={(v) => { if (!v) { setEditing(null); setCreating(false); } }}
        initial={editing ?? empty as any}
        saving={save.isPending}
        onSave={(payload) => save.mutate({ ...payload, id: editing?.id })}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && del.mutate(toDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProductSheet({
  open, onOpenChange, initial, saving, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: AdminProduct | typeof empty;
  saving: boolean;
  onSave: (p: any) => void;
}) {
  const [form, setForm] = useState<any>(initial);
  // reset when initial changes (via key trick)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} key={(initial as any).id ?? "new"}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{(initial as any).id ? "Edit product" : "New product"}</SheetTitle>
        </SheetHeader>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
        >
          <Field label="Name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Slug">
            <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (cents)">
              <input type="number" required min={0} value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: +e.target.value })} className={inputCls} />
            </Field>
            <Field label="Currency">
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Short description">
            <input value={form.shortDescription ?? ""} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Description">
            <textarea rows={4} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Image URL">
            <input value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Delivery type">
            <input value={form.deliveryType} onChange={(e) => setForm({ ...form, deliveryType: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}