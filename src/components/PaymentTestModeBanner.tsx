const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-center text-sm text-red-200">
        Production checkout is not configured. Complete Stripe go-live in your Lovable project to accept real payments.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-gold/40 bg-gold/10 px-4 py-2 text-center text-sm text-gold">
        Test mode — all payments in preview use Stripe sandbox.{" "}
        <a
          href="https://docs.lovable.dev/features/payments#test-and-live-environments"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium"
        >
          Learn more
        </a>
      </div>
    );
  }
  return null;
}