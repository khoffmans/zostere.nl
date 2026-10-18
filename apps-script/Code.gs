/**
 * Zösters Vertaler — Google Apps Script (de "achterkant" van zostere.nl/vertaler)
 *
 * Doet vier dingen:
 *  1. Vertalen: stuurt de opdracht van de site naar Claude (Anthropic) met jouw API-sleutel.
 *  2. Inzendingen voor de Vastelaovesgezèt als Google Doc (met foto) in je Drive-map zetten.
 *  3. Verbetervoorstellen bijhouden in een Google Sheet.
 *  4. Goedgekeurde verbeteringen (met "ja" in de laatste kolom) teruggeven aan de site.
 *
 * De API-sleutel staat NIET in deze code, maar in Projectinstellingen → Scripteigenschappen
 * onder de naam ANTHROPIC_API_KEY.
 */

const FOLDER_ID = '1ZB2uaDGZLGEbgIpQ6ymc5jrE_pookevd'; // Drive-map "Vastelaovesgezet 2027"
const MODEL = 'claude-sonnet-5-5';
const MAIL_NAAR = ''; // optioneel: vul je e-mailadres in om bij elke inzending een mail te krijgen

// Grenzen tegen misbruik (voor de hele site samen)
const MAX_VERTALINGEN_PER_10_MIN = 40;
const MAX_VERTALINGEN_PER_DAG = 400;
const MAX_INZENDINGEN_PER_UUR = 30;

/** Eén keer uitvoeren: maakt de Sheet voor verbetervoorstellen en controleert de instellingen. */
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('Zösters vertaler – verbetervoorstellen');
    const sh = ss.getSheets()[0];
    sh.setName('Voorstellen');
    sh.appendRow(['Ingestuurd', 'Brontaal', 'Dialect', 'Brontekst', 'Voorstel in Zösters', 'Vertaling van Claude', 'Goedgekeurd (ja/nee)']);
    sh.setFrozenRows(1);
    sh.getRange('A1:G1').setFontWeight('bold');
    sh.setColumnWidths(4, 3, 320);
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(FOLDER_ID));
    p.setProperty('SHEET_ID', ss.getId());
  }
  DriveApp.getFolderById(FOLDER_ID).getName(); // vraagt toestemming voor Drive
  const key = p.getProperty('ANTHROPIC_API_KEY');
  Logger.log(key && key.indexOf('sk-ant-') === 0
    ? '✅ API-sleutel gevonden.'
    : '❌ Geen API-sleutel gevonden. Zet hem in Projectinstellingen → Scripteigenschappen als ANTHROPIC_API_KEY.');
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
  return out({ ok: true, info: 'De achterkant van de Zösters Vertaler werkt.' });
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

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const naamBestand = clean(titel) + ' – ' + clean(naam);
  const doc = DocumentApp.create(naamBestand);
  const b = doc.getBody();
  b.appendParagraph(titel).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  b.appendParagraph('Inzender: ' + naam);
  b.appendParagraph('Telefoon: ' + (tel || '-'));
  b.appendParagraph('Ingestuurd: ' + Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'd-M-yyyy HH:mm'));
  b.appendParagraph('Bron: ' + (d.bronTaal === 'li' ? 'Limburgs' + (d.dialect ? ' (' + str(d.dialect, 40) + ')' : '') : 'Nederlands'));
  b.appendHorizontalRule();
  tekst.split('\n').forEach(function (l) { b.appendParagraph(l); });
  if (foto) {
    const blob = Utilities.newBlob(Utilities.base64Decode(foto), 'image/jpeg', naamBestand + ' – foto.jpg');
    folder.createFile(blob);
    b.appendHorizontalRule();
    const img = b.appendImage(blob);
    const w = img.getWidth(), h = img.getHeight();
    if (w > 450) { img.setWidth(450); img.setHeight(Math.round(h * 450 / w)); }
  }
  const bron = str(d.bron, 20000);
  if (bron) {
    b.appendHorizontalRule();
    b.appendParagraph('Oorspronkelijke tekst').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    bron.split('\n').forEach(function (l) { b.appendParagraph(l); });
  }
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(folder);

  if (MAIL_NAAR) {
    MailApp.sendEmail(MAIL_NAAR, 'Nieuwe inzending Vastelaovesgezèt: ' + clean(titel),
      'Van: ' + naam + (tel ? ' (' + tel + ')' : '') + '\n\n' + doc.getUrl());
  }
  return { ok: true };
}

// ---- 3. Verbetervoorstel ----
function voorstel(d) {
  const nl = str(d.nl, 4000), zo = str(d.zo, 4000);
  if (!nl || !zo) return { ok: false, code: 'bad_request' };
  if (!teller('inz-' + Math.floor(Date.now() / 3600000), MAX_INZENDINGEN_PER_UUR, 4000)) return { ok: false, code: 'rate_limited' };
  const sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName('Voorstellen');
  // Een ' ervoor voorkomt dat tekst die met = begint als formule wordt gelezen
  const safe = function (s) { s = String(s || ''); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  sh.appendRow([new Date(), d.bron === 'li' ? 'Limburgs' : 'Nederlands', safe(str(d.dialect, 40)), safe(nl), safe(zo), safe(str(d.concept, 4000)), '']);
  return { ok: true };
}

// ---- 4. Goedgekeurde verbeteringen ----
function verbeteringen() {
  const c = CacheService.getScriptCache();
  const hit = c.get('verbeteringen');
  if (hit) return { ok: true, items: JSON.parse(hit) };
  const sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName('Voorstellen');
  const items = sh.getDataRange().getValues().slice(1)
    .filter(function (r) { return String(r[6]).trim().toLowerCase() === 'ja' && r[3] && r[4]; })
    .map(function (r) {
      return { t: r[0] instanceof Date ? r[0].getTime() : 0, bron: r[1] === 'Limburgs' ? 'li' : 'nl', dialect: String(r[2] || ''), nl: String(r[3]), zo: String(r[4]) };
    })
    .sort(function (a, b) { return b.t - a.t; })
    .slice(0, 150);
  try { c.put('verbeteringen', JSON.stringify(items), 300); } catch (e) { /* te groot voor de cache: dan elke keer opnieuw */ }
  return { ok: true, items: items };
}
