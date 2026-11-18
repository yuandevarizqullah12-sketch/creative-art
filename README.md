# Creative Art

Turn imagination into art. Creative Art turns text prompts into AI-generated artwork using
[FLUX.1 \[schnell\]](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) on Cloudflare Workers AI.

- Frontend: HTML, CSS and vanilla JavaScript. No framework, no build step, no dependencies.
- Backend: one Vercel Serverless Function (`api/generate.js`, Node.js, native `fetch`).
- Gallery: saved artwork is stored as image Blobs in the browser's IndexedDB.

## Project structure

```
creative-art/
├── index.html          Page markup
├── style.css           Styles and responsive rules
├── script.js           UI, generation flow, cropping, IndexedDB gallery
├── config.js           Client config (styles, shapes, prompt ideas). No secrets.
├── api/generate.js     Vercel Serverless Function that calls Cloudflare
├── assets/
│   ├── images/         hero-art.svg (decorative illustration)
│   └── icons/          favicon.svg
├── package.json
├── .gitignore
└── README.md
```

## Setup

### 1. Get Cloudflare credentials

1. Create a free Cloudflare account and open the dashboard.
2. Copy your **Account ID** (32 hex characters; shown on the Workers AI page or in the dashboard sidebar).
3. Create an **API token** (My Profile, API Tokens, Create Token). Use the "Workers AI" template, or a custom token
   with the Workers AI read/edit permission for your account.

### 2. Set environment variables

| Name | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your 32-character account ID |
| `CLOUDFLARE_API_TOKEN` | The API token from step 1 |

For local development, create a file named `.env.local` in the project root (it is git-ignored by `.env*`):

```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
```

### 3. Run locally

```bash
npm run dev          # runs: npx vercel dev
```

Open the URL it prints. `vercel dev` serves the static files and runs `api/generate.js` locally.
Opening `index.html` directly from disk will not work, because `/api/generate` needs the Vercel runtime.

Syntax check: `npm run check`.

### 4. Deploy

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New, Project**, import the repository and keep the defaults (Framework Preset: Other,
   no build command, no output directory).
3. Under **Settings, Environment Variables**, add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
   for the Production (and Preview) environments, then redeploy.

`api/generate.js` sets `maxDuration` to 30 seconds. FLUX.1 schnell normally answers in a few seconds.
If your Vercel plan or project settings cap duration lower, the function will be cut off by Vercel and the
browser will show a server error.

## How generation works

1. The browser validates the prompt (required, 1 to 1000 characters) and sends
   `POST /api/generate` with `{ prompt, style, aspect }`.
2. The server validates every field, strips control characters, adds a fixed style phrase and a composition hint,
   and calls Cloudflare with `{ prompt, steps: 4 }`.
3. Cloudflare returns `{ result: { image: "<base64>" } }`. The server checks that the data is base64, detects the real
   image type from its first bytes (JPEG, PNG or WebP) and returns `{ ok, image, mime }`.
4. The browser decodes the image, crops it to the chosen shape, shows it, and offers Download and Save.

Model parameters used: only `prompt` (1 to 2048 characters) and `steps` (default 4, documented maximum 8).
The app does not send a seed, width or height.

### Aspect ratio strategy (important)

FLUX.1 schnell on Workers AI has **no width, height or aspect-ratio input**. Every image comes back at the model's
own fixed size. So:

- **Square (1:1):** the image is shown as returned.
- **Landscape (16:9) and Portrait (3:4):** the server adds a prompt hint ("wide horizontal composition with the main
  subject centered"), and the browser **center-crops** the returned image with a canvas to the chosen ratio.
  The cropped file is what you preview, download and save. Cropping removes pixels, so these shapes have lower
  resolution than Square, and anything near the edges of the original may be cut off.

The UI states this next to the shape selector.

## Security notes

- Cloudflare credentials exist only in server environment variables. They are never sent to the browser, never
  included in responses, and never logged. `.env*` is git-ignored.
- The server accepts `POST` only, requires `application/json`, limits the body to 4 KB, validates `style` and
  `aspect` against allow-lists, and validates the account ID format before building the Cloudflare URL.
- The server only ever contacts the fixed Cloudflare endpoint. It never fetches URLs supplied by the client,
  and the client never supplies image URLs.
- Browser requests from a different origin are rejected (`Origin` must match `Host`). This stops other websites from
  using your endpoint from a visitor's browser. It does **not** stop someone calling the endpoint directly with curl.
- The page ships a Content-Security-Policy meta tag (scripts and connections limited to the same origin; Google Fonts
  allowed for the typeface). It uses no inline scripts or styles.
- Errors returned to the client are generic and consistent: `{ "ok": false, "error": { "code", "message" } }`.

### Rate limiting (limitation)

The function includes a **best-effort** limit of 6 requests per minute per IP. It lives in function memory, and Vercel
may run several instances (and restarts them), each with its own counter. **It is not a reliable global limit** and
does not protect your Cloudflare allowance from a determined abuser. For real protection, add one of:

- Vercel Firewall rate-limiting rules (check availability on your plan), or
- a shared store such as Upstash Redis or Vercel KV, keyed by IP, or
- authentication or a CAPTCHA in front of `/api/generate`.

Cloudflare's own free daily allowance is the final backstop. When it runs out, the app shows "Daily limit reached".

## Error handling

| Situation | What the user sees |
| --- | --- |
| Empty or over-long prompt | Inline message under the prompt; no request sent |
| No connection | "Cannot reach the server" with a retry button |
| Request takes too long | "The request timed out" with a retry button |
| Invalid or missing Cloudflare credentials | "Image service unavailable" (details only in server logs) |
| Too many requests (ours or Cloudflare's) | "Too many requests", with the wait time |
| Cloudflare daily allowance used up | "Daily limit reached" |
| Prompt rejected by Cloudflare's content filter | "Prompt not accepted" |
| Response is not a valid image | "Unusable image received" |
| Any other server error | "Something went wrong" |

The app never shows a placeholder or sample image as a generated result.

## Testing procedure

### With real credentials (required before you can say generation works)

1. Set the two environment variables and run `npm run dev`.
2. Direct API test:

   ```bash
   curl -s -X POST http://localhost:3000/api/generate \
     -H "Content-Type: application/json" \
     -d '{"prompt":"a lighthouse at dusk","style":"watercolor","aspect":"1:1"}' \
     | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.ok,r.mime,(r.image||'').length)})"
   ```

   Expected: `true image/jpeg <a number above 1000>`. Anything else prints the error code in the JSON.
3. In the browser: generate an image in each shape, then check Download (the file opens and has the right shape),
   Save to gallery, reload the page (the artwork is still there), open the preview, download it again, and delete it.
4. Error checks: temporarily set a wrong `CLOUDFLARE_API_TOKEN` and confirm you get "Image service unavailable";
   turn off your network and confirm "Cannot reach the server".

### What was checked during development

The development environment had no Cloudflare credentials and no internet access, so **no live image was generated
and the Cloudflare call has not been verified end to end.** What was verified:

- The request and response shapes follow Cloudflare's published schema for this model.
- The API handler was exercised with a mocked Cloudflare: validation, method and origin checks, success, auth,
  quota, rate-limit, NSFW, timeout, network, malformed-payload and not-an-image cases, plus a check that the token
  never appears in any response. All passed.
- The frontend ran in headless Chromium against a stubbed `/api/generate` that returned a local test image:
  validation, loading state, double-submit guard, cropping to 16:9 and 3:4, download, IndexedDB save, reload
  persistence, preview, delete, every error state, Explore, Reset, and responsive layouts at 375, 820 and 1280 px.
  No console or CSP errors.

## Credits and licence notes

- FLUX.1 \[schnell\] by Black Forest Labs, served by Cloudflare Workers AI. Review the model's terms and license
  (linked from the Cloudflare model page) before using output commercially.
- Typeface: Bricolage Grotesque via Google Fonts, with system fonts as a fallback.
