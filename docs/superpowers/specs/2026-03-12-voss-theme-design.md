# Voss Theme Design Spec
**Date:** 2026-03-12
**Status:** Approved
**Approach:** Option B — CSS Variables + Targeted Overrides

---

## Summary

Add a selectable "VOSS" theme to the solicitation-quoter app based on the Voss Architecture design system. The theme uses a warm monochrome palette (ink, vellum, stone, dust), Cormorant Garamond serif typography, 0.5px hairline borders, and no border-radius anywhere.

---

## CSS Variable Mapping

| Variable | Value | Source |
|---|---|---|
| `--bg` | `#faf8f4` | Warm White background |
| `--bg2` | `#f9f7f3` | Pale — sidebar/topbar |
| `--bg3` | `#f4f1ea` | Vellum — inputs, data cells |
| `--panel` | `#f9f7f3` | Pale — cards/modals |
| `--navy` | `#e8e4dc` | Dust — nav hover |
| `--navy2` | `#f4f1ea` | Vellum — table headers |
| `--gold` | `#c8a882` | Accent — active/highlight |
| `--gold2` | `#d4b896` | Light Accent — hover |
| `--border` | `#dedad2` | ~rgba(26,25,22,0.1) on warm white |
| `--text` | `#1a1916` | Ink — primary text |
| `--muted` | `#a09c92` | Stone — secondary text |
| `--green` | `#5a7a5a` | Warm muted green |
| `--red` | `#a03830` | Warm muted red |
| `--r` | `0px` | No border-radius |
| `--font` | `'Cormorant Garamond', Georgia, serif` | Primary serif |
| `--scanline-opacity` | `0` | No scanline |

---

## Targeted CSS Overrides (`[data-theme="voss"]`)

1. **Font import** — Cormorant Garamond via Google Fonts `@import` at top of `<style>`
2. **Hairline borders** — cards, inputs, nav items, topbar, sidebar, modals, data-items, table cells all get `0.5px solid`
3. **Active nav** — hairline left accent border, ink background
4. **Input focus** — accent border only, no glow/shadow
5. **Dropzone hover** — warm vellum tint, accent border
6. **Table headers** — stone text, vellum background
7. **Alert-info** — warm tint
8. **Btn-primary** — ink bg, pale text, no shadow
9. **Modal** — flat 0.5px border, minimal shadow only
10. **Theme card swatches** — `#faf8f4`, `#f4f1ea`, `#c8a882`, `#1a1916`

---

## Theme Card Metadata

- **Label:** `VOSS`
- **Desc:** `Architectural minimalism — warm vellum, ink, and stone`
- **Swatches:** `['#faf8f4','#f4f1ea','#c8a882','#1a1916']`

---

## Anti-Patterns to Avoid

- No blue accent colors
- No `border-radius` (all zero)
- No box-shadows on cards
- No glow effects on focus states
- No scanline overlay
- No emojis as icons
