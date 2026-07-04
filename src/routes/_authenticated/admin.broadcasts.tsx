import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listBroadcasts, sendBroadcast } from "@/lib/admin-broadcasts.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Megaphone, Send } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/broadcasts")({
  head: () => ({ meta: [{ title: "Broadcasts · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: BroadcastsPage,
});

function BroadcastsPage() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<"all" | "paid_customers">("all");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "broadcasts"],
    queryFn: async () => {
      const res = await listBroadcasts();
      if ("error" in res) throw new Error(res.error);
      return res.broadcasts;
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const res = await sendBroadcast({ data: { message, target } });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Sent to ${res.sent} recipients${res.failed ? `, ${res.failed} failed` : ""}`);
      setMessage(""); setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] });
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmOpen(false); },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Broadcasts</h1>
        <p className="text-sm text-muted-foreground">Send a Telegram message to your users</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-4 w-4" /> New broadcast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={message} onChange={(e) => setMessage(e.target.value)}
            rows={6} maxLength={4000}
            placeholder="Type your message (HTML supported: <b>, <i>, <a href>…)"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Send to:</span>
              <select
                value={target} onChange={(e) => setTarget(e.target.value as any)}
                className="rounded-md border bg-background px-2 py-1 text-sm"
              >
                <option value="all">All users</option>
                <option value="paid_customers">Paid customers only</option>
              </select>
            </div>
            <button
              disabled={!message.trim() || send.isPending}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {send.isPending ? "Sending…" : "Send broadcast"}
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No broadcasts yet.</p>
            )}
            {data?.map((b) => (
              <div key={b.id} className="space-y-1 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 capitalize ${
                    b.status === "sent" ? "bg-emerald-500/10 text-emerald-600" :
                    b.status === "failed" ? "bg-red-500/10 text-red-600" :
                    b.status === "sending" ? "bg-blue-500/10 text-blue-600" :
                    "bg-muted text-muted-foreground"
                  }`}>{b.status}</span>
                  <span className="text-muted-foreground">→ {b.target}</span>
                  <span className="ml-auto text-muted-foreground">
                    {b.sentCount} sent{b.failedCount ? `, ${b.failedCount} failed` : ""} · {new Date(b.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{b.message}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the message to {target === "all" ? "all Telegram users" : "paid customers only"}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={send.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending ? "Sending…" : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}