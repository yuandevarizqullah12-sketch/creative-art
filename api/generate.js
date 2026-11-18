/*
 * POST /api/generate
 *
 * Request  (JSON): { "prompt": string, "style": string, "aspect": string }
 * Success  (200):  { "ok": true, "image": "<base64>", "mime": "image/jpeg", "model": "..." }
 * Failure  (4xx/5xx): { "ok": false, "error": { "code": string, "message": string } }
 *
 * Cloudflare contract for @cf/black-forest-labs/flux-1-schnell (REST):
 *   input : { prompt: string (1-2048 chars), steps?: integer (default 4, max 8) }
 *   output: { result: { image: "<base64>" }, success: boolean, errors: [], messages: [] }
 * The model takes no width/height, so aspect ratio is handled in the browser by
 * centre-cropping; the server only adds a composition hint to the prompt.
 *
 * Environment variables: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 */

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT_LENGTH = 1000;      // user-facing limit (model allows 2048 incl. our additions)
const MAX_BODY_BYTES = 4 * 1024;
const STEPS = 4;                     // model default; documented maximum is 8
const UPSTREAM_TIMEOUT_MS = 25_000;
const RATE_LIMIT = { windowMs: 60_000, max: 6 };

// Keys must match config.js. Suffixes are fixed server-side text.
const STYLES = {
  'realistic': 'photorealistic, natural lighting, sharp focus, fine detail',
  'anime': 'anime style, clean line art, vibrant colors, cel shading, detailed background',
  '3d-render': '3D render, soft studio lighting, smooth materials, high detail',
  'fantasy': 'fantasy illustration, epic atmosphere, dramatic lighting, rich detail',
  'watercolor': 'watercolor painting, soft washes, visible paper texture, delicate color bleeding',
  'pixel-art': 'pixel art, limited color palette, crisp pixels, retro game aesthetic',
  'surrealism': 'surrealist art, dreamlike, unexpected juxtapositions, imaginative composition',
  'digital-painting': 'digital painting, painterly brushwork, rich colors, concept art'
};

const ASPECTS = {
  '1:1': 'balanced square composition',
  '16:9': 'wide horizontal composition with the main subject centered',
  '3:4': 'vertical portrait composition with the main subject centered'
};

export const config = { maxDuration: 30 };

// Best-effort limiter. Each Vercel function instance has its own memory, so
// this is NOT a reliable global limit (see README, "Rate limiting").
const hits = new Map();

function sendError(res, status, code, message, extraHeaders) {
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  return res.status(status).json({ ok: false, error: { code, message } });
}

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || '';
  const first = String(raw).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function retryAfterSeconds(ip) {
  const now = Date.now();
  if (hits.size > 2000) {
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }
  const entry = hits.get(ip);
  if (!entry || entry.reset <= now) {
    hits.set(ip, { count: 1, reset: now + RATE_LIMIT.windowMs });
    return 0;
  }
  if (entry.count >= RATE_LIMIT.max) return Math.max(1, Math.ceil((entry.reset - now) / 1000));
  entry.count += 1;
  return 0;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl) send no Origin
  try {
    return new URL(origin).host === req.headers.host;
  } catch (_) {
    return false;
  }
}

function readJsonBody(req) {
  let body;
  try {
    body = req.body; // Vercel parses JSON; the getter throws on malformed JSON
  } catch (_) {
    return null;
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function sanitizePrompt(value) {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectMime(base64) {
  const head = Buffer.from(base64.slice(0, 32), 'base64');
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function mapUpstreamError(res, status, payload, headers) {
  const errors = Array.isArray(payload && payload.errors) ? payload.errors : [];
  const text = errors.map((e) => String((e && e.code) || '') + ' ' + String((e && e.message) || '')).join(' ');
  // Log codes only. Never log the token or request headers.
  console.error('Cloudflare error', { status, codes: errors.map((e) => e && e.code) });

  if (status === 401 || status === 403) {
    return sendError(res, 502, 'upstream_auth', 'The image service rejected this site\'s credentials. The site owner needs to check the server configuration.');
  }
  if (/nsfw/i.test(text)) {
    return sendError(res, 422, 'content_rejected', 'The image service did not accept this prompt. Try describing something different.');
  }
  if (/daily|allocation|neurons|quota/i.test(text)) {
    return sendError(res, 429, 'quota_exhausted', 'The daily image allowance has been used up. Try again tomorrow.');
  }
  if (status === 429) {
    const header = Number(headers.get('retry-after'));
    const wait = Number.isFinite(header) && header > 0 ? Math.ceil(header) : 30;
    return sendError(res, 429, 'upstream_rate_limited', 'The image service is busy. Try again in ' + wait + ' seconds.', { 'Retry-After': String(wait) });
  }
  if (status === 400 || status === 413 || status === 422) {
    return sendError(res, 502, 'upstream_rejected', 'The image service could not process this prompt. Try rewording it.');
  }
  return sendError(res, 502, 'upstream_error', 'The image service had a problem. Please try again in a moment.');
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Use POST for this endpoint.', { Allow: 'POST' });
  }
  if (!originAllowed(req)) {
    return sendError(res, 403, 'forbidden_origin', 'Requests from other sites are not allowed.');
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return sendError(res, 415, 'invalid_request', 'Send the request as application/json.');
  }
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return sendError(res, 413, 'invalid_request', 'The request is too large.');
  }

  const body = readJsonBody(req);
  if (!body) {
    return sendError(res, 400, 'invalid_request', 'The request body must be a JSON object.');
  }
  if (typeof body.prompt !== 'string') {
    return sendError(res, 400, 'invalid_request', 'A text prompt is required.');
  }
  const prompt = sanitizePrompt(body.prompt);
  if (!prompt) {
    return sendError(res, 400, 'invalid_request', 'Describe the artwork you want to create.');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return sendError(res, 400, 'invalid_request', 'Keep the prompt under ' + MAX_PROMPT_LENGTH + ' characters.');
  }
  if (typeof body.style !== 'string' || !Object.prototype.hasOwnProperty.call(STYLES, body.style)) {
    return sendError(res, 400, 'invalid_request', 'Choose one of the available art styles.');
  }
  if (typeof body.aspect !== 'string' || !Object.prototype.hasOwnProperty.call(ASPECTS, body.aspect)) {
    return sendError(res, 400, 'invalid_request', 'Choose one of the available shapes.');
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token || !/^[a-f0-9]{32}$/i.test(accountId)) {
    console.error('Missing or malformed CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
    return sendError(res, 500, 'server_misconfigured', 'The image service is not configured yet. The site owner needs to set it up.');
  }

  const wait = retryAfterSeconds(clientIp(req));
  if (wait > 0) {
    return sendError(res, 429, 'rate_limited', 'You are creating images quickly. Try again in ' + wait + ' seconds.', { 'Retry-After': String(wait) });
  }

  const finalPrompt = prompt + ', ' + STYLES[body.style] + ', ' + ASPECTS[body.aspect];
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/run/' + MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  let text;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPrompt, steps: STEPS }),
      signal: controller.signal
    });
    text = await upstream.text();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return sendError(res, 504, 'upstream_timeout', 'The image service took too long to respond. Please try again.');
    }
    console.error('Cloudflare request failed', err && err.name);
    return sendError(res, 502, 'upstream_unreachable', 'Could not reach the image service. Please try again.');
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = null;
  }

  if (!upstream.ok || (payload && payload.success === false)) {
    return mapUpstreamError(res, upstream.status, payload, upstream.headers);
  }

  const image = payload && payload.result && payload.result.image;
  if (typeof image !== 'string' || image.length < 1000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    console.error('Cloudflare returned an unexpected payload shape');
    return sendError(res, 502, 'invalid_image', 'The image service returned something that is not an image. Please try again.');
  }
  const mime = detectMime(image);
  if (!mime) {
    return sendError(res, 502, 'invalid_image', 'The image service returned an unsupported image format. Please try again.');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, image, mime, model: MODEL });
}
