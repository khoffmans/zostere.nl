// Bouwt zostere.nl/aktiviteite: de kalenderpagina, een pagina per activiteit (met schema.org/Event),
// een agendabestand (.ics) per activiteit, en de sitemap.
// Bronnen: goedgekeurde regels uit de Google Sheet (via het Apps Script) + aktiviteite/vast.json.
// Wordt elk uur uitgevoerd door .github/workflows/aktiviteite.yml.
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://zostere.nl';
const API = 'https://script.google.com/macros/s/AKfycbw3Zu2mL3GQAaLOqeE8wQuM0bn3Zt2biqDMkbFcW6qHO6Y5ZCPFBf1uwCnFH-mS_zQ/exec';
const ROOT = process.cwd();
const DIR = path.join(ROOT, 'aktiviteite');

export const CATS = {
  'Vastelaovend':      { kleur: '#c62828', donker: '#ef6c6c' },
  'Kirmes & fieëste':  { kleur: '#d9730d', donker: '#f0a050' },
  'Meziek & cultuur':  { kleur: '#7b4fb3', donker: '#b391e0' },
  'Natuur & wanjele':  { kleur: '#3d8b2f', donker: '#7fc46f' },
  'Kirk':              { kleur: '#2f62a8', donker: '#7aa6e6' },
  'Sport':             { kleur: '#13867c', donker: '#4fc2b6' },
  'Kènjer':            { kleur: '#c2417d', donker: '#ec84b5' },
  'Markt':             { kleur: '#8a5a2b', donker: '#c99a6a' },
  'Anger':             { kleur: '#68737a', donker: '#a3adb3' },
};
const MAAND = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const DAG = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];

// ---------- hulpfuncties ----------
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)); };
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
function slugify(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[’'`]/g,'').replace(/&/g,' en ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'aktiviteit';
}
function datumLang(s) { const d = pd(s); return `${DAG[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function datumKort(s) { const d = pd(s); return `${DAG[d.getUTCDay()].slice(0,2)} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`; }
function wanneer(a) {
  let t = datumLang(a.datum);
  if (a.eind && a.eind !== a.datum) t = `${datumKort(a.datum)} t/m ${datumLang(a.eind)}`;
  return t;
}
function tijdVan(s) { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? `${m[1].padStart(2,'0')}:${m[2]}` : ''; }
function offset(datum, tijd) { // +01:00 of +02:00 voor Nederland op die dag
  const d = new Date(`${datum}T${tijd || '12:00'}:00Z`);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', timeZoneName: 'longOffset' }).formatToParts(d).find(x => x.type === 'timeZoneName');
  const m = p && p.value.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+01:00';
}
function isoStart(a) { const t = tijdVan(a.tijd); return t ? `${a.datum}T${t}:00${offset(a.datum, t)}` : a.datum; }
function isoEind(a) { return a.eind && a.eind !== a.datum ? a.eind : ''; }
function kortTekst(s, n = 155) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }

function normaliseer(a, bron) {
  if (!a || !a.titel || !/^\d{4}-\d{2}-\d{2}$/.test(a.datum || '')) return null;
  const cat = CATS[a.cat] ? a.cat : 'Anger';
  const o = {
    datum: a.datum, eind: /^\d{4}-\d{2}-\d{2}$/.test(a.eind || '') && a.eind > a.datum ? a.eind : '',
    tijd: String(a.tijd || '').trim(), deuren: String(a.deuren || '').trim(), prijs: String(a.prijs || '').trim(),
    titel: String(a.titel).trim(), cat, plaats: String(a.plaats || '').trim(), org: String(a.org || '').trim(),
    tekst: String(a.tekst || '').trim(), link: /^https?:\/\//.test(a.link || '') ? a.link : '', bron,
  };
  o.slug = `${o.datum}-${slugify(o.titel)}`;
  return o;
}

// ---------- gegevens ophalen ----------
async function uitSheet() {
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'aktiviteite' }), redirect: 'follow' });
    const j = await r.json();
    if (j && j.ok && Array.isArray(j.items)) return j.items;
  } catch (e) { console.error('Sheet niet bereikbaar:', e.message); }
  return null;
}
const leesJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const schrijf = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// ---------- gedeelde opmaak ----------
function kop({ titel, beschrijving, url, extra = '' }) {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beschrijving)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="nl_NL">
<meta property="og:site_name" content="Zöstere.nl">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschrijving)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230d5e63'/%3E%3Ctext x='16' y='23' font-family='Georgia,serif' font-size='20' font-weight='700' text-anchor='middle' fill='%23e3b448'%3EZ%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}</style>
${extra}
</head>
<body>
<div class="wrap">
  <nav class="site" aria-label="Zöstere.nl">
    <a class="home" href="/">Zöstere<span>.nl</span></a>
    <a href="/vertaler/">Sjrief Zösters</a>
    <a href="/aktiviteite/" aria-current="page">Aktiviteite</a>
  </nav>`;
}
const voet = `
  <footer>Ontbreekt er iets of klopt er iets niet? Meld het via <a href="/aktiviteite/#aanmelden">Aktiviteit aanmelden</a> of mail naar <a href="mailto:info@zostere.nl">info@zostere.nl</a>. · <a href="/privacy/">Privacy</a></footer>
</div>`;

const catVars = Object.entries(CATS).map(([n, c], i) => `--c${i}:${c.kleur}`).join(';');
const catVarsDonker = Object.entries(CATS).map(([n, c], i) => `--c${i}:${c.donker}`).join(';');
const catIndex = n => Object.keys(CATS).indexOf(n);

const CSS = `
:root{--paper:#f5f6f2;--sheet:#fff;--ink:#1c2629;--muted:#5a676b;--line:#d5dbd8;--maas:#0d5e63;--goud:#b7860f;--goud-soft:#f7edd3;--warn:#9a4a12;${catVars};
--display:"Zilla Slab",Rockwell,"Roboto Slab",Georgia,serif;--body:"Source Serif 4",Georgia,"Times New Roman",serif;--ui:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{--paper:#11181a;--sheet:#182124;--ink:#e4ebe9;--muted:#9aa8a9;--line:#2c3a3d;--maas:#63bfc0;--goud:#e3b448;--goud-soft:#2e2814;--warn:#e8935a;${catVarsDonker};color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font-family:var(--ui);font-size:15px;line-height:1.5;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 64px}
.wrap{max-width:960px;margin:0 auto;display:grid;gap:28px}
nav.site{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline;font-size:14px}
nav.site .home{font-family:var(--display);font-weight:700;font-size:20px;color:var(--ink);text-decoration:none;margin-right:8px}
nav.site .home span{color:var(--goud)}nav.site a{color:var(--muted);text-decoration:none}
nav.site a:hover,nav.site a[aria-current="page"]{color:var(--maas)}nav.site a[aria-current="page"]{font-weight:600}
h1{font-family:var(--display);font-weight:700;font-size:clamp(32px,6vw,52px);line-height:1.05;margin:0;text-wrap:balance}
h2{font-family:var(--display);font-weight:600;font-size:24px;margin:0;text-wrap:balance}
.lede{font-family:var(--body);font-size:17px;color:var(--muted);margin:0;max-width:62ch}
a{color:var(--maas)}
button{font-family:var(--ui);font-size:14px;font-weight:500;border-radius:4px;border:1px solid var(--line);background:var(--sheet);color:var(--ink);padding:8px 14px;cursor:pointer}
button:hover{border-color:var(--maas)}button.primary,a.btn.primary{background:var(--maas);border-color:var(--maas);color:var(--sheet);font-weight:600}
button:disabled{opacity:.5;cursor:default}
a.btn{display:inline-block;font-size:14px;font-weight:500;border-radius:4px;border:1px solid var(--line);background:var(--sheet);color:var(--ink);padding:8px 14px;text-decoration:none}
a.btn:hover{border-color:var(--maas)}
:focus-visible{outline:2px solid var(--maas);outline-offset:2px}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:var(--muted)}
.tag i{width:10px;height:10px;border-radius:3px;background:var(--k);display:inline-block}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;border:1px solid var(--line);border-radius:999px;padding:4px 11px;background:transparent;color:var(--muted);cursor:pointer}
.chip i{width:9px;height:9px;border-radius:50%;background:var(--k)}
.chip[aria-pressed="true"]{border-color:var(--ink);color:var(--ink);background:var(--sheet);font-weight:600}
/* kalender */
.cal{background:var(--sheet);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.cal-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line);gap:8px}
.cal-head h2{font-size:22px;text-transform:capitalize}
.cal-head button{padding:6px 12px}
.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.wd{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)}
.day{min-height:92px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:4px 5px;display:flex;flex-direction:column;gap:3px;min-width:0;background:none;border-top:0;border-left:0;border-radius:0;text-align:left;font:inherit;color:inherit;cursor:default}
.day:nth-child(7n){border-right:0}
.day.leeg{background:var(--paper)}
.day .n{font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted);line-height:1.2}
.day.vandaag .n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--maas);color:var(--sheet);font-weight:600}
.pill{display:block;font-size:11.5px;line-height:1.25;padding:2px 5px;border-radius:3px;background:color-mix(in srgb,var(--k) 16%,transparent);border-left:3px solid var(--k);color:var(--ink);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill:hover{background:color-mix(in srgb,var(--k) 28%,transparent)}
.dots{display:none;gap:3px;flex-wrap:wrap}
.dots i{width:7px;height:7px;border-radius:50%;background:var(--k)}
.daglijst{padding:12px;border-top:1px solid var(--line);display:grid;gap:6px}
.daglijst h3{font-family:var(--display);font-size:17px;margin:0}
@media (max-width:640px){.day{min-height:54px;cursor:pointer}.pill{display:none}.dots{display:flex}.day[aria-pressed="true"]{background:var(--goud-soft)}}
/* lijst */
.month{display:grid}.month h2{font-size:22px;margin:0 0 6px;text-transform:capitalize}
.ev{display:grid;grid-template-columns:64px 1fr;gap:16px;padding:14px 0;border-top:1px solid var(--line);text-decoration:none;color:inherit}
.ev:hover .t{color:var(--maas);text-decoration:underline}
.date{background:var(--sheet);border:1px solid var(--line);border-top:4px solid var(--k);border-radius:6px;text-align:center;padding:5px 0;align-self:start;font-variant-numeric:tabular-nums}
.date .d{font-family:var(--display);font-weight:700;font-size:26px;line-height:1}
.date .m,.date .w{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ev .t{font-family:var(--display);font-weight:600;font-size:20px;line-height:1.2;margin:2px 0 0}
.ev .meta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 12px;margin-top:3px}
.empty{font-family:var(--body);color:var(--muted);font-size:16px;padding:20px 0;border-top:1px solid var(--line)}
/* detailpagina */
.crumb{font-size:13px;color:var(--muted)}.crumb a{color:var(--muted)}
.feiten{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0;padding:16px 18px;background:var(--sheet);border:1px solid var(--line);border-left:4px solid var(--k);border-radius:6px;font-size:15px}
.feiten dt{color:var(--muted);font-size:13px;padding-top:2px}.feiten dd{margin:0;font-weight:500}
.tekst{font-family:var(--body);font-size:18px;line-height:1.6;max-width:65ch;margin:0;white-space:pre-line}
.knoppen{display:flex;flex-wrap:wrap;gap:8px}
.voorbij{padding:10px 14px;border-radius:6px;background:var(--goud-soft);color:var(--goud);font-weight:600;font-size:14px}
.status{font-size:13px;color:var(--muted);min-height:1.2em}.status.err{color:var(--warn)}
dialog{border:1px solid var(--line);border-radius:8px;padding:0;background:var(--sheet);color:var(--ink);width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px)}
dialog::backdrop{background:rgba(10,16,18,.55)}
.dlg{display:grid;gap:12px;padding:20px}.dlg h3{font-family:var(--display);font-weight:600;font-size:22px;margin:0}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:480px){.row2{grid-template-columns:1fr}}
.field{display:grid;gap:4px;min-width:0}.field label{font-size:13px;font-weight:600}.opt{font-weight:400;color:var(--muted)}
.field input,.field select,.field textarea{font-family:var(--ui);font-size:16px;padding:8px 10px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink);width:100%}
.field textarea{min-height:90px;resize:vertical;font-family:var(--body)}
.actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center}.actions .status{flex:1}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
footer{font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}footer a{color:var(--muted)}
@media (prefers-reduced-motion:no-preference){.pill,.chip{transition:background .15s}}
`;

// ---------- onderdelen ----------
const kVar = cat => `--k:var(--c${catIndex(cat)})`;
function evRegel(a) {
  const d = pd(a.datum);
  return `<a class="ev" href="/aktiviteite/${a.slug}/" style="${kVar(a.cat)}" data-cat="${esc(a.cat)}">
      <div class="date" aria-hidden="true"><div class="w">${DAG[d.getUTCDay()].slice(0,2)}</div><div class="d">${d.getUTCDate()}</div><div class="m">${MAAND[d.getUTCMonth()].slice(0,3)}</div></div>
      <div style="min-width:0"><span class="tag"><i></i>${esc(a.cat)}</span>
        <h3 class="t">${esc(a.titel)}</h3>
        <div class="meta"><span>${esc(wanneer(a))}${tijdVan(a.tijd) ? ' · ' + esc(tijdVan(a.tijd)) : ''}</span>${a.plaats ? `<span>${esc(a.plaats)}</span>` : ''}${a.org ? `<span>${esc(a.org)}</span>` : ''}</div></div>
    </a>`;
}

function ics(a) {
  const e = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  const ymd = s => s.replace(/-/g,'');
  const t = tijdVan(a.tijd);
  let start, end;
  if (t && !a.eind) {
    const [hh, mm] = t.split(':').map(Number);
    start = `DTSTART;TZID=Europe/Amsterdam:${ymd(a.datum)}T${String(hh).padStart(2,'0')}${String(mm).padStart(2,'0')}00`;
    end = `DTEND;TZID=Europe/Amsterdam:${ymd(a.datum)}T${String(Math.min(23, hh + 3)).padStart(2,'0')}${String(mm).padStart(2,'0')}00`;
  } else {
    const n = pd(a.eind || a.datum); n.setUTCDate(n.getUTCDate() + 1);
    start = `DTSTART;VALUE=DATE:${ymd(a.datum)}`; end = `DTEND;VALUE=DATE:${n.toISOString().slice(0,10).replace(/-/g,'')}`;
  }
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//zostere.nl//aktiviteite//NL','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    `UID:${a.slug}@zostere.nl`, `DTSTAMP:${ymd(a.datum)}T000000Z`, start, end, `SUMMARY:${e(a.titel)}`,
    `LOCATION:${e([a.plaats, 'Susteren'].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${e([a.tekst, a.prijs ? 'Toegang: ' + a.prijs : '', `${SITE}/aktiviteite/${a.slug}/`].filter(Boolean).join('\n'))}`,
    `URL:${SITE}/aktiviteite/${a.slug}/`, 'END:VEVENT','END:VCALENDAR'].join('\r\n') + '\r\n';
}

function jsonLdEvent(a, voorbij) {
  const o = {
    '@context': 'https://schema.org', '@type': 'Event', name: a.titel, startDate: isoStart(a),
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: a.plaats || 'Susteren', address: { '@type': 'PostalAddress', addressLocality: 'Susteren', addressRegion: 'Limburg', addressCountry: 'NL' } },
    description: a.tekst || `${a.titel} in Susteren.`, url: `${SITE}/aktiviteite/${a.slug}/`, inLanguage: 'nl',
  };
  if (isoEind(a)) o.endDate = isoEind(a);
  if (a.org) o.organizer = { '@type': 'Organization', name: a.org, ...(a.link ? { url: a.link } : {}) };
  if (a.prijs) {
    const p = a.prijs.replace(/[^\d,.]/g,'').replace(',', '.');
    o.offers = { '@type': 'Offer', price: p || a.prijs, priceCurrency: 'EUR', url: `${SITE}/aktiviteite/${a.slug}/`, availability: voorbij ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' };
  }
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Zöstere.nl', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Aktiviteite', item: `${SITE}/aktiviteite/` },
    { '@type': 'ListItem', position: 3, name: a.titel, item: `${SITE}/aktiviteite/${a.slug}/` } ] };
  const j = s => JSON.stringify(s).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${j(o)}</script>\n<script type="application/ld+json">${j(crumbs)}</script>`;
}

function detailPagina(a, komend, nu) {
  const voorbij = (a.eind || a.datum) < nu;
  const url = `${SITE}/aktiviteite/${a.slug}/`;
  const titel = `${a.titel} – ${datumKort(a.datum)} ${pd(a.datum).getUTCFullYear()} in Zöstere | Zöstere.nl`;
  const beschr = kortTekst(`${a.titel} op ${wanneer(a)}${tijdVan(a.tijd) ? ' om ' + tijdVan(a.tijd) : ''}${a.plaats ? ', ' + a.plaats : ''} in Susteren (Zöstere). ${a.tekst}`);
  const na = komend.filter(x => x.slug !== a.slug && x.datum >= a.datum);
  const meer = (na.length >= 3 ? na : komend.filter(x => x.slug !== a.slug)).slice(0, 5);
  const deelTekst = encodeURIComponent(`${a.titel} – ${wanneer(a)}${tijdVan(a.tijd) ? ' ' + tijdVan(a.tijd) : ''} ${url}`);
  return kop({ titel, beschrijving: beschr, url, extra: jsonLdEvent(a, voorbij) }) + `
  <main style="display:grid;gap:22px;${kVar(a.cat)}">
    <div class="crumb"><a href="/">Zöstere.nl</a> › <a href="/aktiviteite/">Aktiviteite</a> › ${esc(a.titel)}</div>
    <header style="display:grid;gap:10px">
      <span class="tag"><i></i>${esc(a.cat)}</span>
      <h1>${esc(a.titel)}</h1>
    </header>
    ${voorbij ? '<p class="voorbij">Deze activiteit is voorbij.</p>' : ''}
    <dl class="feiten">
      <dt>Wanneer</dt><dd>${esc(wanneer(a))}</dd>
      ${a.tijd ? `<dt>Hoe laat</dt><dd>${esc(a.tijd)}${a.deuren ? ` <span style="color:var(--muted);font-weight:400">(deuren open ${esc(a.deuren)})</span>` : ''}</dd>` : ''}
      ${a.plaats ? `<dt>Waar</dt><dd>${esc(a.plaats)}, Susteren</dd>` : ''}
      ${a.org ? `<dt>Organisatie</dt><dd>${esc(a.org)}</dd>` : ''}
      ${a.prijs ? `<dt>Toegang</dt><dd>${esc(a.prijs)}</dd>` : ''}
    </dl>
    ${a.tekst ? `<p class="tekst">${esc(a.tekst)}</p>` : ''}
    <div class="knoppen">
      ${voorbij ? '' : `<a class="btn primary" href="/aktiviteite/${a.slug}/agenda.ics" download>Zet in mijn agenda</a>`}
      <a class="btn" href="https://wa.me/?text=${deelTekst}" target="_blank" rel="noopener">Deel via WhatsApp</a>
      ${a.link ? `<a class="btn" href="${esc(a.link)}" target="_blank" rel="noopener">Meer info</a>` : ''}
    </div>
    ${meer.length ? `<section style="display:grid;gap:4px"><h2 style="margin-bottom:6px">Meer aktiviteite in Zöstere</h2>${meer.map(evRegel).join('\n')}</section>` : ''}
    <p><a href="/aktiviteite/">← Alle aktiviteite</a></p>
  </main>` + voet + '\n</body>\n</html>\n';
}

function overzicht(komend, alle, nu) {
  const titel = 'Aktiviteite in Zöstere – agenda van Susteren | Zöstere.nl';
  const beschr = 'Wat is er te doen in Susteren (Zöstere)? Vastelaovend, kirmes, muziek, sport, kerk en meer, in een overzichtelijke maandkalender.';
  const url = `${SITE}/aktiviteite/`;
  const data = alle.map(a => ({ s: a.slug, d: a.datum, e: a.eind, t: a.titel, c: a.cat, u: tijdVan(a.tijd) }));
  const itemList = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: komend.slice(0, 50).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/aktiviteite/${a.slug}/`, name: a.titel })) };
  let lijst = '', huidig = '';
  for (const a of komend) {
    const d = pd(a.datum), key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key !== huidig) { if (huidig) lijst += '</section>'; huidig = key; lijst += `<section class="month" data-maand="${key}"><h2>${MAAND[d.getUTCMonth()]} ${d.getUTCFullYear()}</h2>`; }
    lijst += evRegel(a);
  }
  if (huidig) lijst += '</section>';
  const legend = Object.keys(CATS).map((n, i) => `<button type="button" class="chip" style="--k:var(--c${i})" data-cat="${esc(n)}" aria-pressed="false"><i></i>${esc(n)}</button>`).join('');
  return kop({ titel, beschrijving: beschr, url, extra: `<script type="application/ld+json">${JSON.stringify(itemList).replace(/</g,'\\u003c')}</script>` }) + `
  <header style="display:grid;gap:10px">
    <h1>Aktiviteite<span style="color:var(--goud)">.</span></h1>
    <p class="lede">Wat is d’r te doon in Zöstere? Vastelaovend, kirmes, meziek, sport en alles wat Susteren verder te bieden heeft. Organiseer je zelf iets? <a href="#aanmelden" id="meld-link">Meld het aan</a>.</p>
  </header>

  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
    <div class="chips" id="chips" aria-label="Filter op soort"><button type="button" class="chip" data-cat="" aria-pressed="true">Alles</button>${legend}</div>
    <button class="primary" id="meld" type="button">Aktiviteit aanmelden</button>
  </div>

  <section class="cal" aria-label="Maandkalender">
    <div class="cal-head"><button type="button" id="vorige" aria-label="Vorige maand">←</button><h2 id="maandnaam" aria-live="polite"></h2><button type="button" id="volgende" aria-label="Volgende maand">→</button></div>
    <div class="grid" id="grid"></div>
    <div class="daglijst" id="daglijst" hidden></div>
  </section>

  <section id="lijst" aria-label="Komende aktiviteite" style="display:grid;gap:22px">
    ${lijst || '<p class="empty">Er staan nog geen aktiviteite in de agenda. Weet jij er een? Meld hem aan!</p>'}
  </section>
` + voet + AANMELDEN + `
<script>
(function(){
"use strict";
const DATA=${JSON.stringify(data).replace(/</g,'\\u003c')};
const CATS=${JSON.stringify(Object.keys(CATS))};
const MAAND=${JSON.stringify(MAAND)};
const $=id=>document.getElementById(id);
const nu=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
let filter='', jaar=+nu.slice(0,4), maand=+nu.slice(5,7)-1, gekozen='';
const pad=n=>String(n).padStart(2,'0');
const kvar=c=>'--k:var(--c'+Math.max(0,CATS.indexOf(c))+')';
function opDag(s){ return DATA.filter(a=>(!filter||a.c===filter)&&a.d<=s&&(a.e||a.d)>=s); }
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function teken(){
  $('maandnaam').textContent=MAAND[maand]+' '+jaar;
  const g=$('grid'); g.textContent='';
  ['ma','di','wo','do','vr','za','zo'].forEach(w=>g.append(el('div','wd',w)));
  const eerste=new Date(Date.UTC(jaar,maand,1)), start=(eerste.getUTCDay()+6)%7, dagen=new Date(Date.UTC(jaar,maand+1,0)).getUTCDate();
  for(let i=0;i<start;i++) g.append(el('div','day leeg'));
  for(let d=1;d<=dagen;d++){
    const s=jaar+'-'+pad(maand+1)+'-'+pad(d), evs=opDag(s);
    const c=el('div','day'+(s===nu?' vandaag':'')); c.append(el('span','n',String(d)));
    if(evs.length){ c.setAttribute('role','button'); c.tabIndex=0; c.setAttribute('aria-pressed',String(gekozen===s)); c.setAttribute('aria-label',d+' '+MAAND[maand]+': '+evs.map(a=>a.t).join(', '));
      c.onclick=()=>{ gekozen=gekozen===s?'':s; teken(); }; c.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); c.onclick(); } }; }
    const dots=el('div','dots');
    evs.forEach(a=>{ const p=el('a','pill',(a.u&&a.d===s?a.u+' ':'')+a.t); p.href='/aktiviteite/'+a.s+'/'; p.style.cssText=kvar(a.c); p.title=a.t; p.onclick=e=>e.stopPropagation(); c.append(p); const i=el('i'); i.style.cssText=kvar(a.c); dots.append(i); });
    c.append(dots); g.append(c);
  }
  const rest=(7-(start+dagen)%7)%7; for(let i=0;i<rest;i++) g.append(el('div','day leeg'));
  const dl=$('daglijst'); dl.textContent='';
  if(gekozen&&gekozen.slice(0,7)===jaar+'-'+pad(maand+1)){
    const dd=new Date(gekozen+'T12:00:00'); const kop=dd.toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'}); dl.append(el('h3',null,kop.charAt(0).toUpperCase()+kop.slice(1)));
    opDag(gekozen).forEach(a=>{ const l=el('a','pill',(a.u?a.u+' · ':'')+a.t); l.href='/aktiviteite/'+a.s+'/'; l.style.cssText=kvar(a.c)+';display:block;white-space:normal;font-size:14px;padding:6px 8px'; dl.append(l); });
    dl.hidden=false;
  } else dl.hidden=true;
}
$('vorige').onclick=()=>{ maand--; if(maand<0){maand=11;jaar--;} gekozen=''; teken(); };
$('volgende').onclick=()=>{ maand++; if(maand>11){maand=0;jaar++;} gekozen=''; teken(); };
document.querySelectorAll('#chips .chip').forEach(b=>b.onclick=()=>{
  filter=b.dataset.cat; document.querySelectorAll('#chips .chip').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  document.querySelectorAll('#lijst .ev').forEach(e=>{ e.hidden=!!filter&&e.dataset.cat!==filter; });
  document.querySelectorAll('#lijst .month').forEach(m=>{ m.hidden=![...m.querySelectorAll('.ev')].some(e=>!e.hidden); });
  teken();
});
teken();
})();
</script>
</body>
</html>
`;
}

const AANMELDEN = `
<dialog id="dlg" aria-labelledby="dlg-h">
  <form class="dlg" id="form" method="dialog" novalidate>
    <h3 id="dlg-h">Aktiviteit aanmelden</h3>
    <p class="status" style="margin:0">Na een korte controle verschijnt je activiteit op de site.</p>
    <div class="hp" aria-hidden="true"><label for="f-web">Laat dit veld leeg</label><input type="text" id="f-web" tabindex="-1" autocomplete="off"></div>
    <div class="field"><label for="f-titel">Naam van de activiteit</label><input type="text" id="f-titel" maxlength="120" required></div>
    <div class="row2">
      <div class="field"><label for="f-datum">Datum</label><input type="date" id="f-datum" required></div>
      <div class="field"><label for="f-eind">Tot en met <span class="opt">(meerdaags)</span></label><input type="date" id="f-eind"></div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-tijd">Tijd <span class="opt">(bijv. 19:30)</span></label><input type="text" id="f-tijd" maxlength="40"></div>
      <div class="field"><label for="f-cat">Soort</label><select id="f-cat">${Object.keys(CATS).map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="f-plaats">Plaats</label><input type="text" id="f-plaats" maxlength="150" required placeholder="bijv. Amelbergabasiliek, Markt 1"></div>
    <div class="field"><label for="f-org">Organisator</label><input type="text" id="f-org" maxlength="120" required placeholder="vereniging of naam"></div>
    <div class="field"><label for="f-tekst">Korte omschrijving <span class="opt">(mag in het Zösters!)</span></label><textarea id="f-tekst" maxlength="1500"></textarea></div>
    <div class="field"><label for="f-link">Website of meer info <span class="opt">(niet verplicht)</span></label><input type="url" id="f-link" maxlength="300" placeholder="https://"></div>
    <div class="field"><label for="f-contact">Jouw e-mail of telefoon <span class="opt">(niet openbaar, voor vragen)</span></label><input type="text" id="f-contact" maxlength="150" required autocomplete="email"></div>
    <div class="actions"><span class="status" id="f-st"></span><button type="button" id="f-annuleer">Annuleren</button><button type="submit" class="primary" id="f-stuur">Aanmelden</button></div>
  </form>
</dialog>
<script>
(function(){
"use strict";
const API=${JSON.stringify(API)};
const $=id=>document.getElementById(id), dlg=$('dlg');
function st(m,err){ $('f-st').textContent=m||''; $('f-st').classList.toggle('err',!!err); }
function open(){ $('form').reset(); st(''); try{ $('f-contact').value=localStorage.getItem('akt-contact')||''; $('f-org').value=localStorage.getItem('akt-org')||''; }catch{} if(dlg.showModal) dlg.showModal(); else dlg.setAttribute('open',''); $('f-titel').focus(); }
$('meld').onclick=open; const ml=$('meld-link'); if(ml) ml.onclick=e=>{ e.preventDefault(); open(); };
if(location.hash==='#aanmelden') setTimeout(open,50);
$('f-annuleer').onclick=()=>dlg.close();
$('form').addEventListener('submit',async e=>{
  e.preventDefault();
  const v=id=>$(id).value.trim();
  const d={action:'aktiviteit',titel:v('f-titel'),datum:v('f-datum'),eind:v('f-eind'),tijd:v('f-tijd'),cat:$('f-cat').value,plaats:v('f-plaats'),org:v('f-org'),tekst:v('f-tekst'),link:v('f-link'),contact:v('f-contact'),website:v('f-web')};
  const mist=[['f-titel','de naam van de activiteit'],['f-datum','de datum'],['f-plaats','de plaats'],['f-org','de organisator'],['f-contact','je e-mail of telefoon']].find(([id])=>!v(id));
  if(mist){ st('Vul '+mist[1]+' in.',true); $(mist[0]).focus(); return; }
  if(d.eind&&d.eind<d.datum){ st('De einddatum ligt voor de begindatum.',true); $('f-eind').focus(); return; }
  if(d.link&&!/^https?:\\/\\//.test(d.link)) d.link='https://'+d.link;
  $('f-stuur').disabled=true; st('Versturen…');
  try{
    const r=await fetch(API,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(d),redirect:'follow'});
    const j=await r.json(); if(!j.ok) throw j;
    try{ localStorage.setItem('akt-contact',d.contact); localStorage.setItem('akt-org',d.org); }catch{}
    st('Bedankt! Je activiteit verschijnt na controle op de site.'); setTimeout(()=>dlg.close(),1800);
  }catch(err){ st(err&&err.code==='rate_limited'?'Het is even druk. Probeer het over een paar minuten opnieuw.':'Aanmelden lukte niet. Probeer het opnieuw.',true); }
  finally{ $('f-stuur').disabled=false; }
});
})();
</script>`;

// ---------- bouwen ----------
async function main() {
  const nu = vandaag();
  const cacheFile = path.join(DIR, 'sheet-cache.json');
  let sheet = await uitSheet();
  if (sheet) schrijf(cacheFile, JSON.stringify(sheet, null, 1) + '\n'); else sheet = leesJson(cacheFile, []);
  const vast = leesJson(path.join(DIR, 'vast.json'), []);
  const archief = leesJson(path.join(DIR, 'archief.json'), []);

  const map = new Map();
  for (const a of vast.map(x => normaliseer(x, 'vast')).filter(Boolean)) map.set(a.slug, a);
  for (const a of sheet.map(x => normaliseer(x, 'sheet')).filter(Boolean)) map.set(a.slug, a); // Sheet gaat voor
  // voorbije activiteiten blijven bestaan (pagina's niet laten verdwijnen)
  for (const a of archief) if ((a.eind || a.datum) < nu && !map.has(a.slug)) map.set(a.slug, a);

  const alle = [...map.values()].sort((a, b) => a.datum.localeCompare(b.datum) || tijdVan(a.tijd).localeCompare(tijdVan(b.tijd)) || a.titel.localeCompare(b.titel));
  const komend = alle.filter(a => (a.eind || a.datum) >= nu);
  const voorbij = alle.filter(a => (a.eind || a.datum) < nu);

  // pagina's die niet meer bestaan opruimen
  const slugs = new Set(alle.map(a => a.slug));
  for (const d of fs.readdirSync(DIR, { withFileTypes: true })) {
    if (d.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(d.name) && !slugs.has(d.name)) fs.rmSync(path.join(DIR, d.name), { recursive: true });
  }
  for (const a of alle) {
    schrijf(path.join(DIR, a.slug, 'index.html'), detailPagina(a, komend, nu));
    schrijf(path.join(DIR, a.slug, 'agenda.ics'), ics(a));
  }
  schrijf(path.join(DIR, 'index.html'), overzicht(komend, alle, nu));
  schrijf(path.join(DIR, 'archief.json'), JSON.stringify(voorbij, null, 1) + '\n');

  const urls = ['/', '/vertaler/', '/aktiviteite/', '/privacy/', ...komend.map(a => `/aktiviteite/${a.slug}/`), ...voorbij.map(a => `/aktiviteite/${a.slug}/`)];
  schrijf(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  schrijf(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Klaar: ${komend.length} komende en ${voorbij.length} voorbije aktiviteite (Sheet: ${sheet.length}, vast: ${vast.length}).`);
}
main().catch(e => { console.error(e); process.exit(1); });
