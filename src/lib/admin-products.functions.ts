import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  customEmojiId: string | null;
  shortDescription: string | null;
  description: string | null;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  deliveryType: string;
  active: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  bulkTiers: BulkTier[];
};

export type BulkTier = {
  min: number;
  max: number | null;
  unitCents: number;
};

function sanitizeTiers(input: unknown): BulkTier[] {
  if (!Array.isArray(input)) return [];
  const out: BulkTier[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as any;
    const min = Math.max(1, Math.floor(Number(r.min ?? r.minQty ?? 0)));
    const maxRaw = r.max ?? r.maxQty ?? null;
    const max = maxRaw === null || maxRaw === "" || maxRaw === undefined
      ? null
      : Math.max(min, Math.floor(Number(maxRaw)));
    const unitCents = Math.max(0, Math.floor(Number(r.unitCents ?? r.unit_cents ?? 0)));
    if (min > 0 && unitCents >= 0) out.push({ min, max, unitCents });
  }
  return out.sort((a, b) => a.min - b.min).slice(0, 20);
}

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

function toProduct(r: any): AdminProduct {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    emoji: r.emoji ?? null,
    customEmojiId: r.custom_emoji_id ?? null,
    shortDescription: r.short_description,
    description: r.description,
    priceCents: r.price_cents,
    currency: r.currency,
    imageUrl: r.image_url,
    deliveryType: r.delivery_type,
    active: r.active,
    featured: r.featured,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bulkTiers: sanitizeTiers(r.bulk_tiers),
  };
}

export const listAdminProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ products: AdminProduct[] } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { error: error.message };
    return { products: (data ?? []).map(toProduct) };
  });

export type SaveProductInput = {
  id?: string;
  slug: string;
  name: string;
  emoji: string;
  customEmojiId: string;
  shortDescription: string;
  description: string;
  priceCents: number;
  currency: string;
  imageUrl: string;
  deliveryType: string;
  active: boolean;
  featured: boolean;
  bulkTiers?: BulkTier[];
};

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SaveProductInput) => {
    if (!data.slug || !data.name) throw new Error("Slug and name required");
    if (data.priceCents < 0) throw new Error("Price must be positive");
    return {
      id: data.id,
      slug: data.slug.trim().toLowerCase().slice(0, 100),
      name: data.name.trim().slice(0, 200),
      emoji: (data.emoji ?? "").trim().slice(0, 16),
      customEmojiId: (data.customEmojiId ?? "").trim().slice(0, 64),
      shortDescription: (data.shortDescription ?? "").slice(0, 500),
      description: (data.description ?? "").slice(0, 5000),
      priceCents: Math.floor(data.priceCents),
      currency: (data.currency || "USD").toUpperCase().slice(0, 3),
      imageUrl: (data.imageUrl ?? "").slice(0, 1000),
      deliveryType: (data.deliveryType || "license_key").slice(0, 50),
      active: !!data.active,
      featured: !!data.featured,
      bulkTiers: sanitizeTiers(data.bulkTiers),
    };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; product: AdminProduct } | { ok: false; error: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      slug: data.slug,
      name: data.name,
      emoji: data.emoji || null,
      custom_emoji_id: data.customEmojiId || null,
      short_description: data.shortDescription || null,
      description: data.description || null,
      price_cents: data.priceCents,
      currency: data.currency,
      image_url: data.imageUrl || null,
      delivery_type: data.deliveryType,
      active: data.active,
      featured: data.featured,
      bulk_tiers: data.bulkTiers ?? [],
    };
    const q = data.id
      ? supabaseAdmin.from("products").update(payload).eq("id", data.id).select("*").maybeSingle()
      : supabaseAdmin.from("products").insert(payload).select("*").maybeSingle();
    const { data: row, error } = await q;
    if (error) return { ok: false, error: error.message };
    if (!row) return { ok: false, error: "Save failed" };

    await supabaseAdmin.from("admin_audit_log").insert({
      action: data.id ? "product.updated" : "product.created",
      actor_user_id: context.userId,
      success: true,
      context: { product_id: row.id, slug: row.slug },
    });
    return { ok: true, product: toProduct(row) };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("products").delete().eq("id", data.id);
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "product.deleted",
      actor_user_id: context.userId,
      success: true,
      context: { product_id: data.id },
    });
    return { ok: true };
  });

export const getProductStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }): Promise<{ available: number; claimed: number } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: available }, { count: claimed }] = await Promise.all([
      supabaseAdmin.from("digital_assets").select("id", { count: "exact", head: true }).eq("product_id", data.productId).eq("claimed", false),
      supabaseAdmin.from("digital_assets").select("id", { count: "exact", head: true }).eq("product_id", data.productId).eq("claimed", true),
    ]);
    return { available: available ?? 0, claimed: claimed ?? 0 };
  });

export const addDigitalAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; payloads: string[] }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const lines = (data.payloads || []).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 5000);
    if (!lines.length) return { ok: false, error: "No keys provided" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = lines.map((payload) => ({ product_id: data.productId, payload }));
    const { error } = await supabaseAdmin.from("digital_assets").insert(rows);
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("admin_audit_log").insert({
      action: "digital_assets.added",
      actor_user_id: context.userId,
      success: true,
      context: { product_id: data.productId, count: lines.length },
    });
    return { ok: true, inserted: lines.length };
  });