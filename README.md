
# IjaPlastik Backend

Express + MySQL + Cloudinary (no ORM). Supports roles (admin, cashier, supplier), products with SKU, sales (retail/wholesale), purchase orders and GRN, and stock alerts to WhatsApp (admin only).

## Quickstart

1. Create DB using the SQL from your setup.
2. Copy `.env.example` to `.env` and fill values.
3. Install deps:
   ```bash
   npm i
   npm run dev
   ```
4. Endpoints (high level):
   - `POST /auth/login`
   - `GET /auth/me`
   - `POST /users` (admin creates cashier/supplier)
   - `POST /products` (admin) [multipart field: image]
   - `GET /products`
   - `POST /sales` (cashier) — retail/wholesale mixed
   - `GET /sales/:id/receipt`
   - `POST /purchase` (admin) — create PO
   - `POST /purchase/:id/send`  — notify supplier (placeholder)
   - `POST /purchase/:id/receive` — GRN + stock update
