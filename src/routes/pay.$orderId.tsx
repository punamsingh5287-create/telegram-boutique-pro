import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useMemo } from "react";
import { getOrderForCheckout, createOrderCheckoutSession, type OrderSummary } from "@/lib/orders.functions";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

const orderQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["checkout-order", orderId],
    queryFn: async () => {
      const res = await getOrderForCheckout({ data: { orderId } });
      if ("error" in res) throw new Error(res.error);
      return res.order;
    },
    staleTime: 15_000,
  });

export const Route = createFileRoute("/pay/$orderId")({
  head: () => ({
    meta: [
      { title: "Secure Checkout · Mateo Store" },
      { name: "description", content: "Complete your Mateo Store purchase securely." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(orderQuery(params.orderId));
    } catch {
      throw notFound();
    }
  },
  errorComponent: ({ error, reset }) => (
    <CheckoutShell>
      <div className="glass rounded-2xl p-8 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Checkout unavailable</h1>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
        <button onClick={reset} className="mt-6 rounded-lg bg-gradient-royal px-5 py-2 font-medium text-primary-foreground">
          Try again
        </button>
      </div>
    </CheckoutShell>
  ),
  notFoundComponent: () => (
    <CheckoutShell>
      <div className="glass rounded-2xl p-8 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Order not found</h1>
        <p className="mt-2 text-muted-foreground">This checkout link is invalid or has expired.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg border border-white/10 px-5 py-2 text-sm text-foreground">
          Return home
        </Link>
      </div>
    </CheckoutShell>
  ),
  component: PayPage,
});

function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <PaymentTestModeBanner />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-[400px] w-[400px] rounded-full bg-gold/10 blur-[140px]" />
      <div className="relative mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function OrderSummaryCard({ order }: { order: OrderSummary }) {
  return (
    <aside className="glass h-fit rounded-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Order summary</h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-muted-foreground">
          #{order.id.slice(0, 8)}
        </span>
      </div>
      <ul className="space-y-3">
        {order.items.map((item, idx) => (
          <li key={idx} className="flex items-start justify-between gap-3 border-b border-white/5 pb-3 last:border-0">
            <div>
              <p className="text-sm font-medium text-foreground">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.quantity} × {formatMoney(item.unitPriceCents, order.currency)}
              </p>
            </div>
            <p className="text-sm text-foreground">{formatMoney(item.lineTotalCents, order.currency)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-sm text-muted-foreground">Total</span>
        <span className="text-xl font-semibold text-gold">{formatMoney(order.totalCents, order.currency)}</span>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Digital delivery on Telegram immediately after payment confirms.
      </p>
    </aside>
  );
}

function PayPage() {
  const { orderId } = Route.useParams();
  const { data: order } = useSuspenseQuery(orderQuery(orderId));

  const fetchClientSecret = useMemo(
    () => async () => {
      const returnUrl = `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`;
      const res = await createOrderCheckoutSession({
        data: { orderId, returnUrl, environment: getStripeEnvironment() },
      });
      if ("error" in res) throw new Error(res.error);
      if (!res.clientSecret) throw new Error("Stripe did not return a client secret");
      return res.clientSecret;
    },
    [orderId],
  );

  if (order.status !== "pending") {
    return (
      <CheckoutShell>
        <div className="glass rounded-2xl p-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {order.status === "paid" || order.status === "delivered" ? "Already paid" : `Order ${order.status}`}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {order.status === "paid" || order.status === "delivered"
              ? "Check your Telegram DMs — your delivery is on the way."
              : "This order can no longer be paid. Please start a new order in Telegram."}
          </p>
          <a
            href="https://t.me/Mateotrussttbot"
            className="mt-6 inline-block rounded-lg bg-gradient-royal px-5 py-2 font-medium text-primary-foreground shadow-royal"
          >
            Open Mateo Store
          </a>
        </div>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell>
      <div className="mb-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Secure checkout</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Complete your purchase</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Payment is processed by Stripe. Your card details never touch our servers.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="glass overflow-hidden rounded-2xl p-2">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
        <OrderSummaryCard order={order} />
      </div>
    </CheckoutShell>
  );
}