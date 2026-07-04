# Admin Panel — Full Management Console

Currently `/admin/*` only has **Deliveries** and **Audit log**. Ye plan use ek complete store-management console banane ke liye hai, Shopify/Gumroad style, sidebar navigation ke saath.

## Shared shell (built first, once)

- Naya `AdminSidebar` component with collapsible groups: Overview, Catalog, Sales, Customers, Marketing, System.
- `SidebarProvider` + trigger in `/admin` layout route (already role-gated).
- Search bar in top header, admin email + sign-out menu.
- Responsive: sidebar collapses to icons on tablet, offcanvas on mobile.

## Modules (built in phases, each phase = separate turn)

### Phase 1 — Foundation (this turn if approved)
1. **Sidebar shell** replacing current header nav in `/admin` layout.
2. **Dashboard** (`/admin`) — KPI cards (Revenue today/week/month/lifetime, Orders, Paid/Pending/Failed, Active users) + Recent orders table + Best-selling products list. All data from existing `orders`, `order_items`, `products` tables.
3. **Orders** (`/admin/orders`) — searchable/filterable table (status, date, amount), row → order detail drawer with items, delivery status, resend button, refund note.

### Phase 2 — Catalog
4. **Products** (`/admin/products`) — list, create, edit, archive; upload digital asset to `digital-files` bucket, set price, stock, description, category.
5. **Digital assets** — attach/replace files per product, download links.

### Phase 3 — Customers & Marketing
6. **Users** (`/admin/users`) — telegram_users + profiles joined, order history per user, ban/unban, grant/revoke admin role.
7. **Coupons** — create %/flat coupons, expiry, usage limit (needs new `coupons` table).
8. **Broadcasts** — send Telegram message to all users / segment (needs new `broadcasts` table + server fn calling Telegram gateway).

### Phase 4 — Ops
9. **Deliveries** (already exists, move under new shell).
10. **Audit log** (already exists, move under new shell).
11. **Settings** — store name, currency, welcome message, payment toggles.

## Technical notes (for reference)

- All admin server fns already gate on `has_role('admin')`; new fns follow same pattern via `requireSupabaseAuth` + `has_role` RPC + `supabaseAdmin` for writes.
- New tables (`coupons`, `broadcasts`) will need migrations with GRANT + RLS (admin-only via `has_role`).
- KPI aggregations = single server fn returning pre-computed sums (no client-side heavy math).
- Each mutation writes to `admin_audit_log` (pattern already established).
- Telegram sends go through existing gateway (`LOVABLE_API_KEY` + `TELEGRAM_API_KEY` already set).

## What I need from you

1. **Confirm Phase 1 scope** (Sidebar + Dashboard + Orders) as the first turn — that's already a big change but shippable together.
2. Prefer **English or Hinglish** copy in the UI?
3. Currency default — INR ya USD?

Baaki phases baad ke turns me ek-ek karke banayenge, testing ke saath.
