import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listAdminProducts, saveProduct, deleteProduct, getProductStock, addDigitalAssets, type AdminProduct } from "@/lib/admin-products.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Pencil, Plus, Trash2, Sparkles } from "lucide-react";
import { TgEmoji } from "@/components/ui/tg-emoji";
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
  slug: "", name: "", emoji: "", customEmojiId: "", shortDescription: "", description: "",
  priceCents: 0, currency: "USD", imageUrl: "", deliveryType: "license_key",
  active: true, featured: false,
};

const btnPrimary = "btn-premium";
const btnGhost = "btn-ghost-color";
const btnDanger = "btn-danger";

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
          <h1 className="truncate text-2xl font-bold">
            <TgEmoji animated variant="gold">💎</TgEmoji> Products
          </h1>
          <p className="text-sm text-muted-foreground">
            <TgEmoji variant="gold">✨</TgEmoji> {data?.length ?? 0} products in your catalog
          </p>
        </div>
        <button onClick={() => setCreating(true)} className={btnPrimary}>
          <TgEmoji>➕</TgEmoji> New product
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
                <button onClick={() => setEditing(p)} className={btnGhost + " flex-1"}>
                  <TgEmoji>✏️</TgEmoji> Edit
                </button>
                <button onClick={() => setToDelete(p)} className={btnDanger}>
                  <TgEmoji>🗑️</TgEmoji>
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
            <AlertDialogTitle><TgEmoji>🗑️</TgEmoji> Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel><TgEmoji>✖️</TgEmoji> Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && del.mutate(toDelete.id)}
              className="btn-danger"
            >
              <TgEmoji>🗑️</TgEmoji> Delete
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
  const priceMajor = ((form.priceCents ?? 0) / 100).toString();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} key={(initial as any).id ?? "new"}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {(initial as any).id
              ? <><TgEmoji>✏️</TgEmoji> Edit product</>
              : <><TgEmoji animated variant="gold">💎</TgEmoji> Add new product</>}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Fill product details below and hit save — it goes live instantly. <TgEmoji variant="gold">✨</TgEmoji>
          </p>
        </SheetHeader>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
        >
          <Field label={<><TgEmoji>🏷️</TgEmoji> Product name</>} hint="Displayed to customers">
            <input required placeholder="Premium Course Bundle" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
            <Field label={<><TgEmoji>😀</TgEmoji> Emoji</>} hint="e.g. 💎">
              <input maxLength={8} placeholder="💎" value={form.emoji ?? ""} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className={inputCls + " text-center text-lg"} />
            </Field>
            <Field label={<><TgEmoji variant="gold">✨</TgEmoji> Custom emoji ID</>} hint="Telegram Premium animated emoji ID (optional)">
              <input placeholder="5368324170671202286" value={form.customEmojiId ?? ""} onChange={(e) => setForm({ ...form, customEmojiId: e.target.value })} className={inputCls + " font-mono text-xs"} />
            </Field>
          </div>
          <Field label={<><TgEmoji>🔗</TgEmoji> Slug</>} hint="URL identifier, lowercase, no spaces">
            <input required placeholder="premium-course" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={<><TgEmoji>💵</TgEmoji> Price</>} hint="e.g. 9.99">
              <input type="number" step="0.01" required min={0} value={priceMajor}
                onChange={(e) => setForm({ ...form, priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                className={inputCls} placeholder="0.00" />
            </Field>
            <Field label={<><TgEmoji>💱</TgEmoji> Currency</>}>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                <option value="USD">🇺🇸 USD</option>
                <option value="INR">🇮🇳 INR</option>
                <option value="EUR">🇪🇺 EUR</option>
                <option value="GBP">🇬🇧 GBP</option>
              </select>
            </Field>
          </div>
          <Field label={<><TgEmoji>✍️</TgEmoji> Short description</>} hint="One-liner shown in product cards">
            <input placeholder="A short catchy tagline" value={form.shortDescription ?? ""} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className={inputCls} />
          </Field>
          <Field label={<><TgEmoji>📄</TgEmoji> Full description</>} hint="HTML supported in Telegram bot">
            <textarea rows={5} placeholder="What does this product include?" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </Field>
          <Field label={<><TgEmoji>🖼️</TgEmoji> Cover image URL</>} hint="Public https:// image link">
            <input placeholder="https://…" value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} className={inputCls} />
            {form.imageUrl && (
              <img src={form.imageUrl} alt="preview" className="mt-2 h-24 w-24 rounded-md border object-cover" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
            )}
          </Field>
          <Field label={<><TgEmoji>🚚</TgEmoji> Delivery type</>}>
            <select value={form.deliveryType} onChange={(e) => setForm({ ...form, deliveryType: e.target.value })} className={inputCls}>
              <option value="license_key">🔑 License key</option>
              <option value="file">💾 Digital file / link</option>
              <option value="text">📝 Text payload</option>
            </select>
          </Field>
          {(initial as any).id && (
            <LicenseKeysSection productId={(initial as any).id} />
          )}
          <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> <TgEmoji>✅</TgEmoji> Active
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> <TgEmoji variant="gold">⭐</TgEmoji> Featured
            </label>
          </div>
          <div className="sticky bottom-0 -mx-6 mt-6 border-t bg-background/95 px-6 py-3 backdrop-blur">
            <button type="submit" disabled={saving} className={btnPrimary + " w-full py-2.5 text-base"}>
              {saving ? <><TgEmoji>⏳</TgEmoji> Saving…</> : <><TgEmoji animated>💾</TgEmoji> Save product</>}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 focus:border-fuchsia-500/60";
function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}