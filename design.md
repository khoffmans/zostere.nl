# Design: Zöstere.nl

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System
- Genre: editorial
- Shape of the first page: Letter, set as a village bill (the home page); the agenda is an Index, an activity a particulars bill, the vertaler an app screen
- Theme: Broadside, colourway `bill`, and `inked` on a dark screen
- Axes: light/display-condensed/warm · posture: committed

## Tokens
`css/tokens.css` is the source of truth. The roles:
```css
:root {
  --color-paper: oklch(92% 0.028 88);  --color-paper-2: oklch(88.5% 0.032 88);  --color-paper-3: oklch(85% 0.036 86);
  --color-ink: oklch(18% 0.01 50);  --color-ink-2: oklch(30% 0.012 50);  --color-muted: oklch(43% 0.02 62);  --color-rule: oklch(75% 0.028 82);
  --color-accent: oklch(53% 0.19 33);  --color-accent-ink: oklch(95.5% 0.018 88);  --color-focus: oklch(53% 0.19 33);
  --font-display: "Six Caps";  --font-display-2: "Bevan";  --font-body: "Archivo Narrow";
  --radius-card: 0;  --radius-pill: 0;  --rule-hair: 1px;  --rule-bar: 5px;  --rule-frame: 3px;  --shadow-card: none;
}
```
Nine category colours (`--cat-*`) mark the agenda categories as small squares, beside the one vermilion. The spacing and type scales, easings and durations are the scaffold's and live in `tokens.css`. The faces are served from `/fonts/` (OFL), not from Google.

## Type
- Six Caps for fitted lines (`.fit` inside a `.fitbox`, fitted by `js/fit.js`), Bevan for heads and the wordmark, Archivo Narrow for reading and labels, sentence case.

## Controls
- Primary: an ink block, square, 48px (40px on the vertaler), Archivo Narrow 600 in capitals
- Secondary: the same block as a double-rule frame

## Motion
- Character: still. No reveal; under reduced motion everything ends at once.

## Shared files
- `css/zostere.css` holds the stamp, the shared parts and each page's section styles; the agenda pages come from `tools/bouw-aktiviteite.mjs`, the vertaler from its template.

## Exports
`css/tokens.css` in this project.
