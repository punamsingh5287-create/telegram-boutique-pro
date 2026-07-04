import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in · Mateo Store Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/admin/deliveries" });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/admin/deliveries" });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
      <form onSubmit={onSubmit} className="glass relative w-full max-w-sm rounded-2xl p-8 space-y-4">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-gold">Mateo Store</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Admin sign in</h1>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Email</span>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-background/40 px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Password</span>
          <input
            type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-background/40 px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none"
          />
        </label>
        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg bg-gradient-royal px-4 py-2 text-sm font-medium text-primary-foreground shadow-royal disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}