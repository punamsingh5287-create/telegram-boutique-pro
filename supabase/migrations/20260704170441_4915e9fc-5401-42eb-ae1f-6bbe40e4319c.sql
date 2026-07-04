CREATE TABLE public.payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  telegram_id bigint REFERENCES public.telegram_users(telegram_id) ON DELETE SET NULL,
  chat_id bigint,
  method text NOT NULL CHECK (method IN ('crypto', 'inr_utr')),
  reference text NOT NULL,
  normalized_reference text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'verified', 'rejected', 'failed')),
  provider text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  rejected_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_claims TO authenticated;
GRANT ALL ON public.payment_claims TO service_role;

CREATE UNIQUE INDEX payment_claims_normalized_reference_key ON public.payment_claims(normalized_reference);
CREATE UNIQUE INDEX payment_claims_order_verified_key ON public.payment_claims(order_id) WHERE status = 'verified';
CREATE INDEX idx_payment_claims_order_id ON public.payment_claims(order_id);
CREATE INDEX idx_payment_claims_status ON public.payment_claims(status);
CREATE INDEX idx_payment_claims_telegram_id ON public.payment_claims(telegram_id);

ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view payment claims"
  ON public.payment_claims
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage payment claims"
  ON public.payment_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER set_payment_claims_updated_at
  BEFORE UPDATE ON public.payment_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();