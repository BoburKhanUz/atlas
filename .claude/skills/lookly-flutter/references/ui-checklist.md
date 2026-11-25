# UI pre-delivery checklist (Flutter)

Run through this before showing any changed screen to the owner. Adapted for Lookly
(phone only, portrait, fixed brand) from the MIT-licensed "pro-rules" checklist of
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (v2.15.0).

## Check on

- Widths 360dp and 412dp; text scale 1.0 and 2.0; light and dark theme; reduced motion on.

## Visual

- [ ] Icons from one family (Material Symbols, one style per hierarchy level), sizes from tokens.
- [ ] No emoji as an icon; the Lookly mark only from `assets/brand/`.
- [ ] Colours only from tokens; no per-screen hex values.
- [ ] Pressed states change colour, opacity or elevation without moving the layout.

## Interaction

- [ ] Every tappable element gives pressed feedback within 80–150 ms.
- [ ] Touch targets at least 48×48dp (expand the hit area when the icon is smaller).
- [ ] Disabled controls look disabled and expose disabled semantics.
- [ ] One primary gesture per region; no conflict with the system back gesture.
- [ ] Haptics on selection (`selectionClick`) and on confirmed actions (`lightImpact`/`mediumImpact`), not on every tap.

## Light and dark

- [ ] Text contrast at least 4.5:1, meaningful icons and borders at least 3:1, in both themes (checked separately).
- [ ] Dividers, borders and focus/pressed states visible in both themes.
- [ ] Dark theme uses desaturated tonal surfaces, not an inverted light theme.

## Layout

- [ ] Safe areas respected by app bars, bottom navigation and bottom action bars.
- [ ] Scrolling content is not hidden behind fixed bars (bottom padding includes the inset).
- [ ] 4/8dp spacing rhythm; section spacing tiers 16/24/32/48.
- [ ] No fixed heights that clip at 2.0 text scale.

## Accessibility

- [ ] Decorative images excluded from semantics; meaningful images and icon buttons labelled.
- [ ] Screen-reader order matches visual order; results and errors announced (live region).
- [ ] Colour is never the only signal (add text or an icon).
- [ ] Form fields have labels, hints and inline errors that stay after a failed submit.
- [ ] Sign-in fields allow paste and password managers (`autofillHints`).
- [ ] Animations respect `MediaQuery.disableAnimationsOf`.

## AI content

- [ ] AI-generated text and suggestions are labelled as such.
- [ ] Long AI operations show progress and offer cancel; failures say what happened and what to do.
