import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { createHash, timingSafeEqual } from 'crypto';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  formatPrice,
  EMOJI,
  type InlineButton,
} from '@/lib/telegram.server';

function deriveWebhookSecret(botToken: string): string {
  return createHash('sha256').update(`telegram-webhook:${botToken}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

let _admin: ReturnType<typeof createClient<Database>> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

function siteBase(): string {
  return process.env.SITE_URL
    ?? 'https://project--8d1bf028-91ae-4c3e-a101-f975bbf3c319-dev.lovable.app';
}

async function upsertTelegramUser(u: {
  id: number; chat_id: number; username?: string; first_name?: string; last_name?: string; language_code?: string;
}) {
  await admin().from('telegram_users').upsert(
    {
      telegram_id: u.id,
      chat_id: u.chat_id,
      username: u.username ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      language_code: u.language_code ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' },
  );
}

function homeKeyboard(): InlineButton[][] {
  return [
    [{ text: `${EMOJI.shop} Shop`, callback_data: 'shop' }, { text: `${EMOJI.trending} Trending`, callback_data: 'trending' }],
    [{ text: `${EMOJI.orders} My Orders`, callback_data: 'orders' }, { text: `${EMOJI.key} My Products`, callback_data: 'products' }],
    [{ text: `${EMOJI.coupon} Coupons`, callback_data: 'coupons' }, { text: `${EMOJI.user} Profile`, callback_data: 'profile' }],
    [{ text: `${EMOJI.support} Support`, callback_data: 'support' }, { text: `${EMOJI.bell} Announcements`, callback_data: 'news' }],
  ];
}

function welcomeText(firstName?: string): string {
  const name = firstName ? `, <b>${firstName}</b>` : '';
  return [
    `${EMOJI.gem} <b>Welcome to Mateo Store</b>${name}`,
    ``,
    `Premium digital goods, delivered instantly.`,
    `${EMOJI.bolt} Instant activation  ·  ${EMOJI.lock} Secure payments  ·  ${EMOJI.star} Trusted licenses`,
    ``,
    `Choose an option below to get started.`,
  ].join('\n');
}

async function sendHome(chat_id: number, firstName?: string) {
  await sendMessage(chat_id, welcomeText(firstName), {
    reply_markup: { inline_keyboard: homeKeyboard() },
  });
}

async function sendShop(chat_id: number) {
  const { data: products } = await admin()
    .from('products')
    .select('id, slug, name, short_description, price_cents, currency, featured')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  if (!products?.length) {
    await sendMessage(chat_id, `${EMOJI.clock} <b>The catalog is empty.</b>\nOur team is preparing something premium — check back soon.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Back`, callback_data: 'home' }]] },
    });
    return;
  }

  await sendMessage(chat_id, `${EMOJI.shop} <b>Mateo Store · Catalog</b>\nSelect a product to view details.`, {
    reply_markup: {
      inline_keyboard: [
        ...products.map((p: any) => [{
          text: `${p.featured ? EMOJI.star + ' ' : ''}${p.name}  ·  ${formatPrice(p.price_cents, p.currency)}`,
          callback_data: `p:${p.id}`,
        }]),
        [{ text: `${EMOJI.back} Back`, callback_data: 'home' }],
      ],
    },
  });
}

async function sendProduct(chat_id: number, productId: string) {
  const { data: p } = await admin()
    .from('products')
    .select('id, name, description, short_description, price_cents, currency, image_url')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();

  if (!p) {
    await sendMessage(chat_id, `${EMOJI.cross} Product not available.`);
    return;
  }

  const price = formatPrice((p as any).price_cents, (p as any).currency);
  const text = [
    `${EMOJI.gem} <b>${(p as any).name}</b>`,
    ``,
    (p as any).short_description ? `<i>${(p as any).short_description}</i>\n` : '',
    (p as any).description ?? '',
    ``,
    `<b>Price:</b> ${price}`,
  ].filter(Boolean).join('\n');

  await sendMessage(chat_id, text, {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.pay} Buy · ${price}`, callback_data: `buy:${(p as any).id}` }],
        [{ text: `${EMOJI.back} Back to Shop`, callback_data: 'shop' }],
      ],
    },
  });
}

async function startCheckout(chat_id: number, telegram_id: number, productId: string) {
  const { data: product } = await admin()
    .from('products')
    .select('id, name, price_cents, currency')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();
  if (!product) {
    await sendMessage(chat_id, `${EMOJI.cross} Product not available.`);
    return;
  }

  const p = product as any;
  const { data: order, error } = await admin()
    .from('orders')
    .insert({
      telegram_id, chat_id,
      status: 'pending',
      total_cents: p.price_cents,
      currency: p.currency,
    })
    .select('id')
    .single();
  if (error || !order) {
    await sendMessage(chat_id, `${EMOJI.cross} Could not create order. Please try again.`);
    return;
  }
  await admin().from('order_items').insert({
    order_id: (order as any).id,
    product_id: p.id,
    quantity: 1,
    unit_price_cents: p.price_cents,
    product_name_snapshot: p.name,
  });

  const payUrl = `${siteBase()}/pay/${(order as any).id}`;
  await sendMessage(chat_id, [
    `${EMOJI.lock} <b>Secure Checkout</b>`,
    ``,
    `<b>${p.name}</b>`,
    `Total: <b>${formatPrice(p.price_cents, p.currency)}</b>`,
    ``,
    `Tap below to complete your payment. Your license will be delivered here automatically.`,
  ].join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${EMOJI.pay} Pay ${formatPrice(p.price_cents, p.currency)}`, url: payUrl }],
        [{ text: `${EMOJI.back} Cancel`, callback_data: 'shop' }],
      ],
    },
  });
}

async function sendOrders(chat_id: number, telegram_id: number) {
  const { data: orders } = await admin()
    .from('orders')
    .select('id, status, total_cents, currency, created_at')
    .eq('telegram_id', telegram_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!orders?.length) {
    await sendMessage(chat_id, `${EMOJI.orders} You have no orders yet.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.shop} Browse Shop`, callback_data: 'shop' }]] },
    });
    return;
  }

  const lines = orders.map((o: any) => {
    const status = o.status === 'delivered' ? EMOJI.check
      : o.status === 'paid' ? EMOJI.bolt
      : o.status === 'pending' ? EMOJI.clock
      : EMOJI.cross;
    const date = new Date(o.created_at).toLocaleDateString();
    return `${status}  ${formatPrice(o.total_cents, o.currency)}  ·  <code>${String(o.id).slice(0, 8)}</code>  ·  ${date}`;
  });

  await sendMessage(chat_id, `${EMOJI.orders} <b>Your Orders</b>\n\n${lines.join('\n')}`, {
    reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Home`, callback_data: 'home' }]] },
  });
}

async function sendMyProducts(chat_id: number, telegram_id: number) {
  const { data: deliveries } = await admin()
    .from('deliveries')
    .select('id, payload_snapshot, delivered_at, products(name), orders!inner(telegram_id)')
    .eq('orders.telegram_id', telegram_id)
    .order('delivered_at', { ascending: false })
    .limit(20);

  if (!deliveries?.length) {
    await sendMessage(chat_id, `${EMOJI.key} You have no delivered products yet.`, {
      reply_markup: { inline_keyboard: [[{ text: `${EMOJI.shop} Browse Shop`, callback_data: 'shop' }]] },
    });
    return;
  }

  const text = [
    `${EMOJI.key} <b>My Products</b>`,
    ``,
    ...deliveries.map((d: any) =>
      `${EMOJI.gem} <b>${d.products?.name ?? 'Product'}</b>\n<code>${d.payload_snapshot}</code>`,
    ),
  ].join('\n\n');

  await sendMessage(chat_id, text, {
    reply_markup: { inline_keyboard: [[{ text: `${EMOJI.back} Home`, callback_data: 'home' }]] },
  });
}

async function handleUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    const chat_id = msg.chat.id;
    const from = msg.from;
    if (from) await upsertTelegramUser({ id: from.id, chat_id, ...from });

    const text: string = msg.text ?? '';
    if (text.startsWith('/start')) {
      await sendHome(chat_id, from?.first_name);
    } else if (text.startsWith('/shop')) {
      await sendShop(chat_id);
    } else if (text.startsWith('/orders')) {
      await sendOrders(chat_id, from.id);
    } else if (text.startsWith('/products')) {
      await sendMyProducts(chat_id, from.id);
    } else if (text.startsWith('/help')) {
      await sendMessage(chat_id, [
        `${EMOJI.gem} <b>Mateo Store · Commands</b>`,
        `/start — Home`,
        `/shop — Browse products`,
        `/orders — Your orders`,
        `/products — Delivered licenses`,
      ].join('\n'));
    } else {
      await sendHome(chat_id, from?.first_name);
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chat_id = cq.message?.chat?.id;
    const from = cq.from;
    const data: string = cq.data ?? '';
    if (from && chat_id) await upsertTelegramUser({ id: from.id, chat_id, ...from });

    try {
      if (data === 'home') await sendHome(chat_id, from?.first_name);
      else if (data === 'shop' || data === 'trending') await sendShop(chat_id);
      else if (data === 'orders') await sendOrders(chat_id, from.id);
      else if (data === 'products') await sendMyProducts(chat_id, from.id);
      else if (data === 'coupons') await sendMessage(chat_id, `${EMOJI.coupon} Coupons launching soon.`);
      else if (data === 'profile') await sendMessage(chat_id, `${EMOJI.user} <b>Profile</b>\n\nTelegram ID: <code>${from.id}</code>\nUsername: @${from.username ?? '—'}`);
      else if (data === 'support') await sendMessage(chat_id, `${EMOJI.support} Contact @${process.env.SUPPORT_HANDLE ?? 'MateoSupport'} for help.`);
      else if (data === 'news') await sendMessage(chat_id, `${EMOJI.bell} No announcements yet.`);
      else if (data.startsWith('p:')) await sendProduct(chat_id, data.slice(2));
      else if (data.startsWith('buy:')) await startCheckout(chat_id, from.id, data.slice(4));
    } finally {
      await answerCallbackQuery(cq.id).catch(() => {});
    }
    return;
  }
}

export const Route = createFileRoute('/api/public/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return new Response('Not configured', { status: 500 });
        const expected = deriveWebhookSecret(botToken);
        const actual = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
        if (!safeEqual(actual, expected)) {
          return new Response('Unauthorized', { status: 401 });
        }

        const update = await request.json();
        // Always ack fast; don't let Telegram retry on internal errors.
        try { await handleUpdate(update); }
        catch (err) { console.error('telegram handler error', err); }
        return Response.json({ ok: true });
      },
    },
  },
});