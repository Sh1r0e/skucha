# skucha

Static site prepared for Azure Static Web Apps.

## What Is Deployed

- `index.html` - launcher entrypoint (auto-redirects to mobile or desktop variant)
- `skucha-mobile.html` - mobile page (copied from Claude export)
- `skucha-desktop.html` - desktop page (copied from Claude export)
- `skucha-print.html` - print variant page
- `support.js` - runtime required by Claude-generated pages

Legacy mockup files (`styles.css`, `script.js`) are still in repo, but the deployed entrypoint is now `index.html`.

## Local Check

Open `index.html` in browser and verify:

1. On desktop width, it redirects to `skucha-desktop.html`.
2. On mobile width, it redirects to `skucha-mobile.html`.
3. `skucha-print.html` loads directly.

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
