# zostere.nl

| Bestand | Wat |
|---|---|
| `index.html` | Beginpagina van zostere.nl |
| `vertaler/index.html` | Sjrief Zösters, de vertaler (alles in één bestand) |
| `apps-script/Code.gs` + `appsscript.json` | De achterkant: praat met Claude, zet inzendingen in Google Drive en beheert verbetervoorstellen. Draait als Google Apps Script onder Kevins Google-account. |

De Anthropic API-sleutel staat niet in deze repository, maar alleen in de Scripteigenschappen van het Apps Script.

## Beheer

- **Inzendingen voor de Vastelaovesgezèt** komen als Google Doc (met foto) in de Drive-map *Sjrief Zösters – inzendingen*. Die map mag je verplaatsen (bijv. naar *Vastelaovesgezet 2027*); het script blijft erbij kunnen.
- **Verbetervoorstellen** komen in de Sheet *Sjrief Zösters – verbetervoorstellen* in diezelfde map. Zet **ja** in de laatste kolom om een voorstel goed te keuren; binnen 5 minuten telt het mee.
- **Kosten** volg je in de Anthropic Console (console.anthropic.com).
- **Grenzen** tegen misbruik (vertalingen per 10 minuten en per dag) staan bovenaan `Code.gs`.
- **Code.gs aangepast?** In Apps Script: *Implementeren → Implementaties beheren → potloodje → Versie: Nieuwe versie → Implementeren.* De URL blijft dan hetzelfde.
- **Rechten:** het script vraagt alleen toegang tot bestanden die het zelf maakt (`drive.file`) en tot externe diensten (voor Claude). Zie `apps-script/appsscript.json`.
