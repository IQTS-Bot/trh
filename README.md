# Relica — Multi‑Platform Antique Analysis (GitHub + Netlify)

This repo contains:
- `app.html` — Full Relica app (camera/upload, AI identify, multi-platform analysis)
- `index.html` — Self‑test page to verify your Netlify Functions
- `netlify/functions/vision.js` — Google Vision proxy (keeps your key secret)
- `netlify/functions/market-aggregate.js` — Aggregates market data across platforms
- `netlify/functions/health.js` — Simple health check
- `netlify.toml` — Points Netlify at the functions folder
- `logo_gold_color.png` — Header logo (optional)

## 1) Push this to GitHub
1. Create a new, empty GitHub repo.
2. Clone it locally, copy these files in.
3. Commit and push.

## 2) Import from Git in Netlify
- Netlify → **Add new site** → **Import from Git** → pick your repo.
- **Build command:** *(leave empty)*
- **Publish directory:** `/` (root)
- Deploy.

## 3) Set environment variables in Netlify
Site settings → Environment variables:
- `VISION_API_KEY` = your Google Cloud Vision API key (**required for auto‑ID**)
- `EBAY_OAUTH_TOKEN` = your eBay App OAuth token (**optional**, enables live eBay pricing/counts)
- `EBAY_MARKETPLACE_ID` = `EBAY_US` (optional; default is `EBAY_US`)

## 4) Verify functions are running
Open your site root (`/`) and click:
- **Run health** → should return `{ ok: true }`
- **Ping Vision** → should either return Vision JSON or report "not configured"
- **Run aggregator** → should return JSON with platforms

## 5) Use the app
Go to `/app.html` to use the full Relica app.

## Notes
- Opening `app.html` as a local file will not work (no camera, no functions). Use HTTPS (Netlify).
- On first deploy, give Netlify a moment to build functions.
- Check **Site → Functions → Logs** for any errors.
- If a marketplace doesn’t expose APIs or requires login, the function falls back to **link‑only** with a direct search link.

