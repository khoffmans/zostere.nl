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
  'Vastelaovend':      { cls: 'vastelaovend' },
  'Kirmes & fieëste':  { cls: 'kirmes' },
  'Meziek & cultuur':  { cls: 'meziek' },
  'Natuur & wanjele':  { cls: 'natuur' },
  'Kirk':              { cls: 'kirk' },
  'Sport':             { cls: 'sport' },
  'Kènjer':            { cls: 'kenjer' },
  'Markt':             { cls: 'markt' },
  'Anger':             { cls: 'anger' },
};
const MAAND = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const DAG = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
const DAG_ZO = ['zóndig','maondig','daensdig','goonsdig','dónderdig','vriedig','zaoterdig'];

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

// ---------- gedeelde opmaak (Hallmark · Broadside, zie css/zostere.css) ----------
const cls = cat => `k-${(CATS[cat] || CATS.Anger).cls}`;
// Een titel als regels houtletter: elke regel past zich aan de kolombreedte aan (js/fit.js).
function fitRegels(t, px = 220) {
  // tot 22 tekens één regel; langer in twee of drie regels van gelijke lengte, elke regel gepast op de kolom
  const woorden = String(t).split(/\s+/), n = String(t).length;
  const aantal = n <= 22 ? 1 : n <= 44 ? 2 : 3, doel = n / aantal, regels = [''];
  for (const w of woorden) {
    const l = regels[regels.length - 1];
    if (l && regels.length < aantal && (l.length + w.length / 2) > doel) regels.push(w);
    else regels[regels.length - 1] = l ? l + ' ' + w : w;
  }
  return regels.map(r => `<span class="fit" style="--n:${Math.max(8, r.length)};--max:${px}px" data-max="${px}">${esc(r)}</span>`).join('');
}

const TAALBALK = '<div class="taalbalk"><div class="container"><div class="taal" role="group" aria-label="Taal"><span class="taal__label" data-zo="Taol">Taal</span><button type="button" class="vlag" data-taal="nl" aria-pressed="true" aria-label="Nederlands" title="Nederlands"><svg viewBox="0 0 27 18" aria-hidden="true"><rect class="f-red" width="27" height="6"/><rect class="f-white" y="6" width="27" height="6"/><rect class="f-blue" y="12" width="27" height="6"/></svg></button><button type="button" class="vlag" data-taal="zo" aria-pressed="false" aria-label="Zösters" title="Zösters"><svg viewBox="0 0 27 18" aria-hidden="true"><rect class="f-white" width="27" height="8.5"/><rect class="f-blue" y="8.5" width="27" height="2"/><rect class="f-yellow" y="10.5" width="27" height="7.5"/><path class="f-red" d="M3 1.4 5.6.9l1 1.5 1.5-.5-.5 2 1 1.5-1.5 1 .5 1.4-2-.4-1 .5-.5-1.5-1.5-.5 1-1.5-1-1.5z"/></svg></button></div></div></div>';

function kop({ titel, beschrijving, url, extra = '', huidig = 'aktiviteite', pre = '../' }) {
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
<link rel="icon" href="${pre}favicon.svg" type="image/svg+xml">
<link rel="preload" href="${pre}fonts/six-caps-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${pre}fonts/bevan-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${pre}css/zostere.css">
${extra}
</head>
<body class="akt">
<a class="skip" href="#main">Naar de inhoud</a>
${TAALBALK}
<header class="mast">
  <div class="container">
    <a class="wordmark" href="/" aria-label="Zöstere.nl, naar de beginpagina">Zöstere.nl</a>
    <nav aria-label="Zöstere.nl"><ul><li><a href="/vertaler/">Sjrief Zösters</a></li><li><a href="/aktiviteite/"${huidig === 'aktiviteite' ? ' aria-current="page"' : ''}>Aktiviteite</a></li></ul></nav>
  </div>
</header>`;
}
const voet = (pre = '../') => `
<footer class="colophon">
  <div class="container">
    <div>
      <span class="wordmark">Zöstere.nl</span>
      <p data-zo-html="Mis d’r get, of klopt get neet? Meld ein aktiviteit aan mit ’t formuleer, of mail nao &lt;a href=&quot;mailto:info@zostere.nl&quot;&gt;info@zostere.nl&lt;/a&gt;.">Ontbreekt er iets of klopt er iets niet? Meld een activiteit aan via het formulier, of mail naar <a href="mailto:info@zostere.nl">info@zostere.nl</a>.</p>
    </div>
    <ul>
      <li><a href="/aktiviteite/">Aktiviteite</a></li>
      <li><a href="/aktiviteite/#aanmelden" data-zo="Aktiviteit aanmelje">Aktiviteit aanmelden</a></li>
      <li><a href="/vertaler/">Sjrief Zösters</a></li>
      <li><a href="/privacy/">Privacy</a></li>
    </ul>
  </div>
</footer>
<script src="${pre}js/fit.js" defer></script>
<script src="${pre}js/taal.js" defer></script>`;

// ---------- onderdelen ----------
function evRegel(a, kop = 'h3') {
  const d = pd(a.datum), t = tijdVan(a.tijd);
  const wann = a.eind && a.eind !== a.datum ? `${pd(a.datum).getUTCDate()} ${MAAND[d.getUTCMonth()]} t/m ${datumKort(a.eind).slice(3)}` : '';
  return `<li><a class="ev" href="/aktiviteite/${a.slug}/" data-cat="${esc(a.cat)}">
      <span class="ev__datum" aria-hidden="true"><span class="ev__d">${d.getUTCDate()}</span><span class="ev__m" data-zo="${DAG_ZO[d.getUTCDay()]}">${DAG[d.getUTCDay()]}</span></span>
      <span class="ev__body"><${kop} class="ev__t">${esc(a.titel)}</${kop}>
        <span class="ev__meta"><span class="visually-hidden">${esc(wanneer(a))}</span>${wann ? `<span>${esc(wann)}</span>` : ''}${t ? `<span>${esc(t)}</span>` : ''}${a.plaats ? `<span>${esc(a.plaats)}</span>` : ''}</span>${a.org && a.org !== a.plaats ? `<span class="ev__org">${esc(a.org)}</span>` : ''}</span>
      <span class="ev__soort"><i class="k ${cls(a.cat)}" aria-hidden="true"></i>${esc(a.cat)}</span>
    </a></li>`;
}

// het lijstje "Volgende in Zöstere" op de beginpagina
function volgendeBlok(komend) {
  const rij = a => {
    const d = pd(a.datum), t = tijdVan(a.tijd);
    return `<li><a href="/aktiviteite/${a.slug}/"><span class="wanneer"><span class="visually-hidden">${esc(wanneer(a))} </span><span aria-hidden="true">${d.getUTCDate()} ${MAAND[d.getUTCMonth()].slice(0,3)}</span></span><span><span class="wat">${esc(a.titel)}</span><span class="waar"><i class="k ${cls(a.cat)}" aria-hidden="true"></i>${esc([t, a.plaats].filter(Boolean).join(', ') || a.cat)}</span></span></a></li>`;
  };
  const [eerste, ...rest] = komend.slice(0, 3);
  let html = '';
  if (eerste) {
    const d = pd(eerste.datum), t = tijdVan(eerste.tijd);
    const datum = `${DAG[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`;
    const datumZo = `${DAG_ZO[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`;
    html = `<a class="eerste" href="/aktiviteite/${eerste.slug}/"><span class="fitbox"><span class="fit fit--accent" style="--n:${datum.length};--max:120px" data-max="120" data-zo="${esc(datumZo)}">${esc(datum)}</span></span><span class="wat">${esc(eerste.titel)}</span><span class="waar"><i class="k ${cls(eerste.cat)}" aria-hidden="true"></i>${esc([t, eerste.plaats].filter(Boolean).join(', ') || eerste.cat)}</span></a>
        ${rest.length ? `<ol class="volgende">\n          ${rest.map(rij).join('\n          ')}\n        </ol>` : ''}`;
  }
  return `<!-- volgende:begin -->
        ${html || '<p class="lead">Er staat nog niets in de agenda. Weet jij iets? Meld het aan.</p>'}
        <a class="alle" href="/aktiviteite/">Alle ${komend.length} aktiviteite in de agenda</a>
<!-- volgende:end -->`;
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
  const titel = `${a.titel}, ${datumKort(a.datum)} ${pd(a.datum).getUTCFullYear()} in Zöstere | Zöstere.nl`;
  const beschr = kortTekst(`${a.titel} op ${wanneer(a)}${tijdVan(a.tijd) ? ' om ' + tijdVan(a.tijd) : ''}${a.plaats ? ', ' + a.plaats : ''} in Susteren (Zöstere). ${a.tekst}`);
  const na = komend.filter(x => x.slug !== a.slug && x.datum >= a.datum);
  const meer = (na.length >= 3 ? na : komend.filter(x => x.slug !== a.slug)).slice(0, 5);
  const deelTekst = encodeURIComponent(`${a.titel}, ${wanneer(a)}${tijdVan(a.tijd) ? ' ' + tijdVan(a.tijd) : ''} ${url}`);
  const d = pd(a.datum);
  const datumRegel = a.eind && a.eind !== a.datum ? `${d.getUTCDate()} ${MAAND[d.getUTCMonth()]} t/m ${datumKort(a.eind).slice(3)}` : `${DAG[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`;
  const datumRegelZo = a.eind && a.eind !== a.datum ? datumRegel.replace(' t/m ', ' tót ') : `${DAG_ZO[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`;
  return kop({ titel, beschrijving: beschr, url, extra: jsonLdEvent(a, voorbij), pre: '../../' }) + `
<main id="main">
  <section class="evhero">
    <div class="container">
      <div class="evhero__kop">
        <nav class="crumb" aria-label="Kruimelpad"><ol><li><a href="/">Zöstere.nl</a></li><li><a href="/aktiviteite/">Aktiviteite</a></li><li aria-current="page">${esc(a.titel)}</li></ol></nav>
        <h1 class="fitbox">${fitRegels(a.titel)}</h1>
        <p class="fitbox evhero__datum" aria-hidden="true"><span class="fit fit--accent" style="--n:${datumRegel.length};--max:84px" data-max="84" data-zo="${esc(datumRegelZo)}">${esc(datumRegel)}</span></p>
        ${voorbij ? '<p class="voorbij" data-zo="Dees aktiviteit is gedaon.">Deze activiteit is voorbij.</p>' : ''}
        ${a.tekst ? `<p class="lead evhero__tekst">${esc(a.tekst)}</p>` : ''}
        <div class="actions">
          ${voorbij ? '' : `<a class="btn" href="/aktiviteite/${a.slug}/agenda.ics" download data-zo="Zèt in mien agenda">Zet in mijn agenda</a>`}
          <a class="btn btn--frame" href="https://wa.me/?text=${deelTekst}" target="_blank" rel="noopener">Deel via WhatsApp</a>
          ${a.link ? `<a class="evhero__link" href="${esc(a.link)}" target="_blank" rel="noopener" data-zo="Mieë info bie de organisasie">Meer info bij de organisatie</a>` : ''}
        </div>
      </div>
      <dl class="particulars evhero__feiten">
        <div><dt data-zo="Wienieë">Wanneer</dt><dd>${esc(wanneer(a))}</dd></div>
        ${a.tijd ? `<div><dt data-zo="Wie laat">Hoe laat</dt><dd>${esc(a.tijd)}${a.deuren ? `<span class="small" data-zo="deure aope ${esc(a.deuren)}">deuren open ${esc(a.deuren)}</span>` : ''}</dd></div>` : ''}
        ${a.plaats ? `<div><dt data-zo="Wo">Waar</dt><dd>${esc(a.plaats)}, Susteren</dd></div>` : ''}
        ${a.org ? `<div><dt data-zo="Organisasie">Organisatie</dt><dd>${esc(a.org)}</dd></div>` : ''}
        ${a.prijs ? `<div><dt data-zo="Entree">Toegang</dt><dd>${esc(a.prijs)}</dd></div>` : ''}
        <div><dt>Soort</dt><dd class="soort"><i class="k ${cls(a.cat)}" aria-hidden="true"></i>${esc(a.cat)}</dd></div>
      </dl>
    </div>
  </section>
  ${meer.length ? `<section class="meer" aria-labelledby="meer-kop">
    <div class="container">
      <h2 id="meer-kop" data-zo="Mieë aktiviteite in Zöstere">Meer aktiviteite in Zöstere</h2>
      <ol class="evlijst">${meer.map(x => evRegel(x)).join('\n')}</ol>
      <p><a class="alle" href="/aktiviteite/">Alle aktiviteite</a></p>
    </div>
  </section>` : ''}
</main>` + voet('../../') + '\n</body>\n</html>\n';
}

function overzicht(komend, alle, nu) {
  const titel = 'Aktiviteite in Zöstere: de agenda van Susteren | Zöstere.nl';
  const beschr = 'Wat is er te doen in Susteren (Zöstere)? Vastelaovend, kirmes, muziek, sport, kerk en meer, in een overzichtelijke maandkalender.';
  const url = `${SITE}/aktiviteite/`;
  const data = alle.map(a => ({ s: a.slug, d: a.datum, e: a.eind, t: a.titel, c: a.cat, u: tijdVan(a.tijd) }));
  const itemList = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: komend.slice(0, 50).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/aktiviteite/${a.slug}/`, name: a.titel })) };
  let lijst = '', huidig = '';
  for (const a of komend) {
    const d = pd(a.datum), key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key !== huidig) { if (huidig) lijst += '</ol></section>'; huidig = key; lijst += `<section class="month" data-maand="${key}"><h2>${MAAND[d.getUTCMonth()]} ${d.getUTCFullYear()}</h2><ol class="evlijst">`; }
    lijst += evRegel(a);
  }
  if (huidig) lijst += '</ol></section>';
  const legend = Object.keys(CATS).map(n => `<button type="button" class="chip" data-cat="${esc(n)}" aria-pressed="false"><i class="k ${cls(n)}" aria-hidden="true"></i>${esc(n)}</button>`).join('');
  return kop({ titel, beschrijving: beschr, url, extra: `<script type="application/ld+json">${JSON.stringify(itemList).replace(/</g,'\\u003c')}</script>` }) + `
<main id="main">
  <section class="akthero">
    <div class="container">
      <h1 class="fitbox"><span class="fit" style="--n:11">Aktiviteite</span></h1>
      <div class="akthero__tekst">
        <p class="lead">Wat is d’r te doon in Zöstere? Vastelaovend, kirmes, meziek en sport. <span data-zo="Organiseers doe zelf get?">Organiseer je zelf iets?</span> <a href="#aanmelden" id="meld-link" data-zo="Meld ’t aan">Meld het aan</a>.</p>
        <div class="actions"><button class="btn" id="meld" type="button" data-zo="Aktiviteit aanmelje">Aktiviteit aanmelden</button></div>
      </div>
    </div>
  </section>

  <section class="kalender" aria-label="Maandkalender">
    <div class="container">
      <div class="chips" id="chips" role="group" aria-label="Filter op soort"><button type="button" class="chip" data-cat="" aria-pressed="true">Alles</button>${legend}</div>
      <div class="cal">
        <div class="cal-head"><button class="btn btn--frame cal-nav" type="button" id="vorige" aria-label="Vorige maand" data-zo="Trök">Vorige</button><h2 id="maandnaam" aria-live="polite">${MAAND[+nu.slice(5,7)-1]} ${nu.slice(0,4)}</h2><button class="btn btn--frame cal-nav" type="button" id="volgende" aria-label="Volgende maand" data-zo="Wiejer">Volgende</button></div>
        <div class="grid" id="grid"></div>
        <div class="daglijst" id="daglijst" hidden></div>
      </div>
    </div>
  </section>

  <section class="lijst" aria-label="Komende aktiviteite">
    <div class="container" id="lijst">
      ${lijst || '<p class="lead">Er staan nog geen aktiviteite in de agenda. Weet jij er een? Meld hem aan.</p>'}
    </div>
  </section>
</main>
` + voet() + AANMELDEN + `
<script>
(function(){
"use strict";
const DATA=${JSON.stringify(data).replace(/</g,'\\u003c')};
const CLS=${JSON.stringify(Object.fromEntries(Object.entries(CATS).map(([n, c]) => [n, 'k-' + c.cls])))};
const MAAND=${JSON.stringify(MAAND)};
const $=id=>document.getElementById(id);
const nu=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
let filter='', jaar=+nu.slice(0,4), maand=+nu.slice(5,7)-1, gekozen='';
const pad=n=>String(n).padStart(2,'0');
const kcls=c=>CLS[c]||'k-anger';
function opDag(s){ return DATA.filter(a=>(!filter||a.c===filter)&&a.d<=s&&(a.e||a.d)>=s); }
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function mark(c){ const i=el('i','k '+kcls(c)); i.setAttribute('aria-hidden','true'); return i; }
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
    evs.forEach(a=>{ const p=el('a','pill'); p.href='/aktiviteite/'+a.s+'/'; p.title=a.t; p.append(mark(a.c), document.createTextNode((a.u&&a.d===s?a.u+' ':'')+a.t)); p.onclick=e=>e.stopPropagation(); c.append(p); dots.append(mark(a.c)); });
    c.append(dots); g.append(c);
  }
  const rest=(7-(start+dagen)%7)%7; for(let i=0;i<rest;i++) g.append(el('div','day leeg'));
  const dl=$('daglijst'); dl.textContent='';
  if(gekozen&&gekozen.slice(0,7)===jaar+'-'+pad(maand+1)){
    const dd=new Date(gekozen+'T12:00:00'); const kop=dd.toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'}); dl.append(el('h3',null,kop.charAt(0).toUpperCase()+kop.slice(1)));
    opDag(gekozen).forEach(a=>{ const l=el('a','pill pill--lang'); l.href='/aktiviteite/'+a.s+'/'; l.append(mark(a.c), document.createTextNode((a.u?a.u+', ':'')+a.t)); dl.append(l); });
    dl.hidden=false;
  } else dl.hidden=true;
}
$('vorige').onclick=()=>{ maand--; if(maand<0){maand=11;jaar--;} gekozen=''; teken(); };
$('volgende').onclick=()=>{ maand++; if(maand>11){maand=0;jaar++;} gekozen=''; teken(); };
document.querySelectorAll('#chips .chip').forEach(b=>b.onclick=()=>{
  filter=b.dataset.cat; document.querySelectorAll('#chips .chip').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  document.querySelectorAll('#lijst .ev').forEach(e=>{ e.parentElement.hidden=!!filter&&e.dataset.cat!==filter; });
  document.querySelectorAll('#lijst .month').forEach(m=>{ m.hidden=![...m.querySelectorAll('li')].some(e=>!e.hidden); });
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
    <h2 id="dlg-h" data-zo="Aktiviteit aanmelje">Aktiviteit aanmelden</h2>
    <p class="small" data-zo="Nao ein korte controle kump dien aktiviteit op de site.">Na een korte controle verschijnt je activiteit op de site.</p>
    <div class="hp" aria-hidden="true"><label for="f-web">Laat dit veld leeg</label><input type="text" id="f-web" tabindex="-1" autocomplete="off"></div>
    <div class="field"><label for="f-titel" data-zo="Naam van de aktiviteit">Naam van de activiteit</label><input class="input" type="text" id="f-titel" maxlength="120" required></div>
    <div class="row2">
      <div class="field"><label for="f-datum">Datum</label><input class="input" type="date" id="f-datum" required></div>
      <div class="field"><label for="f-eind" data-zo-html="Tót en mit &lt;span class=&quot;opt&quot;&gt;(mieëdaags)&lt;/span&gt;">Tot en met <span class="opt">(meerdaags)</span></label><input class="input" type="date" id="f-eind"></div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-tijd" data-zo-html="Tied &lt;span class=&quot;opt&quot;&gt;(bv. 19:30)&lt;/span&gt;">Tijd <span class="opt">(bijv. 19:30)</span></label><input class="input" type="text" id="f-tijd" maxlength="40"></div>
      <div class="field"><label for="f-cat">Soort</label><select class="input" id="f-cat">${Object.keys(CATS).map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="f-plaats">Plaats</label><input class="input" type="text" id="f-plaats" maxlength="150" required placeholder="bijv. Amelbergabasiliek, Markt 1"></div>
    <div class="field"><label for="f-org">Organisator</label><input class="input" type="text" id="f-org" maxlength="120" required placeholder="vereniging of naam"></div>
    <div class="field"><label for="f-tekst" data-zo-html="Korte omsjrieving &lt;span class=&quot;opt&quot;&gt;(mag in ’t Zösters)&lt;/span&gt;">Korte omschrijving <span class="opt">(mag in het Zösters)</span></label><textarea class="input" id="f-tekst" maxlength="1500"></textarea></div>
    <div class="field"><label for="f-link" data-zo-html="Website of mieë info &lt;span class=&quot;opt&quot;&gt;(neet verplich)&lt;/span&gt;">Website of meer info <span class="opt">(niet verplicht)</span></label><input class="input" type="url" id="f-link" maxlength="300" placeholder="https://"></div>
    <div class="field"><label for="f-contact" data-zo-html="Dien e-mail of telefoon &lt;span class=&quot;opt&quot;&gt;(kump neet op de site, veur vraoge)&lt;/span&gt;">Jouw e-mail of telefoon <span class="opt">(niet openbaar, voor vragen)</span></label><input class="input" type="text" id="f-contact" maxlength="150" required autocomplete="email"></div>
    <p class="status" id="f-st" aria-live="polite"></p>
    <div class="dlg__knoppen"><button class="btn btn--frame" type="button" id="f-annuleer" data-zo="Aafzègke">Annuleren</button><button class="btn" type="submit" id="f-stuur" data-zo="Aanmelje">Aanmelden</button></div>
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
  if(mist){ st('Vul '+mist[1]+' in.',true); $(mist[0]).setAttribute('aria-invalid','true'); $(mist[0]).focus(); return; }
  if(d.eind&&d.eind<d.datum){ st('De einddatum ligt voor de begindatum.',true); $('f-eind').focus(); return; }
  if(d.link&&!/^https?:\\/\\//.test(d.link)) d.link='https://'+d.link;
  $('f-stuur').disabled=true; $('f-stuur').setAttribute('aria-busy','true'); st('Versturen…');
  try{
    const r=await fetch(API,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(d),redirect:'follow'});
    const j=await r.json(); if(!j.ok) throw j;
    try{ localStorage.setItem('akt-contact',d.contact); localStorage.setItem('akt-org',d.org); }catch{}
    st('Bedankt. Je activiteit verschijnt na controle op de site.'); setTimeout(()=>dlg.close(),1800);
  }catch(err){ st(err&&err.code==='rate_limited'?'Het is even druk. Probeer het over een paar minuten opnieuw.':'Aanmelden lukte niet. Probeer het opnieuw.',true); }
  finally{ $('f-stuur').disabled=false; $('f-stuur').removeAttribute('aria-busy'); }
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

  // beginpagina: het lijstje "Volgende in Zöstere" tussen de markeringen bijwerken
  const home = path.join(ROOT, 'index.html');
  const h = fs.readFileSync(home, 'utf8');
  const h2 = h.replace(/<!-- volgende:begin -->[\s\S]*?<!-- volgende:end -->/, volgendeBlok(komend));
  if (h2 !== h) schrijf(home, h2);

  const urls = ['/', '/vertaler/', '/aktiviteite/', '/privacy/', ...komend.map(a => `/aktiviteite/${a.slug}/`), ...voorbij.map(a => `/aktiviteite/${a.slug}/`)];
  schrijf(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  schrijf(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Klaar: ${komend.length} komende en ${voorbij.length} voorbije aktiviteite (Sheet: ${sheet.length}, vast: ${vast.length}).`);
}
main().catch(e => { console.error(e); process.exit(1); });
