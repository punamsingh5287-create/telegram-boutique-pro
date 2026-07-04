import { createFileRoute } from '@tanstack/react-router';
import { runFakeBroadcast } from '@/lib/fake-broadcast.server';

export const Route = createFileRoute('/api/public/hooks/fake-broadcast')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await runFakeBroadcast();
          return Response.json(result);
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
        }
      },
    },
  },
});