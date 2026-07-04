import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getPaymentConfig,
  savePaymentConfig,
  testBinancePay,
  DEFAULT_PAYMENT_CONFIG,
  type PaymentConfig,
  type CryptoConfig,
} from "@/lib/payment-config.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/payments-config")({
  head: () => ({ meta: [{ title: "Payment Config · Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: PaymentsConfigPage,
});

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function SectionHeader({
  title,
  emoji,
  enabled,
  onToggle,
  description,
}: {
  title: string;
  emoji: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <CardTitle className="text-base">
          <span className="mr-2">{emoji}</span>
          {title}
        </CardTitle>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={enabled ? "text-emerald-600" : "text-muted-foreground"}>
          {enabled ? "Enabled" : "Off"}
        </span>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}

function CryptoSection({
  title,
  emoji,
  network,
  apiHint,
  value,
  onChange,
  addressPlaceholder,
}: {
  title: string;
  emoji: string;
  network: string;
  apiHint: string;
  value: CryptoConfig;
  onChange: (v: CryptoConfig) => void;
  addressPlaceholder: string;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title={title}
          emoji={emoji}
          enabled={value.enabled}
          onToggle={(enabled) => onChange({ ...value, enabled })}
          description={`Receive USDT on ${network}. Bot user hash bhejega, auto-verify hoga.`}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Wallet address">
          <input
            className={inp}
            placeholder={addressPlaceholder}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value.trim() })}
          />
        </Field>
        <Field label="API key" hint={apiHint}>
          <input
            className={inp}
            type="password"
            placeholder="paste api key"
            value={value.api_key}
            onChange={(e) => onChange({ ...value, api_key: e.target.value.trim() })}
          />
        </Field>
        <Field label="Min confirmations">
          <input
            type="number"
            min={0}
            className={inp}
            value={value.min_confirmations}
            onChange={(e) => onChange({ ...value, min_confirmations: Math.max(0, parseInt(e.target.value) || 0) })}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

function PaymentsConfigPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "payments-config"],
    queryFn: async () => {
      const r = await getPaymentConfig();
      if ("error" in r) throw new Error(r.error);
      return r.config;
    },
  });

  const [cfg, setCfg] = useState<PaymentConfig>(DEFAULT_PAYMENT_CONFIG);
  useEffect(() => { if (data) setCfg(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await savePaymentConfig({ data: cfg });
      if (!r.ok) throw new Error(r.error);
    },
    onSuccess: () => {
      toast.success("Payment settings saved — bot will use these instantly");
      qc.invalidateQueries({ queryKey: ["admin", "payments-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">💳 Payment Configuration</h1>
        <p className="text-sm text-muted-foreground">
          UPI, crypto wallets and API keys. Sab yahi se manage hota hai — bot in-chat UTR/Hash le kar auto-verify aur auto-deliver karega.
        </p>
      </header>

      {/* UPI */}
      <Card>
        <CardHeader>
          <SectionHeader
            title="UPI (INR)"
            emoji="🇮🇳"
            enabled={cfg.upi.enabled}
            onToggle={(enabled) => setCfg({ ...cfg, upi: { ...cfg.upi, enabled } })}
            description="Users apke UPI ID / QR par pay karke bot me UTR bhejenge."
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="UPI ID" hint="e.g. yourname@okhdfcbank">
            <input className={inp} value={cfg.upi.upi_id}
              onChange={(e) => setCfg({ ...cfg, upi: { ...cfg.upi, upi_id: e.target.value.trim() } })} />
          </Field>
          <Field label="Payee name">
            <input className={inp} value={cfg.upi.payee_name}
              onChange={(e) => setCfg({ ...cfg, upi: { ...cfg.upi, payee_name: e.target.value } })} />
          </Field>
          <Field label="QR image URL (optional)" hint="Upload karke public URL yaha paste karo. Bot QR bot me hi bhej dega.">
            <input className={inp} placeholder="https://…/qr.png" value={cfg.upi.qr_image_url}
              onChange={(e) => setCfg({ ...cfg, upi: { ...cfg.upi, qr_image_url: e.target.value.trim() } })} />
          </Field>
        </CardContent>
      </Card>

      {/* Razorpay */}
      <Card>
        <CardHeader>
          <SectionHeader
            title="Razorpay auto-verify (UTR)"
            emoji="⚡"
            enabled={cfg.razorpay.enabled}
            onToggle={(enabled) => setCfg({ ...cfg, razorpay: { ...cfg.razorpay, enabled } })}
            description="Razorpay dashboard → Settings → API Keys. Bot yeh keys use karke UTR + amount match karega."
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Key ID">
            <input className={inp} placeholder="rzp_live_xxx or rzp_test_xxx" value={cfg.razorpay.key_id}
              onChange={(e) => setCfg({ ...cfg, razorpay: { ...cfg.razorpay, key_id: e.target.value.trim() } })} />
          </Field>
          <Field label="Key Secret">
            <input className={inp} type="password" value={cfg.razorpay.key_secret}
              onChange={(e) => setCfg({ ...cfg, razorpay: { ...cfg.razorpay, key_secret: e.target.value.trim() } })} />
          </Field>
        </CardContent>
      </Card>

      {/* Crypto */}
      <div className="grid gap-6 md:grid-cols-2">
        <CryptoSection
          title="USDT · TRC-20 (TRON)"
          emoji="🟢"
          network="TRON"
          apiHint="Get from trongrid.io (free)."
          value={cfg.crypto_trc20}
          onChange={(v) => setCfg({ ...cfg, crypto_trc20: v })}
          addressPlaceholder="T…"
        />
        <CryptoSection
          title="USDT · BEP-20 (BSC)"
          emoji="🟡"
          network="BSC"
          apiHint="Get from bscscan.com/myapikey (free)."
          value={cfg.crypto_bep20}
          onChange={(v) => setCfg({ ...cfg, crypto_bep20: v })}
          addressPlaceholder="0x…"
        />
        <CryptoSection
          title="USDT · ERC-20 (ETH)"
          emoji="🔷"
          network="Ethereum"
          apiHint="Get from etherscan.io/myapikey (free)."
          value={cfg.crypto_erc20}
          onChange={(v) => setCfg({ ...cfg, crypto_erc20: v })}
          addressPlaceholder="0x…"
        />
        <CryptoSection
          title="Bitcoin (BTC)"
          emoji="🟠"
          network="Bitcoin"
          apiHint="Blockstream API — no key needed. Leave blank."
          value={cfg.crypto_btc}
          onChange={(v) => setCfg({ ...cfg, crypto_btc: v })}
          addressPlaceholder="bc1… / 1… / 3…"
        />
      </div>

      {/* Binance Pay */}
      <Card>
        <CardHeader>
          <SectionHeader
            title="Binance Pay"
            emoji="🟨"
            enabled={cfg.binance.enabled}
            onToggle={(enabled) => setCfg({ ...cfg, binance: { ...cfg.binance, enabled } })}
            description="Buyer aapke Binance Pay ID par bhejega. API keys ho to auto-verify, warna admin approval fallback."
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Binance Pay ID" hint="Binance app → Pay → 'Send' → your Pay ID (numeric).">
            <input className={inp} placeholder="e.g. 123456789" value={cfg.binance.pay_id}
              onChange={(e) => setCfg({ ...cfg, binance: { ...cfg.binance, pay_id: e.target.value.trim() } })} />
          </Field>
          <Field label="Account email / username (optional)">
            <input className={inp} placeholder="you@example.com" value={cfg.binance.account_email}
              onChange={(e) => setCfg({ ...cfg, binance: { ...cfg.binance, account_email: e.target.value.trim() } })} />
          </Field>
          <Field label="Accepted assets" hint="Comma separated, e.g. USDT,BTC,BNB">
            <input className={inp} value={cfg.binance.accepted_assets}
              onChange={(e) => setCfg({ ...cfg, binance: { ...cfg.binance, accepted_assets: e.target.value.toUpperCase() } })} />
          </Field>
          <div />
          <Field label="Binance Pay API Key" hint="pay.binance.com → Merchant → API Management → Create.">
            <input className={inp} type="password" placeholder="paste api key" value={cfg.binance.api_key}
              onChange={(e) => setCfg({ ...cfg, binance: { ...cfg.binance, api_key: e.target.value.trim() } })} />
          </Field>
          <Field label="Binance Pay API Secret">
            <input className={inp} type="password" value={cfg.binance.api_secret}
              onChange={(e) => setCfg({ ...cfg, binance: { ...cfg.binance, api_secret: e.target.value.trim() } })} />
          </Field>
          <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              ⚠️ Auto-verify sirf tab chalta hai jab keys <b>pay.binance.com → Merchant Dashboard → Developers → API Management</b> se banayi ho.
              Normal binance.com trading API keys yaha kaam nahi karti — endpoint hi alag hai.
            </div>
            <button
              type="button"
              onClick={async () => {
                const t = toast.loading("Binance keys test kar rahe hain…");
                try {
                  // save first so latest keys are tested
                  const s = await savePaymentConfig({ data: cfg });
                  if (!s.ok) throw new Error(s.error || "save failed");
                  const r = await testBinancePay();
                  toast.dismiss(t);
                  (r.ok ? toast.success : toast.error)(r.message, { duration: 10000 });
                } catch (e: any) {
                  toast.dismiss(t);
                  toast.error(e.message || "test failed");
                }
              }}
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
            >
              🔍 Test Binance keys (auto-verify check)
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Rates + rules */}
      <Card>
        <CardHeader><CardTitle className="text-base">⚙️ Conversion & rules</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="USD → INR rate" hint="Orders USD me hain to UPI amount is rate se banega.">
            <input type="number" step="0.01" className={inp} value={cfg.usd_to_inr_rate}
              onChange={(e) => setCfg({ ...cfg, usd_to_inr_rate: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="USDT → USD rate">
            <input type="number" step="0.01" className={inp} value={cfg.usdt_to_usd_rate}
              onChange={(e) => setCfg({ ...cfg, usdt_to_usd_rate: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Amount tolerance (%)" hint="Kitna kam-jyada amount accept ho.">
            <input type="number" step="0.1" className={inp} value={cfg.amount_tolerance_pct}
              onChange={(e) => setCfg({ ...cfg, amount_tolerance_pct: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Payment window (minutes)" hint="Order create hone ke baad itni der tak UTR/hash accept honge.">
            <input type="number" className={inp} value={cfg.reference_window_minutes}
              onChange={(e) => setCfg({ ...cfg, reference_window_minutes: parseInt(e.target.value) || 0 })} />
          </Field>
          <label className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Auto-verify via API</div>
              <div className="text-xs text-muted-foreground">API keys se automatic amount+txn match.</div>
            </div>
            <Switch checked={cfg.auto_verify} onCheckedChange={(v) => setCfg({ ...cfg, auto_verify: v })} />
          </label>
          <label className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Manual approval fallback</div>
              <div className="text-xs text-muted-foreground">API fail hone par admin ko Telegram me Approve/Reject button.</div>
            </div>
            <Switch checked={cfg.manual_approval_fallback} onCheckedChange={(v) => setCfg({ ...cfg, manual_approval_fallback: v })} />
          </label>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader><CardTitle className="text-base">📝 Delivery instructions (shown in bot after payment method chosen)</CardTitle></CardHeader>
        <CardContent>
          <textarea
            rows={4}
            className={inp}
            value={cfg.instructions}
            onChange={(e) => setCfg({ ...cfg, instructions: e.target.value })}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-3 flex justify-end">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "💾 Save all settings"}
        </button>
      </div>
    </div>
  );
}