# skucha

Static site prepared for Azure Static Web Apps.

## What Is Deployed

- `index.html` - launcher entrypoint (auto-redirects to mobile or desktop variant)
- `skucha-mobile.html` - mobile page (copied from Claude export)
- `skucha-desktop.html` - desktop page (copied from Claude export)
- `skucha-print.html` - print variant page
- `support.js` - runtime required by Claude-generated pages
- `config/config.json` - single source of truth for pricing, contact and addresses
- `config/config-loader.js` - loads config and injects values into pages
- `source/claude-exports/` - original Claude export sources (kept for reference)

Legacy mockup files were removed during cleanup. The deployed entrypoint is `index.html`.

## Local Check

Open `index.html` in browser and verify:

1. On desktop width, it redirects to `skucha-desktop.html`.
2. On mobile width, it redirects to `skucha-mobile.html`.
3. `skucha-print.html` loads directly.
4. Changes in `config/config.json` are visible after page refresh.

## Configure Business Data

Edit only this file:

- `config/config.json`

Key sections:

- `contact.phone` and `contact.whatsapp` - phone and WhatsApp number
- `contact.email` - business email
- `pricing.weekday`, `pricing.weekend`, `pricing.deliveryPerPad` - prices
- `pickupPoints[0]` and `pickupPoints[1]` - pickup names and addresses
- `branding.accent` and `branding.ink` - main colors

All page variants (`skucha-mobile.html`, `skucha-desktop.html`, `skucha-print.html`) consume these values through `config/config-loader.js`.

## Push To Git

```powershell
git add .
git commit -m "Assemble Claude pages for Azure Static Web Apps deployment"
git push
```

## Azure Static Web Apps Settings

Use these values in Azure:

- App location: `/`
- API location: `(leave empty)`
- Output location: `(leave empty)`

This repository is already plain static HTML/CSS/JS, so no build step is required.
