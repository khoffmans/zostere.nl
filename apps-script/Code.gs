/**
 * Sjrief Zösters — Google Apps Script (de "achterkant" van zostere.nl/vertaler)
 *
 * Doet vier dingen:
 *  1. Vertalen: stuurt de opdracht van de site naar Claude (Anthropic) met jouw API-sleutel.
 *  2. Inzendingen voor de Vastelaovesgezèt als Google Doc (plus foto) in een eigen Drive-map zetten.
 *  3. Verbetervoorstellen bijhouden in een Google Sheet.
 *  4. Goedgekeurde verbeteringen (met "ja" in de laatste kolom) teruggeven aan de site.
 *
 * Het script vraagt bewust zo min mogelijk rechten: alleen toegang tot bestanden die het zelf
 * maakt (drive.file) en verbinding met andere diensten (voor Claude). Zie appsscript.json.
 *
 * De API-sleutel staat NIET in deze code, maar in Projectinstellingen → Scripteigenschappen
 * onder de naam ANTHROPIC_API_KEY.
 */

const MODEL = 'claude-sonnet-5-5';
const MAP_NAAM = 'Sjrief Zösters – inzendingen';
const SHEET_NAAM = 'Sjrief Zösters – verbetervoorstellen';

// Grenzen tegen misbruik (voor de hele site samen)
const MAX_VERTALINGEN_PER_10_MIN = 40;
const MAX_VERTALINGEN_PER_DAG = 400;
const MAX_INZENDINGEN_PER_UUR = 30;

/** Eén keer uitvoeren: maakt de map en de Sheet aan en controleert de API-sleutel. */
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('FOLDER_ID')) {
    const f = driveJson('post', 'https://www.googleapis.com/drive/v3/files?fields=id', { name: MAP_NAAM, mimeType: 'application/vnd.google-apps.folder' });
    p.setProperty('FOLDER_ID', f.id);
  }
  if (!p.getProperty('SHEET_ID')) {
    const kop = 'Ingestuurd,Brontaal,Dialect,Brontekst,Voorstel in Zösters,Vertaling van Claude,Goedgekeurd (ja/nee)\n';
    const s = driveUpload({ name: SHEET_NAAM, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [p.getProperty('FOLDER_ID')] },
      Utilities.newBlob(kop, 'text/csv').getBytes(), 'text/csv');
    p.setProperty('SHEET_ID', s.id);
  }
  const key = p.getProperty('ANTHROPIC_API_KEY');
  Logger.log(key && key.indexOf('sk-ant-') === 0
    ? '✅ API-sleutel gevonden.'
    : '❌ Geen API-sleutel gevonden. Zet hem in Projectinstellingen → Scripteigenschappen als ANTHROPIC_API_KEY.');
  Logger.log('✅ Map voor inzendingen: https://drive.google.com/drive/folders/' + p.getProperty('FOLDER_ID'));
  Logger.log('✅ Sheet met voorstellen: https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID'));
}

/** Optioneel: test of Claude antwoordt. Kies deze functie en klik op Uitvoeren. */
function testClaude() {
  const r = vraagClaude('TAALGIDS ZÖSTERS test. Antwoord alleen met het woord: hoi\n<<<\nhallo\n>>>');
  Logger.log(r.ok ? '✅ Claude antwoordt: ' + r.text : '❌ ' + JSON.stringify(r));
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'vertaal') return out(vertaal(d));
    if (d.action === 'inzending') return out(inzending(d));
    if (d.action === 'voorstel') return out(voorstel(d));
    if (d.action === 'verbeteringen') return out(verbeteringen());
    return out({ ok: false, code: 'bad_request' });
  } catch (err) {
    console.error(err);
    return out({ ok: false, code: 'upstream' });
  }
}

function doGet() {
  return out({ ok: true, info: 'De achterkant van Sjrief Zösters werkt.' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function clean(s, max) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[\/\\]/g, '-').trim().slice(0, max || 100);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Telt hoe vaak iets gebeurde binnen een tijdvak; geeft false als de grens bereikt is. */
function teller(sleutel, max, seconden) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get(sleutel) || 0);
    if (n >= max) return false;
    c.put(sleutel, String(n + 1), seconden);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ---- Google Drive en Sheets via hun REST-API (werkt met alleen het recht drive.file) ----
function google(method, url, body, contentType) {
  const opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body !== undefined) { opt.payload = body; opt.contentType = contentType || 'application/json'; }
  const r = UrlFetchApp.fetch(url, opt);
  const code = r.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Google ' + code + ': ' + r.getContentText().slice(0, 300));
  const t = r.getContentText();
  return t ? JSON.parse(t) : {};
}

function driveJson(method, url, obj) {
  return google(method, url, JSON.stringify(obj));
}

function driveUpload(meta, bytes, mime) {
  const b = 'sjrief' + Date.now();
  const head = Utilities.newBlob('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + b + '--').getBytes();
  return google('post', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    head.concat(bytes).concat(tail), 'multipart/related; boundary=' + b);
}

// ---- 1. Vertalen ----
function vertaal(d) {
  const prompt = typeof d.prompt === 'string' ? d.prompt : '';
  if (!prompt || prompt.indexOf('TAALGIDS ZÖSTERS') < 0) return { ok: false, code: 'bad_request' };
  if (prompt.length > 150000) return { ok: false, code: 'too_long' };
  const m = prompt.match(/<<<\n([\s\S]*?)\n>>>/);
  if (!m || m[1].length > 8000) return { ok: false, code: 'too_long' };

  const blok = Math.floor(Date.now() / 600000);
  const dag = Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyyMMdd');
  if (!teller('v10-' + blok, MAX_VERTALINGEN_PER_10_MIN, 900)) return { ok: false, code: 'rate_limited' };
  if (!teller('vdag-' + dag, MAX_VERTALINGEN_PER_DAG, 21600 * 4)) return { ok: false, code: 'daily_limit' };

  return vraagClaude(prompt);
}

function vraagClaude(prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, code: 'not_configured' };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  if (status !== 200) {
    console.error('Anthropic ' + status + ': ' + res.getContentText().slice(0, 500));
    return { ok: false, code: status === 429 || status === 529 ? 'busy' : 'upstream', status: status };
  }
  const j = JSON.parse(res.getContentText());
  const text = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return { ok: true, text: text, truncated: j.stop_reason === 'max_tokens' };
}

// ---- 2. Inzending voor de Vastelaovesgezèt ----
function inzending(d) {
  if (d.website) return { ok: true }; // honeypot: bots vullen dit verborgen veld in
  const titel = str(d.titel, 120), naam = str(d.naam, 100), tel = str(d.tel, 30), tekst = str(d.tekst, 20000);
  if (!titel || !naam || !tekst) return { ok: false, code: 'bad_request' };
  if (!teller('inz-' + Math.floor(Date.now() / 3600000), MAX_INZENDINGEN_PER_UUR, 4000)) return { ok: false, code: 'rate_limited' };
  const foto = typeof d.foto === 'string' && d.foto && d.foto.length < 400000 && /^[A-Za-z0-9+\/=]+$/.test(d.foto) ? d.foto : null;

  const folder = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  const naamBestand = clean(titel) + ' – ' + clean(naam);
  const bron = str(d.bron, 20000);
  const tijd = Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'd-M-yyyy HH:mm');
  const brontaal = d.bronTaal === 'li' ? 'Limburgs' + (d.dialect ? ' (' + str(d.dialect, 40) + ')' : '') : 'Nederlands';

  let fotoLink = '';
  if (foto) {
    const f = driveUpload({ name: naamBestand + ' – foto.jpg', parents: [folder] }, Utilities.base64Decode(foto), 'image/jpeg');
    fotoLink = f.webViewLink || '';
  }
  const alinea = function (t) { return t.split('\n').map(function (l) { return '<p>' + (esc(l) || '&nbsp;') + '</p>'; }).join(''); };
  let html = '<html><head><meta charset="utf-8"></head><body>' +
    '<h1>' + esc(titel) + '</h1>' +
    '<p>Inzender: ' + esc(naam) + '</p><p>Telefoon: ' + esc(tel || '-') + '</p>' +
    '<p>Ingestuurd: ' + esc(tijd) + '</p><p>Bron: ' + esc(brontaal) + '</p>' +
    (fotoLink ? '<p>Foto: <a href="' + esc(fotoLink) + '">' + esc(naamBestand) + ' – foto.jpg</a></p>' : '') +
    '<hr>' + alinea(tekst);
  if (foto) html += '<hr><p><img src="data:image/jpeg;base64,' + foto + '" width="450"></p>';
  if (bron) html += '<hr><h3>Oorspronkelijke tekst</h3>' + alinea(bron);
  html += '</body></html>';
  driveUpload({ name: naamBestand, mimeType: 'application/vnd.google-apps.document', parents: [folder] },
    Utilities.newBlob(html, 'text/html').getBytes(), 'text/html');
  return { ok: true };
}

// ---- 3. Verbetervoorstel ----
function voorstel(d) {
  const nl = str(d.nl, 4000), zo = str(d.zo, 4000);
  if (!nl || !zo) return { ok: false, code: 'bad_request' };
  if (!teller('inz-' + Math.floor(Date.now() / 3600000), MAX_INZENDINGEN_PER_UUR, 4000)) return { ok: false, code: 'rate_limited' };
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const rij = [Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm'), d.bron === 'li' ? 'Limburgs' : 'Nederlands', str(d.dialect, 40), nl, zo, str(d.concept, 4000), ''];
  // RAW: tekst wordt nooit als formule gelezen
  google('post', 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/A1:G1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    JSON.stringify({ values: [rij] }));
  return { ok: true };
}

// ---- 4. Goedgekeurde verbeteringen ----
function verbeteringen() {
  const c = CacheService.getScriptCache();
  const hit = c.get('verbeteringen');
  if (hit) return { ok: true, items: JSON.parse(hit) };
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const r = google('get', 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/A2:G5000');
  const items = (r.values || [])
    .filter(function (x) { return String(x[6] || '').trim().toLowerCase() === 'ja' && x[3] && x[4]; })
    .map(function (x) { return { t: String(x[0] || ''), bron: x[1] === 'Limburgs' ? 'li' : 'nl', dialect: String(x[2] || ''), nl: String(x[3]), zo: String(x[4]) }; })
    .reverse()
    .slice(0, 150);
  try { c.put('verbeteringen', JSON.stringify(items), 300); } catch (e) { /* te groot voor de cache: dan elke keer opnieuw */ }
  return { ok: true, items: items };
}
