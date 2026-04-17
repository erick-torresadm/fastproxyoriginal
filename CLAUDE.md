# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FastProxy** is a proxy selling/management SaaS deployed on Vercel. Users buy proxy access via Stripe checkout, receive credential pairs (ip:port with username:password), manage them in a user portal, and can swap or add proxies. Payment processing uses Stripe (test mode active). Proxy infrastructure is via ProxySeller API.

Production URLs: `fastproxyv3.vercel.app` and `fastproxyoriginal.vercel.app`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | Neon PostgreSQL (serverless) via `@neondatabase/serverless` |
| Payments | Stripe (checkout sessions + webhooks) |
| Proxy Provider | ProxySeller API |
| Email | Resend API |
| Frontend | Static HTML/CSS/JS, Tailwind CSS via CDN |
| Hosting | Vercel (serverless functions) |
| Auth | JWT tokens (7-day expiry), bcrypt password hashing |

## Key Commands

```bash
# Start server locally
npm install
node server.js          # or: npm start / npm run dev

# Deploy to Vercel
vercel --prod

# Environment variables (Vercel)
vercel env add DATABASE_URL production

# Health check (local)
curl http://localhost:3000/test
```

There are **no automated tests**. Test scripts (`test-*.js`) are manual utility scripts. The `routes/test.js` exposes a `/api/test/` endpoint group for ad-hoc testing.

## Architecture

### Entry Point

`server.js` — Express app that registers route modules under `/api/*`, serves static files from `public/`, and applies CORS + Helmet middleware. All API routes are lazily required (each wrapped in try/catch).

### Route Registration Order

| Prefix | File | Purpose |
|--------|------|---------|
| `/api/stripe` | `routes/stripe.js` | Stripe checkout creation, session verify, webhook handler |
| `/api/auth` | `routes/auth.js` | Legacy auth endpoints |
| `/api/test` | `routes/test.js` | Debug/testing utilities |
| `/api/subscription` | `routes/subscription.js` | **Main route file** — login, register, /me, proxy swap, add proxies, expiration check, admin creation |
| `/api/proxyseller` | `routes/proxyseller.js` | ProxySeller API integration (create proxies, block/unblock) |
| `/api/coupons` | `routes/coupons.js` | Discount coupon management |
| `/api/checkout` | `routes/checkout.js` | Checkout flow |
| `/api/accesslogs` | `routes/accesslogs.js` | Access logs (Marco Civil compliance) |
| `/api/rewards` | `routes/rewards.js` | Loyalty points system |
| `/api/test-prices` | `routes/test-prices.js` | Price testing |

### Database

`lib/database.js` uses Neon's serverless driver. On module load it auto-creates **all tables** (`CREATE TABLE IF NOT EXISTS`) — no separate migration system. The exported `sql` tagged template literal is used for all queries.

Tables managed automatically:
- `users`, `subscriptions`, `proxies`, `proxy_replacements` — core proxy lifecycle
- `proxy_orders`, `proxyseller_proxies` — ProxySeller integration
- `discounts`, `coupons`, `coupon_usage` — coupons
- `access_logs`, `attribution_logs`, `user_consents`, `terms_acceptance` — legal compliance (LGPD, Marco Civil)
- `reward_points`, `reward_transactions` — loyalty system
- `user_transactions`, `user_messages` — purchase history and notifications
- `tutorials`, `blog_posts` — content pages

### Key Business Rule: Proxy = Access

Access to the portal is granted if the user has **active proxies**, regardless of subscription status. The `hasActiveSubscription` helper returns true if user has proxies OR a valid subscription. See `DOCUMENTACAO.md` for the state table.

### Authentication Flow

1. User pays via Stripe checkout → Stripe webhook fires or user redirected to `success.html`
2. If new email: `success.html` shows registration form → `POST /api/subscription/register-after-payment`
3. If returning: `success.html` asks for login → `POST /api/subscription/login`
4. JWT token stored in `localStorage` as `fastproxy_token`

### Proxy Allocation

- Base IP and port range configured via `.env` (`PROXY_IP`, `PROXY_PORT_START`, `PROXY_PORT_END`)
- Ports tracked in-memory (`allocatedPorts` Set) — **not persisted across restarts**
- Proxy credentials generated randomly per user

### Frontend

Static HTML files in `public/`:
| File | Purpose |
|------|---------|
| `index.html` | Landing page with pricing and checkout modal |
| `portal.html` | User dashboard — proxy list, swap, subscription info |
| `admin.html` | Admin panel — user/proxy management |
| `success.html` | Post-payment page — login or register form |
| `cancel.html` | Payment cancelled page |
| `cancelar.html` | Alternative cancellation page |
| `planos.html` | Plans page |
| `blog.html`, `tutoriais.html` | Content pages |
| `privacidade.html`, `termos.html`, `reembolso.html` | Legal pages |

### Middleware & Models

- `middleware/auth.js` — JWT verification middleware + admin role check
- `models/` — Mongoose models (legacy, not actively used since DB is Neon/PostgreSQL)
- `lib/email.js` — Email sending via Resend
- `lib/stripe.js` — Stripe client initialization
- `lib/proxyseller.js` — ProxySeller API helper

### Environment Variables

Required: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `JWT_SECRET`, `APP_URL`
Optional: `STRIPE_PUBLISHABLE_KEY`, `STRIPE_TEST_MODE`, `RESEND_API_KEY`, `PROXYSELLER_API_KEY`, `PROXY_IP`, `PROXY_PORT_START`, `PROXY_PORT_END`
See `.env.example` for the full list. **Never commit `.env`.**

### Vercel Deployment

`vercel.json` routes `/api/*`, `/test`, `/debug/*` to `server.js` and everything else to static `public/`. Deploy with `vercel --prod`. Environment variables are set via `vercel env add <name> production`.
