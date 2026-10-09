# CrossCut Salon: Backend API

Express API that receives every sale and customer from the CrossCut Salon POS and stores them in Supabase Postgres, with tools that prove the data matches the original Google Sheets.



**Part of:** CrossCut Salon system (see also the [website](https://github.com/jlespiritu/crosscut-salon-react))

## Features

- API-key protected `/pos` routes (timing-safe, fail-closed), CORS allowlist, `/health`
- Idempotent `POST /pos/sales`: accepts any email or phone format and zero totals, logs failures to `failed-sales.log`
- Customer upsert, delete (409 if the customer has sales), duplicate detection and merge
- Supabase Postgres with Row Level Security on all tables

## Tech stack

Node.js, Express 5 (CommonJS), `pg`, `cors`, `dotenv`, Supabase Postgres, hosted on Render.

## Getting started

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/jlespiritu/crosscut-salon-backend.git
cd crosscut-salon-backend
npm install
npm start
```

Create a `.env` file (never commit it):

| Variable | Purpose |
|---|---|
| `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` | Supabase Postgres connection (use the IPv4 pooler host) |
| `API_KEY` | Shared secret required in the `x-api-key` header |
| `CORS_ORIGINS` | Allowed origins, comma separated |
| `PORT` | Provided by the host in production |

Health check: `GET /health`.

## API reference

All `/pos` routes require the `x-api-key` header.

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Liveness check (public) |
| GET | `/pos/staff`, `/pos/services`, `/pos/products` | Reference data |
| GET | `/pos/customers`, `/pos/sales` | Customers and sales (joined with customer name) |
| POST | `/pos/customers` | Upsert a customer |
| POST | `/pos/sales` | Record a sale (idempotent by id) |
| DELETE | `/pos/sales/:id` | Remove a voided sale |
| DELETE | `/pos/customers/:id` | Remove a customer |
| GET | `/pos/customers/duplicates` | List duplicate groups |
| POST | `/pos/customers/merge` | Merge duplicates and move their sales |

## Data tools

| Script | Purpose |
|---|---|
| `importFromSheets.js` | One-time historical import from the Sheets `Data` tab (dry run first, then `--commit`) |
| `reconcileSales.js` | Report sales missing in Postgres, add them with `--commit` |
| `mergeDuplicates.js` | Merge duplicate customers, email-first (dry run by default) |
| `verifySales.js` | Field-by-field proof that Sheets and Postgres match |
| `testServer.js` | Automated route checks against in-memory Postgres |

**Verified result:** 79 sales identical in both stores, 0 missing, 0 extra.

## Security

- Timing-safe API-key middleware on every `/pos` route
- CORS allowlist, Row Level Security on all five tables
- Secrets in environment variables only. `.env`, `import/` and logs are git-ignored
- **Known limitation:** the POS is a client-side app, so its API key can be read by anyone who opens the page. Planned fix: server-side PIN login with JWT sessions

## Problems solved

| Problem | Cause | Solution |
|---|---|---|
| Sales missing in Postgres | POS sent each sale once, with no retry | Outbox queue with retry on the POS, plus `reconcileSales.js` to recover gaps |
| Migration unproven | No comparison method | `verifySales.js` compares every field, totals by month, staff and payment method |
| Duplicate customers | No existing-customer check, unpaid drafts saved | Duplicate guard, `mergeDuplicates.js`, email as identity key |
| Sale rejected over bad contact data | Strict validation | Hardened `POST /sales` to accept any email or phone and zero totals |
| `customer_id` pointed at nothing | No customers table | Added a full `customers` table synced from the POS |
| Open delete and merge routes | No authentication | API-key middleware before going public |
| Tables fully open | RLS off by default | Enabled RLS on all five tables |
| Direct DB connection failed | Direct Supabase host is IPv6 only | Used the IPv4 transaction pooler |
| 401 right after deploy | Empty or mismatched key variable | Re-set the variable and retested |
| Free host sleeps | Render free tier idles | Retry-safe, idempotent writes plus a keep-awake ping |
| Schema and route overwritten | Two AI tools editing the same code and database | Restored the schema and `routes/pos.js`, separated roles |
| Test data in real records | Trial entries | Removed rows, kept an exclusion list used by the scripts |

## Roadmap

- [ ] Remove MongoDB entirely, backend fully on Postgres
- [ ] Service sync (`POST /pos/services`)
- [ ] JWT authentication with owner-only routes
- [ ] Scheduled Sheets to Postgres sync as a second safety net
- [ ] Regular backups

## Author

**Jeffrey L. Espiritu**, [@jlespiritu](https://github.com/jlespiritu)
