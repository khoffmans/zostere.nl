/**
 * Zösters Vertaler — Google Apps Script
 *
 * - Zet inzendingen voor de Vastelaovesgezèt als Google Doc (met foto) in je Drive-map.
 * - Houdt verbetervoorstellen bij in een Google Sheet; alleen regels met "ja" in de
 *   kolom "Goedgekeurd" worden door de vertaler als voorbeeld gebruikt.
 *
 * Eerste keer: kies bovenin de functie "setup" en klik op Uitvoeren. Geef toestemming.
 * Het geheim staat daarna in het uitvoeringslogboek; dat zet je in de Cloudflare Worker.
 */

const FOLDER_ID = '1ZB2uaDGZLGEbgIpQ6ymc5jrE_pookevd'; // "Vastelaovesgezet 2027"
const MAIL_NAAR = ''; // optioneel: vul je e-mailadres in om bij elke inzending een mail te krijgen

function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SECRET')) {
    p.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
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
  Logger.log('Geheim voor de Cloudflare Worker (APPS_SCRIPT_SECRET): ' + p.getProperty('SECRET'));
  Logger.log('Sheet met voorstellen: https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID'));
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const p = PropertiesService.getScriptProperties();
    if (!d.secret || d.secret !== p.getProperty('SECRET')) return out({ ok: false, error: 'forbidden' });
    if (d.action === 'inzending') return out(inzending(d));
    if (d.action === 'voorstel') return out(voorstel(d, p));
    if (d.action === 'verbeteringen') return out(verbeteringen(p));
    return out({ ok: false, error: 'onbekende actie' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out({ ok: true, info: 'Zösters Vertaler Apps Script werkt.' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function clean(s, max) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[\/\\]/g, '-').trim().slice(0, max || 100);
}

function inzending(d) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const naam = clean(d.titel) + ' – ' + clean(d.naam);
  const doc = DocumentApp.create(naam);
  const b = doc.getBody();
  b.appendParagraph(String(d.titel)).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  b.appendParagraph('Inzender: ' + d.naam);
  b.appendParagraph('Telefoon: ' + (d.tel || '-'));
  b.appendParagraph('Ingestuurd: ' + Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'd-M-yyyy HH:mm'));
  b.appendParagraph('Bron: ' + (d.bronTaal === 'li' ? 'Limburgs' + (d.dialect ? ' (' + d.dialect + ')' : '') : 'Nederlands'));
  b.appendHorizontalRule();
  String(d.tekst).split('\n').forEach(function (l) { b.appendParagraph(l); });

  if (d.foto) {
    const blob = Utilities.newBlob(Utilities.base64Decode(d.foto), 'image/jpeg', naam + ' – foto.jpg');
    folder.createFile(blob);
    b.appendHorizontalRule();
    const img = b.appendImage(blob);
    const w = img.getWidth(), h = img.getHeight();
    if (w > 450) { img.setWidth(450); img.setHeight(Math.round(h * 450 / w)); }
  }
  if (d.bron) {
    b.appendHorizontalRule();
    b.appendParagraph('Oorspronkelijke tekst').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    String(d.bron).split('\n').forEach(function (l) { b.appendParagraph(l); });
  }
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(folder);

  if (MAIL_NAAR) {
    MailApp.sendEmail(MAIL_NAAR, 'Nieuwe inzending Vastelaovesgezèt: ' + clean(d.titel),
      'Van: ' + d.naam + (d.tel ? ' (' + d.tel + ')' : '') + '\n\n' + doc.getUrl());
  }
  return { ok: true };
}

function voorstel(d, p) {
  const sh = SpreadsheetApp.openById(p.getProperty('SHEET_ID')).getSheetByName('Voorstellen');
  // Een ' ervoor voorkomt dat tekst die met = begint als formule wordt gelezen
  const safe = function (s) { s = String(s || ''); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  sh.appendRow([new Date(), d.bron === 'li' ? 'Limburgs' : 'Nederlands', safe(d.dialect), safe(d.nl), safe(d.zo), safe(d.concept), '']);
  return { ok: true };
}

function verbeteringen(p) {
  const sh = SpreadsheetApp.openById(p.getProperty('SHEET_ID')).getSheetByName('Voorstellen');
  const rows = sh.getDataRange().getValues().slice(1);
  const items = rows
    .filter(function (r) { return String(r[6]).trim().toLowerCase() === 'ja' && r[3] && r[4]; })
    .map(function (r) {
      return { t: r[0] instanceof Date ? r[0].getTime() : 0, bron: r[1] === 'Limburgs' ? 'li' : 'nl', dialect: String(r[2] || ''), nl: String(r[3]), zo: String(r[4]) };
    })
    .sort(function (a, b) { return b.t - a.t; })
    .slice(0, 300);
  return { ok: true, items: items };
}
