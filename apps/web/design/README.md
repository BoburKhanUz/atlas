# Design references (web)

Mockups the owner brought or approved, kept as the reference a stage builds to. A
mockup is a picture, not a specification: the site is built with the app's design
tokens (`apps/mobile/lib/core/design/tokens.dart`, copied into the web palette by
`bun run brand:write`), font (Manrope) and brand mark, so colours, type and spacing
follow the app where the picture differs. The pages' text is written in code, never
taken from a picture.

| File | Stage | Status | Notes |
|---|---|---|---|
| `landing-desktop.png` | W0 | brought by the owner 2026-11-28 (made with ChatGPT); direction accepted | The landing page at lookly.uz, desktop (864×1821: a reference, not an asset). Owner decisions, 2026-11-28: there is no web version of the app, so the "Brauzerda ochish" link is left out; the store links are set from the admin panel (until then the badges say "Tez kunda"). The illustrations (the hero phone, the three steps, the shield, the banner's phone) are needed separately, without text, at full resolution. |
| `landing-illustrations` (not kept here) | W0 | brought by the owner 2026-11-28 (made with ChatGPT; the second of eight sheets) | Six pictures on one 1536×1024 sheet whose "transparent" background is a drawn checkerboard. They were cut out with a colour key (light neutral pixels joined to each cell's edge; for the banner's phone also the light circle and its halo; small slivers of the next cell dropped) into `public/landing/*.webp`, about 450 px each: enough for the steps, soft for the hero on large screens. |
| `landing-mobile.png` | W0 | brought by the owner 2026-11-28 (made with ChatGPT); direction accepted | The same page at phone width (724×2172). Same notes. |
