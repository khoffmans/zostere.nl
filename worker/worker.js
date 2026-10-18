// Zösters Vertaler — Cloudflare Worker
// Houdt de Anthropic API-sleutel geheim en stuurt inzendingen en verbetervoorstellen door naar het Google Apps Script.
//
// Geheimen (via `npx wrangler secret put NAAM`):
//   ANTHROPIC_API_KEY   — sleutel uit console.anthropic.com
//   APPS_SCRIPT_URL     — web-app-URL van het Apps Script (eindigt op /exec)
//   APPS_SCRIPT_SECRET  — het geheim dat setup() in het Apps Script heeft gemaakt

const ALLOWED_ORIGINS = ['https://zostere.nl', 'https://www.zostere.nl'];
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_PROMPT_CHARS = 150000;   // de opdracht met woordenlijst en voorbeelden is meestal 10–20 duizend tekens
const MAX_TEXT_CHARS = 8000;       // hoe lang de te vertalen tekst zelf mag zijn
const MAX_PHOTO_B64 = 400000;      // de site verkleint foto's tot ruim onder deze grens

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed) return json({ code: 'forbidden' }, 403, cors);

    const url = new URL(req.url);
    const ip = req.headers.get('CF-Connecting-IP') || 'onbekend';

    try {
      // ---- Vertalen (streamt het antwoord van Claude door) ----
      if (url.pathname === '/vertaal' && req.method === 'POST') {
        if (!(await allow(env.LIMIT_VERTAAL, ip))) return json({ code: 'rate_limited' }, 429, cors);
        const body = await req.json().catch(() => null);
        const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
        if (!prompt) return json({ code: 'bad_request' }, 400, cors);
        if (prompt.length > MAX_PROMPT_CHARS) return json({ code: 'too_long' }, 413, cors);
        // Alleen opdrachten die van de vertaalsite komen (bevatten de taalgids)
        if (!prompt.includes('TAALGIDS ZÖSTERS')) return json({ code: 'bad_request' }, 400, cors);
        const m = prompt.match(/<<<\n([\s\S]*?)\n>>>/);
        if (!m || m[1].length > MAX_TEXT_CHARS) return json({ code: 'too_long' }, 413, cors);

        const up = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: env.MODEL || DEFAULT_MODEL,
            max_tokens: 4000,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!up.ok) {
          console.log('Anthropic API', up.status, (await up.text()).slice(0, 500));
          const code = up.status === 429 || up.status === 529 ? 'busy' : 'upstream';
          return json({ code }, 502, cors);
        }
        return new Response(up.body, {
          headers: { ...cors, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }

      // ---- Goedgekeurde verbeteringen ophalen ----
      if (url.pathname === '/verbeteringen' && req.method === 'GET') {
        const cache = caches.default;
        const key = new Request(url.origin + '/__cache/verbeteringen');
        const hit = await cache.match(key);
        if (hit) return new Response(hit.body, { headers: { ...cors, 'content-type': 'application/json' } });
        const r = await appsScript(env, { action: 'verbeteringen' });
        const text = JSON.stringify({ items: r.items || [] });
        ctx.waitUntil(cache.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } })));
        return new Response(text, { headers: { ...cors, 'content-type': 'application/json' } });
      }

      // ---- Verbetervoorstel ----
      if (url.pathname === '/voorstel' && req.method === 'POST') {
        if (!(await allow(env.LIMIT_INZEND, ip))) return json({ code: 'rate_limited' }, 429, cors);
        const b = await req.json().catch(() => null);
        if (!b) return json({ code: 'bad_request' }, 400, cors);
        const d = {
          nl: str(b.nl, 4000), zo: str(b.zo, 4000), concept: str(b.concept, 4000),
          bron: b.bron === 'li' ? 'li' : 'nl', dialect: str(b.dialect, 40),
        };
        if (!d.nl || !d.zo) return json({ code: 'bad_request' }, 400, cors);
        await appsScript(env, { action: 'voorstel', ...d });
        return json({ ok: true }, 200, cors);
      }

      // ---- Inzending voor de Vastelaovesgezèt ----
      if (url.pathname === '/inzending' && req.method === 'POST') {
        if (!(await allow(env.LIMIT_INZEND, ip))) return json({ code: 'rate_limited' }, 429, cors);
        const b = await req.json().catch(() => null);
        if (!b) return json({ code: 'bad_request' }, 400, cors);
        if (b.website) return json({ ok: true }, 200, cors); // honeypot: bots vullen dit veld in
        const d = {
          titel: str(b.titel, 120), naam: str(b.naam, 100), tel: str(b.tel, 30),
          tekst: str(b.tekst, 20000), bron: str(b.bron, 20000),
          bronTaal: b.bronTaal === 'li' ? 'li' : 'nl', dialect: str(b.dialect, 40), foto: null,
        };
        if (!d.titel || !d.naam || !d.tekst) return json({ code: 'bad_request' }, 400, cors);
        if (typeof b.foto === 'string' && b.foto) {
          if (b.foto.length > MAX_PHOTO_B64 || !/^[A-Za-z0-9+/=]+$/.test(b.foto)) return json({ code: 'too_long' }, 413, cors);
          d.foto = b.foto;
        }
        await appsScript(env, { action: 'inzending', ...d });
        return json({ ok: true }, 200, cors);
      }

      return json({ code: 'not_found' }, 404, cors);
    } catch (err) {
      console.log('Fout', String(err && err.stack || err));
      return json({ code: 'upstream' }, 502, cors);
    }
  },
};

async function allow(limiter, key) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

async function appsScript(env, payload) {
  const r = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, secret: env.APPS_SCRIPT_SECRET }),
    redirect: 'follow',
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Apps Script gaf geen JSON (' + r.status + '): ' + text.slice(0, 200)); }
  if (!j.ok) throw new Error('Apps Script: ' + (j.error || 'onbekende fout'));
  return j;
}
