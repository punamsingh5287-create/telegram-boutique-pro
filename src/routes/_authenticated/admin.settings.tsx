import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStoreSettings, saveStoreSettings, type StoreSettings } from "@/lib/admin-settings.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Settings · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const res = await getStoreSettings();
      if ("error" in res) throw new Error(res.error);
      return res.settings;
    },
  });

  const [form, setForm] = useState<StoreSettings>({ name: "", welcome_message: "", default_currency: "USD" });
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await saveStoreSettings({ data: form });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Store branding and defaults</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Store</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
              className="space-y-4"
            >
              <Field label="Store name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
              </Field>
              <Field label="Welcome message (Telegram)">
                <textarea rows={3} value={form.welcome_message} onChange={(e) => setForm({ ...form, welcome_message: e.target.value })} className={inp} />
              </Field>
              <Field label="Default currency">
                <input value={form.default_currency} onChange={(e) => setForm({ ...form, default_currency: e.target.value.toUpperCase() })} className={inp} maxLength={3} />
              </Field>
              <button
                type="submit" disabled={save.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const inp = "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}