import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listAdminUsers, listAdminAccounts, grantAdmin, revokeAdmin } from "@/lib/admin-users.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, ShieldOff, UserPlus } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: UsersPage,
});

function money(c: number, cur = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(c / 100);
}

function UsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<{ userId: string; email: string | null } | null>(null);

  const users = useQuery({
    queryKey: ["admin", "telegram-users", q],
    queryFn: async () => {
      const res = await listAdminUsers({ data: { q } });
      if ("error" in res) throw new Error(res.error);
      return res.users;
    },
  });

  const admins = useQuery({
    queryKey: ["admin", "admin-accounts"],
    queryFn: async () => {
      const res: any = await listAdminAccounts();
      if ("error" in res) throw new Error(res.error);
      return res.admins as Array<{ userId: string; email: string | null; displayName: string | null; grantedAt: string }>;
    },
  });

  const grant = useMutation({
    mutationFn: async (email: string) => {
      const res = await grantAdmin({ data: { email } });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Admin granted");
      setGrantOpen(false); setGrantEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "admin-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      const res = await revokeAdmin({ data: { userId } });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Admin revoked");
      setRevokeTarget(null);
      qc.invalidateQueries({ queryKey: ["admin", "admin-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">Telegram customers and admin accounts</p>
        </div>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Admin accounts</CardTitle>
          <button onClick={() => setGrantOpen(true)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
            <UserPlus className="h-3 w-3" /> Grant admin
          </button>
        </CardHeader>
        <CardContent>
          {admins.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="divide-y rounded-md border">
              {(admins.data ?? []).map((a) => (
                <div key={a.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.email ?? a.displayName ?? a.userId}</div>
                    <div className="text-xs text-muted-foreground">granted {new Date(a.grantedAt).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={() => setRevokeTarget({ userId: a.userId, email: a.email })}
                    className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <ShieldOff className="h-3 w-3" /> Revoke
                  </button>
                </div>
              ))}
              {(admins.data?.length ?? 0) === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No admins yet</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telegram customers ({users.data?.length ?? 0})</CardTitle>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by username, name, telegram or chat id…"
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Telegram</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 text-right font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.telegramId} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "—"}</div>
                    {u.username && <div className="text-xs text-muted-foreground">@{u.username}</div>}
                    {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                    {u.isAdmin && <span className="mt-0.5 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">admin</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{u.telegramId}</td>
                  <td className="px-3 py-2 text-right">{u.orderCount}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(u.totalSpentCents)}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {(users.data?.length ?? 0) === 0 && !users.isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No users yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AlertDialog open={grantOpen} onOpenChange={setGrantOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant admin role</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the email of a user who has already signed up. They will get full admin access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="email"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => grantEmail && grant.mutate(grantEmail)}>
              Grant admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke admin?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.email ?? revokeTarget?.userId} will lose admin access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revoke.mutate(revokeTarget.userId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}