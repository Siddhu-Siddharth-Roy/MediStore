# MediStore – Online Pharmacy & Medical Store Management

## Setup
1. `npm install`
2. `cp .env.example .env` → fill in DB credentials and a random `JWT_SECRET` (32+ chars; the server refuses to start otherwise)
3. `mysql -u root -p < database/schema.sql`   (schema is unchanged since Phase 1 – no re-import needed if you already did this)
4. Create the first admin: `node database/seed-admin.js admin@medistore.com YourPass123`
5. `npm start` → http://localhost:3000
6. Optional: `npm test` (server must be running) – Phase 2–6 API tests; they create and remove their own `ZZ…` data (if a run crashes half-way, leftover `ZZ…` rows can remain; they are harmless and can be deleted by name)

## Status
- **Phase 1** – project skeleton, auth (register/login/logout, JWT in httpOnly cookie, bcrypt, RBAC middleware)
- **Phase 2** – users, categories, medicines, suppliers (API + admin UI + public catalog)
- **Phase 3** – inventory & batches, stock movements, expiry management, low-stock/expiry alerts
- **Phase 4** – cart, checkout, orders, order tracking, automatic stock deduction
- **Phase 5** – purchases from suppliers, automatic stock increase, supplier purchase history
- **Phase 6** – notification panel, dashboard with charts, reports and CSV export  ← current
- Phase 7 – hardening, security review, UI polish

## Phase 2 API
| Area | Endpoints | Access |
|---|---|---|
| Profile | `GET/PUT /api/users/me`, `PUT /api/users/me/password` | any logged-in user |
| Users | `GET/POST /api/users`, `GET/PUT/DELETE /api/users/:id`, `PATCH /api/users/:id/status` | admin |
| Categories | `GET /api/categories` (public); `POST/PUT/DELETE` | admin, pharmacist |
| Medicines | `GET /api/medicines`, `GET /api/medicines/:id`, `GET /api/medicines/manufacturers` (public*); `POST/PUT/DELETE` | admin, pharmacist |
| Suppliers | CRUD, `PATCH /:id/status`, `GET /:id/purchases`, `GET /:id/medicines` | admin, pharmacist |

\* Public/customer responses only include **active** medicines with **sellable stock** (non-expired batches). Staff see everything plus batch details.
List endpoints support `page`, `limit`, `q`, and filters/sorting (whitelisted).

## Design decisions worth knowing
- `DELETE /api/medicines/:id` **deactivates** (history must survive). Suppliers/users can be hard-deleted only if they have no history; otherwise 409 → deactivate.
- Admins can't deactivate, delete or demote themselves. Deactivating a user locks them out immediately (status is checked on every request).
- A batch is sellable through its expiry date (`expiry_date >= CURDATE()`).
- Stored data is never HTML-escaped; the frontend escapes on output (`esc()` in `js/ui.js`). Helmet's CSP blocks inline scripts, so all JS lives in `frontend/js/`.

## Phase 3 API (all admin/pharmacist only, except notifications)
| Endpoint | Purpose |
|---|---|
| `GET /api/inventory` | Batch list: `q, status (in_stock/low/out/expiring/expired), medicine_id, supplier_id, sort, dir, page` |
| `GET /api/inventory/summary` | Counts for tiles/dashboard: expired, expiring 30/60/90, low/out-of-stock, stock value |
| `GET /api/inventory/low-stock` | Medicines at/below reorder level (`?status=low\|out`) |
| `GET /api/inventory/expired`, `/expiring?days=30\|60\|90` | Batch-wise expiry lists with units and value at risk |
| `GET /api/inventory/transactions` | Stock movement history: `type, medicine_id, batch_id, from, to` |
| `POST /api/inventory/batches` | Add stock as a new batch (opening stock) |
| `PUT /api/inventory/batches/:id` | Edit batch details (dates, prices, supplier, reorder level) |
| `POST /api/inventory/adjust` | `{batch_id, type: ADJUSTMENT\|DAMAGED\|EXPIRED\|RETURN, quantity, remarks}` |
| `POST /api/inventory/write-off-expired` | Zero all expired stock, recorded as `EXPIRED` movements |
| `POST /api/inventory/sync-alerts` | Run the alert scan now (also runs at start-up and hourly) |
| `GET /api/notifications`, `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all` | Own notifications (any role). Full panel UI comes in Phase 6 |

### How stock integrity is guaranteed
- `backend/services/stockService.js → changeStock()` is the **only** code that changes a batch quantity. It locks the batch row (`FOR UPDATE`), refuses to go below zero, refuses to sell expired batches, and writes the `inventory_transactions` row in the same DB transaction. Phase 4 (sales) and Phase 5 (purchases) will call it.
- Tested: 10 simultaneous removals against 5 units → exactly 5 succeed, final quantity 0, exactly 5 movement rows.
- Quantity can only change via add-batch or adjust (each requires a reason). Batch edit cannot touch quantity.
- Movement `remarks` record who made the change (the schema has no user column; kept unchanged on purpose).

### Rules & definitions
- **Sellable stock** = units in batches whose expiry date is today or later. Customers never see/buy expired units.
- **EXPIRING SOON** = within 90 days (windows 30/60/90 are also available). **Low stock** = sellable units ≤ highest reorder level among the medicine's batches; **out of stock** = 0.
- **Alerts** go to every active admin/pharmacist: low stock, out of stock, expired (qty > 0), expiring within 30 days, plus stock-adjustment notices to the *other* staff. The same alert isn't repeated to a user within 24 h.
- Expired stock is never auto-deleted: staff physically remove it, then write it off (single batch via Adjust → "Expired", or all at once).
- Batches are not deleted (history); write stock off instead. "Stock transfer" is not implemented because the system models a single store.

## Phase 4 – cart, orders, tracking
| Endpoint | Who | Purpose |
|---|---|---|
| `GET /api/cart` | customer | Cart with live prices, stock, per-item issues, totals |
| `POST /api/cart/items` `{medicine_id, quantity}` | customer | Add (accumulates; checked against sellable stock) |
| `PUT /api/cart/items/:medicineId` `{quantity}` | customer | Set quantity |
| `DELETE /api/cart/items/:medicineId`, `DELETE /api/cart` | customer | Remove item / clear |
| `POST /api/orders` `{delivery_address, delivery_phone, notes?, prescription_confirmed?}` | customer | Place order from the cart |
| `GET /api/orders`, `GET /api/orders/:id` | customer (own only) / staff (all) | List (`status, q, from, to, page`) and detail with timeline |
| `PUT /api/orders/:id/status` `{status, note?}` | admin, pharmacist | Advance or cancel |
| `POST /api/orders/:id/cancel` `{reason?}` | customer | Cancel own order (only while Pending/Confirmed) |

### How an order works
1. **Placement is one DB transaction**: lock the cart, validate, price from the DB, create the order, allocate stock, deduct stock, clear the cart. Any failure (e.g. stock sold out meanwhile) rolls back everything: no order, stock untouched, cart kept.
2. **Stock is deducted at placement** (status *Pending*), so confirmed customers can never oversell. Cancelling returns it.
3. **First-expiry-first-out**: units come from the batch that expires soonest; an order line can span several batches (`order_items` has one row per batch). **Expired batches are never allocated.**
4. Every deduction is a `SALE` movement and every cancellation a `RETURN` movement, both with `reference_id = order_id`.
5. **Prices**: unit price = the medicine's `selling_price` at order time (stored on the order, so later price edits don't change old orders). The request body carries no prices or totals; anything the client sends is ignored.
6. **Status flow** (forward only): Pending → Confirmed → Processing → Packed → Dispatched → Out for Delivery → Delivered. Cancelled is allowed up to Packed for staff, and only while Pending/Confirmed for customers. Delivered and Cancelled are final. Each change is stored in `order_status_history`.
7. **Concurrency**: the order row is locked on status changes (two simultaneous cancels → one wins, stock restored once). Batch rows are locked on allocation; deadlock victims are retried automatically. Tested with 8 buyers racing for 5 units: exactly 5 orders succeed.
8. **Notifications**: customers get one for placement and for every status change; staff get new-order and cancelled-order alerts.

### Scope notes
- Payment is **cash on delivery** only (no gateway). No delivery fee or tax is added.
- Prescription medicines require the customer to tick a confirmation at checkout (stored on the order). There is no prescription upload/verification workflow.
- If a cancelled order's batch has since expired, the units are still returned to that batch (so the ledger stays correct) and show up under Expiry for write-off.

## Phase 5 – purchases
| Endpoint | Purpose |
|---|---|
| `GET /api/purchases` | List: `q (id/supplier/invoice), supplier_id, status, from, to, page` |
| `GET /api/purchases/:id` | Header, supplier, creator/confirmer, items with batch details |
| `POST /api/purchases` | Create a **Draft** (or add `"confirm": true` to create *and* confirm atomically) |
| `PUT /api/purchases/:id` | Edit a Draft (replaces its items; also accepts `confirm`) |
| `POST /api/purchases/:id/confirm` | Confirm a Draft: **stock is added now** |
| `POST /api/purchases/:id/cancel` `{reason?}` | Discard a Draft, or reverse a Confirmed purchase (admin only, reason required) |
| `GET /api/suppliers/:id/purchases`, `/medicines` | Supplier history (with totals) and medicines supplied |

Body: `{supplier_id, purchase_date?, invoice_number?, notes?, items:[{medicine_id, batch_number, manufacturing_date?, expiry_date, quantity, purchase_price, selling_price?, reorder_level?}]}`. **No totals are accepted**: they are computed on the server in integer paise (10 × 19.99 + 3 × 0.10 = 200.20 exactly).

### Lifecycle and rules
- **Draft** → *Confirmed* → (optionally) *Cancelled*. A draft changes nothing in inventory; batch details live on the draft's items.
- **Confirming is one transaction** (rule 15): lock the purchase, **re-validate against today's data** (supplier still active, medicines still active, no batch expired meanwhile), create/top-up batches, add stock with `PURCHASE` movements referencing the purchase (rules 5, 6), mark Confirmed with who/when. If any line fails, *nothing* is applied and the purchase stays a Draft.
- **Same lot delivered again** (same medicine + batch number): the existing batch is topped up, but only if the expiry date matches; otherwise 409 (probable typo). The existing batch's prices are kept.
- New batches get the supplier, cost price, selling price (defaults to the medicine's price if left blank; must not exceed MRP), and reorder level (default 10).
- **Cancelling a Confirmed purchase** (admin only, reason required) reverses the stock with negative `PURCHASE` movements, but only if every purchased unit is still in stock; otherwise 409 and nothing changes. Cancelled purchases stay in the history and supplier totals count Confirmed purchases only.
- Double confirmation is safe: three simultaneous confirms of one purchase → exactly one succeeds, stock added once. Two purchases creating the same new lot at the same time end up in one batch with the summed quantity.
- Staff are notified of new/cancelled purchases (not the person who did it). Low-stock alerts re-evaluate after every confirmation.
- Suppliers with purchase history cannot be deleted (deactivate instead). Inactive suppliers cannot receive new purchases.

### UI
Purchases list with filters, a line-item form (live totals, selling-price prefill and MRP hint, per-line server errors, save as draft / confirm with a summary dialog), a detail page with Edit / Confirm / Discard / Cancel actions, and links to the stock movements of each purchased batch.

## Phase 6 – notifications, dashboard, reports
| Endpoint | Purpose |
|---|---|
| `GET /api/dashboard/summary` | The 9 headline cards, sales summary (today / 7 days / month / all time), inventory summary, recent orders + purchases, low-stock and expiring lists |
| `GET /api/dashboard/sales?period=daily&days=30` or `period=monthly&months=12` | Zero-filled revenue/order series + top 5 medicines for the same window (`days` clamped 7–90, `months` 3–24) |
| `GET /api/dashboard/inventory` | Medicines per category, batches per status bucket, inventory summary |
| `GET /api/reports/:type` | `sales` (`group=day\|month\|medicine\|category`), `purchases` (`supplier_id`), `inventory` (`stock=low\|out`), `expiry` (`window=expired\|30\|60\|90`), `low-stock`. Add `format=csv` to download |

All of the above: admin and pharmacist only. Report filters: `from`, `to` (YYYY-MM-DD; default last 30 days; max 366 days).

### Definitions (so the numbers are never a surprise)
- **Sales** = every order that is **not cancelled** (stock is committed when an order is placed). Cancelling removes it from sales immediately. "Total orders" still counts cancelled orders.
- **Gross profit** = revenue minus the *purchase price of the batches the units were actually taken from* (exact, because every order line records its batch).
- **Stock value** counts only sellable (non-expired) units; expired units are reported separately.
- **Inventory status chart**: every batch falls in exactly one bucket (Out of stock → Expired → Low stock → Expiring soon (≤ 90 days) → Healthy), so the chart always adds up to the number of batches.
- "Today" and all date windows use the **database server's clock**, the same one every `CURDATE()` in the app uses.

### Notifications
- The 🔔 in the top bar opens a **dropdown panel** (latest 6, mark all read, link to the full page). It refreshes every 60 s while the tab is visible, closes on Escape / outside click, and each item **opens the relevant page** (order, purchase, inventory, expiry…). Customers get the same panel for their order updates.
- Housekeeping: read notifications older than 90 days are deleted by the hourly job; unread ones are never deleted.

### Reports & CSV
- One generic API shape (`columns`, `rows`, `totals`) drives both the on-screen table and the CSV, so they cannot disagree.
- CSV is UTF-8 with a BOM (opens correctly in Excel), values are quoted/escaped, and **text cells starting with `= + - @` are prefixed with `'`** to prevent spreadsheet formula injection (numeric columns, including negative profit, are left untouched).
- The reports page has a print stylesheet (menus and filters are hidden when printing).

### Charts
Chart.js is installed from npm and served from **your own server** at `/vendor/chart.js/` so the strict Content-Security-Policy (`script-src 'self'`) stays intact: no CDN, no inline scripts. Each chart has a text summary in its `aria-label` and an empty state.
