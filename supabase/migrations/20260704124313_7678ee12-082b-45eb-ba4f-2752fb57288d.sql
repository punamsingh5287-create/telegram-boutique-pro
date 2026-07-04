
-- User roles (admin gate)
CREATE TYPE public.app_role AS ENUM ('admin', 'customer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by owner" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Profiles editable by owner" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Profiles insertable by owner" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  short_description text,
  description text,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  image_url text,
  delivery_type text NOT NULL DEFAULT 'license_key' CHECK (delivery_type IN ('license_key', 'file', 'text')),
  active boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  stripe_price_lookup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active products public read" ON public.products FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY "Admins manage products" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Digital assets (inventory of deliverables per product)
CREATE TABLE public.digital_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  payload text NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  order_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_digital_assets_available ON public.digital_assets(product_id) WHERE claimed = false;
GRANT ALL ON public.digital_assets TO service_role;
GRANT SELECT ON public.digital_assets TO authenticated;
ALTER TABLE public.digital_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage digital assets" ON public.digital_assets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Telegram users
CREATE TABLE public.telegram_users (
  telegram_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  username text,
  first_name text,
  last_name text,
  language_code text,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_users TO service_role;
GRANT SELECT ON public.telegram_users TO authenticated;
ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read telegram users" ON public.telegram_users FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Cart items (keyed by telegram_id)
CREATE TABLE public.cart_items (
  telegram_id bigint NOT NULL REFERENCES public.telegram_users(telegram_id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, product_id)
);
GRANT ALL ON public.cart_items TO service_role;
GRANT SELECT ON public.cart_items TO authenticated;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read carts" ON public.cart_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint REFERENCES public.telegram_users(telegram_id) ON DELETE SET NULL,
  chat_id bigint,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivered','failed','refunded')),
  total_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX idx_orders_telegram ON public.orders(telegram_id);
CREATE INDEX idx_orders_status ON public.orders(status);
GRANT ALL ON public.orders TO service_role;
GRANT SELECT ON public.orders TO authenticated;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read orders" ON public.orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Order items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL,
  product_name_snapshot text NOT NULL
);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
GRANT ALL ON public.order_items TO service_role;
GRANT SELECT ON public.order_items TO authenticated;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read order items" ON public.order_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Deliveries (audit + accessible content per order item)
CREATE TABLE public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  digital_asset_id uuid REFERENCES public.digital_assets(id),
  payload_snapshot text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deliveries_order ON public.deliveries(order_id);
GRANT ALL ON public.deliveries TO service_role;
GRANT SELECT ON public.deliveries TO authenticated;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read deliveries" ON public.deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger util
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tg_users_updated BEFORE UPDATE ON public.telegram_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
