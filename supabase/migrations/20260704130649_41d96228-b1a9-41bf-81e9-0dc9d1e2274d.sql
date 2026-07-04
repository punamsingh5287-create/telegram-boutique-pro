CREATE TABLE public.stripe_webhook_events (
  event_id text NOT NULL PRIMARY KEY,
  type text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  received_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.stripe_webhook_events TO service_role;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read webhook events"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));