# FastProxy - Specification Document

## Project Overview

**Project Name:** FastProxy  
**Type:** SaaS - HTTP Proxy Management Platform  
**Core Functionality:** Proxy IPv6 sales platform with Stripe payments, customer portal, and admin dashboard  
**Target Users:** Digital marketers, bot developers, social media managers

---

## URLs

- **Production:** https://fastproxyoriginal.vercel.app
- **GitHub:** https://github.com/erick-torresadm/fastproxyoriginal

---

## Completed Features

### 1. Landing Page (index.html)
- Hero section with animated orbs and grid pattern
- Dark/Light theme toggle (default: light mode)
- Logo switches between black (light mode) and white (dark mode)
- Features section with cards
- Pricing section with 2 plans:
  - Mensal: R$ 29,90/proxy
  - Anual: R$ 299,00/proxy (2 months free)
- Purchase modal with quantity selector
- Stripe checkout integration
- Smooth scroll navigation
- Mobile responsive menu

### 2. Stripe Integration
- API route: `/api/stripe/create-checkout`
- Dynamic pricing based on quantity and period
- Success/Cancel pages
- Keys configured in Vercel environment variables

### 3. Additional Pages
- `success.html` - Payment success page
- `cancel.html` - Payment cancelled page
- `portal.html` - Customer portal (placeholder)
- `admin.html` - Admin dashboard (placeholder)

### 4. Design System
- **Font:** Outfit (current), should migrate to Inter
- **Primary Colors:** Green (#327d26, #266c1c)
- **Secondary Colors:** Brand variations
- **Theme:** Light mode default with dark mode toggle

---

## Environment Variables (Vercel)

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
APP_URL=https://fastproxyoriginal.vercel.app
```

---

## Design Improvements Needed

1. **Font:** Switch from Outfit to Inter (matching ADPRO design)
2. **Colors:** Use purple/indigo/blue gradient theme (like ADPRO)
3. **Menu:** Improve font color visibility in both themes
4. **Cards:** Add hover effects and better shadows
5. **Buttons:** Add gradient shine effects
6. **Overall:** Modernize to match ADPRO quality

---

## Files Structure

```
fastproxyv3 - Copia/
├── public/
│   ├── index.html          # Landing page
│   ├── success.html        # Payment success
│   ├── cancel.html         # Payment cancel
│   ├── portal.html         # Customer portal
│   ├── admin.html          # Admin dashboard
│   └── img/
│       └── LOGO-FAST-PROXY-black.png
├── routes/
│   └── stripe.js           # Stripe API routes
├── lib/
│   └── stripe.js           # Stripe utilities
├── server.js               # Express server
├── vercel.json             # Vercel config
└── .env                   # Environment variables (gitignored)
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stripe/create-checkout` | POST | Create Stripe checkout session |
| `/api/stripe/webhook` | POST | Stripe webhook handler |

---

## Stripe Checkout Flow

1. User selects plan and quantity
2. User enters email and optional WhatsApp
3. Click "Comprar Agora" triggers `createCheckout()`
4. API calculates price (R$ 29,90 × quantity for monthly)
5. Creates Stripe checkout session with line items
6. User redirected to Stripe for payment
7. Success/Cancel redirects back to site

---

## Known Issues

- [x] Duplicate script blocks in HTML (FIXED)
- [x] Functions not attached to window (FIXED)
- [x] Price multiplication in Stripe (FIXED)
- [x] Wrong default URLs in Stripe (FIXED)
- [ ] Menu font colors need improvement

---

## Next Steps

1. Improve design to match ADPRO style (Inter font, purple gradients)
2. Fix menu navigation link colors
3. Add more polished hover effects
4. Test full checkout flow
5. Deploy production updates