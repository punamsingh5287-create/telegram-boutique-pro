import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TgEmoji } from "@/components/ui/tg-emoji";
import { Trash2, Plus, Sparkles } from "lucide-react";
import {
  getBotConfigAdmin,
  saveBotConfigAdmin,
  type BotConfig,
} from "@/lib/admin-bot-config.functions";

export const Route = createFileRoute("/_authenticated/admin/bot")({
  head: () => ({ meta: [{ title: "Bot content · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: BotPage,
});

const BUTTON_ORDER = [
  "shop", "trending", "orders", "products",
  "coupons", "profile", "support", "news",
] as const;

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 focus:border-fuchsia-500/60";

function applyMap(text: string, map: Record<string, string>): string {
  const entries = Object.entries(map ?? {}).filter(([e, id]) => e && id && id.trim());
  if (!entries.length) return text;
  entries.sort((a, b) => b[0].length - a[0].length);
  const parts = text.split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = part;
      for (const [emoji, id] of entries) {
        if (!out.includes(emoji)) continue;
        out = out.split(emoji).join(`<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`);
      }
      return out;
    })
    .join("");
}

function PreviewHtml({ html }: { html: string }) {
  // Strip <tg-emoji> tags for web preview — browsers can't render them,
  // but Telegram will. Keep the fallback emoji visible.
  const web = html.replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/g, "$1");
  return (
    <div
      className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-sm dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: web }}
    />
  );
}

function BotPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "bot-config"],
    queryFn: async () => {
      const res = await getBotConfigAdmin();
      if ("error" in res) throw new Error(res.error);
      return res.config;
    },
  });

  const [form, setForm] = useState<BotConfig | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const res = await saveBotConfigAdmin({ data: form });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Bot content saved");
      qc.invalidateQueries({ queryKey: ["admin", "bot-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emojiRows = useMemo(() => Object.entries(form?.emoji_map ?? {}), [form?.emoji_map]);
  const previewWelcome = useMemo(
    () => (form ? applyMap(form.welcome_text, form.emoji_map) : ""),
    [form?.welcome_text, form?.emoji_map],
  );

  if (isLoading || !form) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-muted-foreground">Loading bot content…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  const updateEmojiRow = (idx: number, key: "emoji" | "id", value: string) => {
    const rows = [...emojiRows];
    const cur = rows[idx] ?? ["", ""];
    rows[idx] = key === "emoji" ? [value, cur[1]] : [cur[0], value];
    const map: Record<string, string> = {};
    for (const [e, v] of rows) if (e) map[e] = v;
    setForm({ ...form, emoji_map: map });
  };
  const removeEmojiRow = (idx: number) => {
    const rows = emojiRows.filter((_, i) => i !== idx);
    const map: Record<string, string> = {};
    for (const [e, v] of rows) if (e) map[e] = v;
    setForm({ ...form, emoji_map: map });
  };
  const addEmojiRow = () => setForm({ ...form, emoji_map: { ...form.emoji_map, "": "" } });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <TgEmoji animated variant="gold">💎</TgEmoji> Bot content
        </h1>
        <p className="text-sm text-muted-foreground">
          Edit welcome text, buttons, and the plain-emoji → premium-emoji map. Any plain emoji you list
          below will automatically render as its Telegram Premium version wherever the bot sends it.
        </p>
      </header>

      {/* Emoji map — the star of the show */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-fuchsia-500" /> Premium emoji map
          </CardTitle>
          <button type="button" onClick={addEmojiRow} className="btn-ghost-color">
            <Plus className="h-4 w-4" /> Add
          </button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Paste a plain emoji on the left (e.g. 💎) and its Telegram <code>custom_emoji_id</code> on
            the right. Get IDs by forwarding a premium emoji to <code>@idstickerbot</code>.
          </p>
          {emojiRows.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No mappings yet. Click <b>Add</b> to create one.
            </p>
          )}
          {emojiRows.map(([emoji, id], idx) => (
            <div key={idx} className="grid grid-cols-[80px_1fr_auto] gap-2">
              <input
                value={emoji}
                onChange={(e) => updateEmojiRow(idx, "emoji", e.target.value)}
                placeholder="💎"
                className={inp + " text-center text-lg"}
                maxLength={8}
              />
              <input
                value={id}
                onChange={(e) => updateEmojiRow(idx, "id", e.target.value)}
                placeholder="5368324170671202286"
                className={inp + " font-mono"}
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => removeEmojiRow(idx)}
                className="btn-danger"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Welcome text */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><TgEmoji>👋</TgEmoji> Welcome message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            HTML supported. Use <code>{"{name_line}"}</code> to insert the user's name.
          </p>
          <textarea
            rows={8}
            value={form.welcome_text}
            onChange={(e) => setForm({ ...form, welcome_text: e.target.value })}
            className={inp + " font-mono text-xs"}
          />
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Preview (Telegram will animate mapped emojis)
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <PreviewHtml html={previewWelcome} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
              Footer (optional)
            </label>
            <input
              value={form.welcome_footer}
              onChange={(e) => setForm({ ...form, welcome_footer: e.target.value })}
              className={inp}
              placeholder="Powered by ✨ Mateo Store"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
                Support handle
              </label>
              <input
                value={form.support_handle}
                onChange={(e) => setForm({ ...form, support_handle: e.target.value })}
                className={inp}
                placeholder="MateoSupport"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
                Admin Telegram IDs (comma separated)
              </label>
              <input
                value={form.admin_ids.join(", ")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    admin_ids: e.target.value
                      .split(/[,\s]+/)
                      .map((s) => parseInt(s.trim(), 10))
                      .filter((n) => Number.isFinite(n) && n > 0),
                  })
                }
                className={inp + " font-mono"}
                placeholder="123456789, 987654321"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><TgEmoji>🎛️</TgEmoji> Menu buttons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Telegram inline buttons show plain text only — animated emojis don't render in button
            labels. The fallback emoji here is what users see on the button.
          </p>
          <div className="grid grid-cols-[60px_1fr] gap-x-3 gap-y-2 text-xs font-semibold uppercase text-muted-foreground">
            <div>Emoji</div>
            <div>Label</div>
          </div>
          {BUTTON_ORDER.map((key) => {
            const b = form.buttons[key] ?? { label: key, emoji: "•" };
            return (
              <div key={key} className="grid grid-cols-[60px_1fr] gap-3">
                <input
                  value={b.emoji}
                  onChange={(e) =>
                    setForm({ ...form, buttons: { ...form.buttons, [key]: { ...b, emoji: e.target.value } } })
                  }
                  className={inp + " text-center"}
                  maxLength={4}
                />
                <input
                  value={b.label}
                  onChange={(e) =>
                    setForm({ ...form, buttons: { ...form.buttons, [key]: { ...b, label: e.target.value } } })
                  }
                  className={inp}
                  placeholder={key}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-premium px-6 py-2.5 text-base shadow-lg"
        >
          {save.isPending ? "Saving…" : "💾 Save bot content"}
        </button>
      </div>
    </div>
  );
}