# Asad Downloader Online API

This is the optional zero-install online mode.

Architecture:
GitHub Pages -> Cloudflare Worker -> SaveAPI -> direct media URL -> browser.

Current provider reference (Sep 2026): SaveAPI documents a free tier with 1,000 free credits and a 10 requests/minute limit. Successful generic download resolution starts at 1.5 credits. These limits can change and are not unlimited public capacity.

Setup:
1. Create a SaveAPI account and copy your API key.
2. Create a Cloudflare account.
3. In GitHub repository Settings -> Secrets and variables -> Actions add:
   CLOUDFLARE_API_TOKEN
   CLOUDFLARE_ACCOUNT_ID
   SAVEAPI_KEY
4. Push the worker files on main or run the GitHub Action manually.
5. Copy the resulting workers.dev URL into online-config.js:
   window.ASAD_ONLINE_API_BASE = "https://YOUR-WORKER.workers.dev";
6. Push online-config.js.

Never put SAVEAPI_KEY into app.js, HTML, online-config.js, or any public file.

The browser may still ask permission for multiple downloads. The provider only supports public content, and the website must not be used to bypass access controls, CAPTCHAs, or platform restrictions.
