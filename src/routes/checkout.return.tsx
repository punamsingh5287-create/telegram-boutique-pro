import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/return")({
  head: () => ({
    meta: [
      { title: "Payment Received · Mateo Store" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    order_id: typeof search.order_id === "string" ? search.order_id : undefined,
  }),
  component: ReturnPage,
});

function ReturnPage() {
  const { session_id, order_id } = Route.useSearch();
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-[400px] w-[400px] rounded-full bg-gold/15 blur-[140px]" />
      <div className="relative mx-auto max-w-xl px-6 py-20">
        <div className="glass rounded-2xl p-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-royal text-3xl shadow-royal">
            ✓
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-gold">Payment received</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">Thank you!</h1>
          <p className="mt-3 text-muted-foreground">
            We're confirming your payment now. Your digital goods will be delivered on Telegram within a few seconds.
          </p>
          {order_id && (
            <p className="mt-4 text-xs text-muted-foreground">
              Order <span className="font-mono text-foreground/80">#{order_id.slice(0, 8)}</span>
              {session_id ? " · Confirmed" : ""}
            </p>
          )}
          <a
            href="https://t.me/Mateotrussttbot"
            className="mt-8 inline-block rounded-lg bg-gradient-royal px-6 py-3 font-medium text-primary-foreground shadow-royal"
          >
            Open Telegram
          </a>
          <div className="mt-4">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              Back to store
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}