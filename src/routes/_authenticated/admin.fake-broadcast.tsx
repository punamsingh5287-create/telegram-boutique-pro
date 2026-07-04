import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getFakeConfig, saveFakeConfig, triggerFakeNow } from '@/lib/admin-fake-broadcast.functions';
import { Card, CardContent } from '@/components/ui/card';
import { TgEmoji } from '@/components/ui/tg-emoji';

export const Route = createFileRoute('/_authenticated/admin/fake-broadcast')({
  head: () => ({ meta: [{ title: 'Fake ads · Admin' }, { name: 'robots', content: 'noindex,nofollow' }] }),
  component: FakePage,
});

function FakePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'fake-broadcast'],
    queryFn: async () => {
      const r = await getFakeConfig();
      if ('error' in r) throw new Error(r.error);
      return r.config;
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [names, setNames] = useState('');
  const [templates, setTemplates] = useState('');
  const [maxRecipients, setMaxRecipients] = useState(500);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setNames(data.names.join('\n'));
    setTemplates(data.templates.join('\n'));
    setMaxRecipients(data.maxRecipients);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await saveFakeConfig({
        data: {
          enabled,
          names: names.split('\n').map((s) => s.trim()).filter(Boolean),
          templates: templates.split('\n').map((s) => s.trim()).filter(Boolean),
          maxRecipients,
        },
      });
      if (!r.ok) throw new Error(r.error ?? 'failed');
    },
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['admin', 'fake-broadcast'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const trigger = useMutation({
    mutationFn: async () => {
      const r = await triggerFakeNow();
      if (!r.ok) throw new Error(r.error ?? 'failed');
      return r;
    },
    onSuccess: (r) => {
      if (r.skipped) toast.info(`Skipped: ${r.skipped}`);
      else toast.success(`Sent to ${r.sent} chats (${r.failed} failed)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">
          <TgEmoji animated variant="gold">📣</TgEmoji> Fake purchase ads
        </h1>
        <p className="text-sm text-muted-foreground">
          Auto-broadcast random "someone just bought" messages every 2 hours to build social proof. Uses your real product list.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Card>
        <CardContent className="space-y-4 p-4">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div>
              <div className="font-semibold"><TgEmoji>⚡</TgEmoji> Auto-broadcast enabled</div>
              <div className="text-xs text-muted-foreground">Cron runs every 2 hours</div>
            </div>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" />
          </label>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold">
              <TgEmoji>👥</TgEmoji> Fake buyer names <span className="text-muted-foreground">(one per line)</span>
            </label>
            <textarea rows={6} value={names} onChange={(e) => setNames(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold">
              <TgEmoji>💬</TgEmoji> Message templates <span className="text-muted-foreground">— use {'{name}'}, {'{product}'}, {'{price}'}, {'{count}'}</span>
            </label>
            <textarea rows={6} value={templates} onChange={(e) => setTemplates(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold"><TgEmoji>📊</TgEmoji> Max recipients per run</label>
            <input type="number" min={1} max={10000} value={maxRecipients} onChange={(e) => setMaxRecipients(parseInt(e.target.value) || 500)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-2">
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-premium flex-1">
              {save.isPending ? '⏳ Saving…' : '💾 Save settings'}
            </button>
            <button onClick={() => trigger.mutate()} disabled={trigger.isPending} className="btn-ghost-color">
              {trigger.isPending ? '⏳ Sending…' : '🚀 Send test now'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}