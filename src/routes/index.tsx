import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mateo Store · Premium Digital Goods, Delivered Instantly" },
      {
        name: "description",
        content:
          "Mateo Store — a premium Telegram digital storefront. Software licenses, activation keys, and digital products delivered instantly on Telegram.",
      },
      { property: "og:title", content: "Mateo Store · Premium Digital Goods" },
      { property: "og:description", content: "Instant Telegram delivery. Secure checkout. Premium digital goods." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-primary/25 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-[500px] w-[500px] rounded-full bg-gold/15 blur-[140px]" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-royal shadow-royal">
            <span className="text-lg">💎</span>
          </div>
          <div>
            <div className="font-display text-xl leading-none">Mateo Store</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold">Premium Digital Goods</div>
          </div>
        </div>
        <nav className="hidden gap-2 md:flex">
          <Link to="/auth" className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Sign In
          </Link>
          <Link to="/auth" className="rounded-full bg-gradient-royal px-4 py-2 text-sm font-medium text-primary-foreground shadow-royal transition-transform hover:scale-[1.02]">
            Admin Dashboard
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16 md:pt-24">
        <div className="glass-panel mx-auto max-w-3xl rounded-3xl px-8 py-12 text-center shadow-elegant md:px-14 md:py-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-[0.25em] text-gold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            Now Live on Telegram
          </div>

          <h1 className="font-display text-5xl leading-[1.05] md:text-7xl">
            Premium digital goods,
            <br />
            <span className="text-gradient-gold">delivered in seconds.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
            Software licenses, activation keys, and premium digital products — browsed,
            purchased, and delivered instantly inside Telegram. Zero friction.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="https://t.me/Mateotrussttbot"
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-royal px-8 py-4 text-base font-medium text-primary-foreground shadow-royal transition-transform hover:scale-[1.03]"
            >
              <span>🚀</span>
              Open the Bot
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/5 px-8 py-4 text-base font-medium text-gold transition-colors hover:bg-gold/10"
            >
              <span>🔐</span>
              Admin Access
            </Link>
          </div>
        </div>

        {/* Feature grid */}
        <div className="mx-auto mt-16 grid max-w-5xl gap-4 md:grid-cols-3">
          {[
            { icon: "⚡", title: "Instant Delivery", body: "License keys and digital assets sent to your Telegram the moment payment clears." },
            { icon: "🔐", title: "Secure Checkout", body: "Payments processed by a PCI-compliant provider. Your card details never touch our servers." },
            { icon: "💎", title: "Curated Catalog", body: "Only premium, verified digital goods. Every product hand-selected." },
          ].map((f) => (
            <div key={f.title} className="glass-panel rounded-2xl p-6 transition-transform hover:-translate-y-0.5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-royal shadow-royal">
                <span className="text-xl">{f.icon}</span>
              </div>
              <h3 className="font-display text-xl">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Mateo Store · Premium Digital Goods
      </footer>
    </div>
  );
}
