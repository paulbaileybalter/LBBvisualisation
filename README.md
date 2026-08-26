# Brew Board — Live Dashboard

A condensed version of the Brew Board Analytics prototype, built to sit
permanently on a monitor rather than be browsed on a laptop. It shows only
the week strip, the weekly stat cards, and the SKU pies — everything else
from the full prototype (daily workload chart, maintenance/grain notes,
trend, email export) has been deliberately removed to keep this focused
and glanceable from across a room.

**This is a separate, independent copy of the site — not a mode or toggle
on the original.** The full prototype stays untouched as your archive;
this folder is a standalone deploy with its own trimmed `index.html`,
`app.js`, and `styles.css`. They don't share code at runtime, so updating
one doesn't affect the other.

## What's different from the prototype

- **Removed:** daily workload chart, maintenance & notes, grain deliveries, trend chart — everything that lived below "Volume by SKU This Week"
- **Widened:** the page now uses up to 1900px of width instead of 1180px, so it makes better use of a large monitor instead of leaving space unused on either side
- **Sized up:** text, the day-strip cards, the stat cards, and the pies are all noticeably larger than in the prototype — a dashboard meant to be read from a few metres away needs bigger type and bigger charts than one meant to be read up close on a laptop. If you'd rather this matched the prototype's sizing exactly (just wider, not bigger), that's an easy adjustment — just ask.
- **Kept:** the week picker in the header still works, so if useful you can page back through past weeks — it isn't locked to always showing the current week
- **Fits without scrolling, guaranteed:** the whole page is a flex layout designed to fill a 1920×1080 screen exactly, with `overflow: hidden` set at every level (page, each section, every day card, every chart card). If a particular week has unusually long SKU lists or notes, that content clips quietly inside its own box rather than growing the page and forcing a scrollbar. This was built and reasoned through carefully, but I haven't been able to see it rendered on an actual screen — if the proportions look off on your real monitor (e.g. it's not 1920×1080, or something looks cramped/oversized), tell me the resolution and what looks wrong and I'll tune the sizing.
- **Day-strip bars redesigned:** instead of thin bars with a separate SKU text list underneath, the four bars (brew/transfer/canning/kegging) are now wide enough to carry a short SKU label written sideways inside each one — up to 2 SKUs by name, plus a "+N" if there's more than that — horizontally centered and anchored to the bottom of the bar, bold for legibility. (The horizontal centering needed a specific fix: `text-align` doesn't center horizontally on a `writing-mode: vertical-rl` element the way it does on normal text — in vertical writing mode it aligns the vertical axis instead. Centering a rotated element like this reliably needs `left:50%` plus `translateX(-50%)` in the transform, which is what's used now.) This freed up the vertical space the old list took, on both the site's day cards and the matching canvas-drawn cards in the emailed report. There's a real physical limit to how much text fits rotated inside a narrow bar — hover any bar on the site for the full, untruncated detail (every SKU, exact hL) via its tooltip; the emailed version can't do hover, so it's limited to whatever fits in the label itself.
- **Krones + DME combined into one "Brewing" pie:** the two brewhouse pies are now a single pie covering all brewing, dropping the pie row from 5 charts to 4. Same on the emailed report.
- **Pie labels sit below the pie in two columns,** not one — the site uses CSS multi-column (`columns: 2`) with each row protected from being split across the column break; the email uses an actual two-cell table instead, since CSS multi-column support is unreliable once pasted through Gmail's sanitizer. Twice as many SKUs now fit in the same vertical space, which is what was getting clipped before.
- **Bars are now the visual focal point, pies secondary:** the day-strip section has more claim on the page's vertical space than the pie section (bars can grow taller if there's room; pies are capped at a modest height), reversing the previous balance.
- **Email export moved, not removed:** the little icon in the top-left corner of the header (an up-arrow, where a decorative brew-kettle icon used to sit) is a working button. Click it to copy an email-ready report to your clipboard, same as the prototype's "Copy report to clipboard" button — just condensed to match what's actually on this page (week strip, weekly totals, and pies; no workload/trend/notes/grain sections, since those aren't part of this version). The icon briefly turns into a checkmark to confirm the copy worked, then reverts.

## Files

- `index.html` — trimmed page structure (week strip, stats, pies only)
- `styles.css` — same design system as the prototype, widened and scaled up for a monitor
- `app.js` — trimmed rendering logic (week strip/stats/pies) plus a condensed version of the email-export system
- `data.json` — a copy of the prototype's data. If you refresh the prototype's data, copy the updated `data.json` here too — they don't stay in sync automatically
- `logo.svg` — company logo
- `netlify.toml` / `_headers` — deploy config for Netlify and Cloudflare Pages respectively (same as the prototype)

### If changes don't seem to show up after redeploying

Same caching gotcha as the prototype: `index.html` links to `styles.css`
and `app.js` with a version query string (currently `?v=9`). Browsers and
CDNs cache these aggressively by filename, so if you make further edits,
bump that number so people actually see the update — and if something
still looks stale after redeploying, try a hard refresh (Ctrl/Cmd+Shift+R)
before assuming the deploy failed.

## Deploying

Same as the prototype: drag this whole folder into your hosting provider
(Netlify's Deploys tab for an existing site, or Cloudflare Pages' direct
upload). This is a separate site from the prototype, so give it its own
project/URL rather than overwriting the archived one.

If this is going on a monitor permanently, a couple of things worth
setting up on whatever device drives that screen:
- Open it in kiosk/full-screen mode (most browsers support a fullscreen
  shortcut like F11) so there's no browser chrome eating into the space
- Consider disabling sleep/screensaver on that machine
- The page doesn't auto-refresh — if you want it to periodically re-check
  for a new `data.json`, that would need a small addition (e.g. reloading
  the page every N minutes). Ask if you'd like that added.

## Keeping the data current

This dashboard reads the same `data.json` format as the prototype. To
refresh it: regenerate `data.json` via the prototype's `parse_brewery.py`
(see the prototype's README), then copy the resulting file into this
folder and redeploy.
