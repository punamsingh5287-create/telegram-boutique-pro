ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS emoji text,
  ADD COLUMN IF NOT EXISTS custom_emoji_id text;