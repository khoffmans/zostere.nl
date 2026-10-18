# zostere.nl

| Bestand | Wat |
|---|---|
| `index.html` | Beginpagina van zostere.nl |
| `vertaler/index.html` | Sjrief Zösters, de vertaler (alles in één bestand) |
| `apps-script/Code.gs` | De achterkant: praat met Claude, zet inzendingen in Google Drive en beheert verbetervoorstellen. Draait als Google Apps Script onder Kevins Google-account. |

De Anthropic API-sleutel staat niet in deze repository, maar alleen in de Scripteigenschappen van het Apps Script.

## Beheer

- **Inzendingen voor de Vastelaovesgezèt** komen als Google Doc (met foto) in de Drive-map *Vastelaovesgezet 2027*.
- **Verbetervoorstellen** komen in de Sheet *Sjrief Zösters – verbetervoorstellen* in dezelfde map. Zet **ja** in de laatste kolom om een voorstel goed te keuren; binnen 5 minuten telt het mee.
- **Kosten** volg je in de Anthropic Console (console.anthropic.com).
- **Grenzen** tegen misbruik (vertalingen per 10 minuten en per dag) staan bovenaan `Code.gs`.
- **Code.gs aangepast?** In Apps Script: *Implementeren → Implementaties beheren → potloodje → Versie: Nieuwe versie → Implementeren.* De URL blijft dan hetzelfde.
