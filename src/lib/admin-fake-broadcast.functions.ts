import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { FakeBroadcastConfig } from '@/lib/fake-broadcast.server';

async function ensureAdmin(ctx: any) {
  const { data } = await (ctx.supabase as any).rpc('has_role', { _user_id: ctx.userId, _role: 'admin' });
  return Boolean(data);
}

export const getFakeConfig = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ config: FakeBroadcastConfig } | { error: string }> => {
    if (!(await ensureAdmin(context))) return { error: 'Forbidden' };
    const { getFakeBroadcastConfig } = await import('@/lib/fake-broadcast.server');
    const config = await getFakeBroadcastConfig();
    return { config };
  });

export const saveFakeConfig = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: FakeBroadcastConfig) => ({
    enabled: !!data.enabled,
    names: (data.names ?? []).map((n) => String(n).trim()).filter(Boolean).slice(0, 100),
    templates: (data.templates ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30),
    maxRecipients: Math.max(1, Math.min(10000, Math.floor(data.maxRecipients ?? 500))),
  }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: 'Forbidden' };
    const { saveFakeBroadcastConfig } = await import('@/lib/fake-broadcast.server');
    await saveFakeBroadcastConfig(data);
    return { ok: true };
  });

export const triggerFakeNow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; sent?: number; failed?: number; skipped?: string; error?: string }> => {
    if (!(await ensureAdmin(context))) return { ok: false, error: 'Forbidden' };
    const { runFakeBroadcast } = await import('@/lib/fake-broadcast.server');
    return await runFakeBroadcast();
  });