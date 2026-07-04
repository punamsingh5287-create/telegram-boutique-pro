import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

export type UploadInput = {
  /** Base64-encoded file bytes (no data: prefix). */
  base64: string;
  filename: string;
  contentType: string;
  /** Sub-folder within the bucket, e.g. "products" or "welcome". */
  folder?: string;
};

/** Uploads an image to the private `product-images` bucket and returns a
 *  long-lived signed URL so Telegram / browsers can fetch it directly. */
export const uploadProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UploadInput) => {
    if (!data.base64) throw new Error("Missing file");
    if (!data.contentType?.startsWith("image/")) throw new Error("Only image files allowed");
    // Rough size cap — 8 MB decoded (~11 MB base64).
    if (data.base64.length > 11_500_000) throw new Error("Image too large (max 8 MB)");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const safeName = (data.filename || "image")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-80);
    const folder = (data.folder || "products").replace(/[^a-z0-9_-]/gi, "");
    const path = `${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("product-images")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) return { ok: false, error: upErr.message };
    // 10-year signed URL. The bucket is private (workspace blocks public buckets).
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("product-images")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signErr || !signed) return { ok: false, error: signErr?.message ?? "Signing failed" };
    return { ok: true, url: signed.signedUrl, path };
  });