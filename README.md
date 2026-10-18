# zostere.nl — Zösters Vertaler live zetten

Deze map is de GitHub-repository voor zostere.nl.

| Map / bestand | Wat | Waar draait het |
|---|---|---|
| `index.html` | Beginpagina van zostere.nl | GitHub Pages |
| `vertaler/index.html` | De vertaler (alles in één bestand, inclusief woordenlijst en Heemklank-zinnen) | GitHub Pages → zostere.nl/vertaler |
| `worker/` | Tussenserver met je Anthropic API-sleutel | Cloudflare Workers (gratis) |
| `apps-script/Code.gs` | Zet inzendingen in je Drive en beheert verbetervoorstellen | Google Apps Script (jouw Google-account) |
| `CNAME`, `_config.yml` | Domeinnaam en instellingen voor GitHub Pages | GitHub Pages |

De API-sleutel en het geheim van het Apps Script staan **nergens** in deze bestanden. Ze worden alleen als geheim in Cloudflare opgeslagen.

---

## Stap 1 — Google Apps Script (± 10 min)

1. Ga naar [script.google.com](https://script.google.com) → **Nieuw project**. Noem het "Zösters Vertaler".
2. Vervang de inhoud van `Code.gs` door die uit `apps-script/Code.gs`. Opslaan.
   *(Wil je bij elke inzending een mail? Vul dan bovenaan `MAIL_NAAR` in.)*
3. Kies bovenin de functie **setup** en klik op **Uitvoeren**. Geef toestemming (je krijgt een waarschuwing "Google heeft deze app niet geverifieerd": kies *Geavanceerd* → *Ga naar Zösters Vertaler*; het is je eigen script).
4. Open **Uitvoeringslogboek**. Kopieer:
   - het **geheim** (een lange reeks letters en cijfers) → nodig in stap 3;
   - de link naar de nieuwe Sheet **"Zösters vertaler – verbetervoorstellen"** (staat ook in je map *Vastelaovesgezet 2027*).
5. **Implementeren → Nieuwe implementatie** → type **Web-app**:
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
   - Kopieer de **web-app-URL** (eindigt op `/exec`) → nodig in stap 3.

> Verander je later iets aan het script, kies dan *Implementaties beheren* → potloodje → *Nieuwe versie*; dan blijft de URL hetzelfde.

## Stap 2 — Anthropic API-sleutel (± 5 min)

1. Ga naar [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**. Noem hem "zostere.nl".
2. Kopieer de sleutel (begint met `sk-ant-`). Je ziet hem maar één keer.
3. Zet bij **Limits / Billing** een **maandlimiet** (bijv. € 10). Een vertaling kost met Claude Sonnet 5.5 ongeveer 1–2 cent.

## Stap 3 — Cloudflare Worker (± 10 min)

Nodig: een gratis Cloudflare-account en Node.js op je computer.

```bash
cd worker
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY      # plak de sleutel uit stap 2
npx wrangler secret put APPS_SCRIPT_URL        # plak de web-app-URL uit stap 1
npx wrangler secret put APPS_SCRIPT_SECRET     # plak het geheim uit stap 1
npx wrangler deploy
```

`wrangler deploy` toont het adres van de worker, bijvoorbeeld
`https://zostere-vertaler.kevin.workers.dev`.

Geeft `deploy` een fout over `ratelimits`, haal dan de twee `[[ratelimits]]`-blokken uit `wrangler.toml` weg en probeer opnieuw. De worker werkt dan zonder limiet per bezoeker; de maandlimiet uit stap 2 blijft je vangnet.

**Zet dit adres in de site:** open `vertaler/index.html`, zoek naar
`https://zostere-vertaler.JOUW-SUBDOMEIN.workers.dev` en vervang het door jouw worker-adres.

## Stap 4 — GitHub Pages (± 10 min)

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `zostere.nl`, en zet alle bestanden uit deze map erin.
2. **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
3. Bij **Custom domain** staat `zostere.nl` al (uit het `CNAME`-bestand). Laat het staan.

## Stap 5 — DNS bij TransIP (± 5 min, daarna even wachten)

In het TransIP-controlepaneel → **Domein → zostere.nl → DNS**. Zet indien nodig "TransIP-instellingen" uit, zodat je de records zelf kunt beheren. Verwijder bestaande A- en AAAA-records voor `@` en `www`, en voeg toe:

| Naam | Type | Waarde |
|---|---|---|
| `@` | A | `185.199.108.153` |
| `@` | A | `185.199.109.153` |
| `@` | A | `185.199.110.153` |
| `@` | A | `185.199.111.153` |
| `www` | CNAME | `JOUW-GITHUB-NAAM.github.io.` |

Na een paar minuten tot een paar uur kleurt de controle in **Settings → Pages** groen. Vink dan **Enforce HTTPS** aan.

Klaar: **https://zostere.nl/vertaler**

---

## Beheer

- **Inzendingen voor de Vastelaovesgezèt** komen direct als Google Doc (met foto, ook los als JPG) in je map *Vastelaovesgezet 2027*.
- **Verbetervoorstellen** komen in de Sheet *Zösters vertaler – verbetervoorstellen*. Zet in de laatste kolom **ja** bij een goed voorstel; binnen ongeveer 5 minuten telt het mee als voorbeeld en staat het onder "Verbeterde voorbeelden" op de site.
- **Kosten** volg je in de Anthropic Console. Elke vertaling is één verzoek.
- **Inspreken** werkt in Chrome, Edge en Safari (ook op iPhone en Android). In Firefox krijgt de bezoeker uitleg over de dicteerfunctie van zijn toestel.

## Lokaal testen

Zet in `worker/wrangler.toml` bij `DEV_ORIGIN` bijvoorbeeld `http://localhost:8000`, deploy opnieuw, en start in de hoofdmap `python3 -m http.server 8000`. Haal `DEV_ORIGIN` weer leeg als je klaar bent.
