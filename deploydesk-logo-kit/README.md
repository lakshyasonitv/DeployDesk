# DeployDesk logo kit

Drop this folder into your project and hand this README to Claude Code. It has everything needed to add the DeployDesk brand to the website.

## The mark
The **Bridge** mark. Cool strokes on the left stand for the **suppliers** (companies with bench engineers). Warm strokes on the right stand for the **clients** (companies hiring). Both point at one blue centre, **Talentvibes**, the broker in the middle. The two sides never touch, which is the product's core promise.

## Files
| File | Use it for |
|---|---|
| `svg/deploydesk-mark.svg` | Default full-colour icon (sidebar, nav, cards) |
| `svg/deploydesk-mark-ink.svg` | One colour on light backgrounds (print, fax, monochrome docs) |
| `svg/deploydesk-mark-white.svg` | One colour on dark or brand-blue backgrounds |
| `svg/deploydesk-lockup.svg` | Icon + "DeployDesk" + "by Talentvibes" on light backgrounds (header, login, email) |
| `svg/deploydesk-lockup-on-dark.svg` | Same lockup, colour mark, white text, for dark mode |
| `svg/deploydesk-lockup-white.svg` | All-white lockup for photos or brand-blue backgrounds |
| `svg/favicon.svg` | Browser tab icon (modern browsers) |
| `svg/app-icon.svg` / `app-icon-dark.svg` | 512px rounded app tile |
| `png/favicon-32.png` | Fallback favicon |
| `png/apple-touch-icon.png` | iOS home screen (180×180) |
| `png/icon-192.png`, `png/icon-512.png` | PWA / Android icons |
| `site.webmanifest` | PWA manifest that references the icons above |
| `react/DeployDeskLogo.tsx` | Drop-in React component (mark or lockup, colour/ink/white) |

## Instructions for Claude Code

> Add the DeployDesk logo kit to this website:
> 1. Copy `svg/favicon.svg`, `png/favicon-32.png`, `png/apple-touch-icon.png`, `png/icon-192.png`, `png/icon-512.png` and `site.webmanifest` into the public/static folder (`/public` in Next.js or Vite).
> 2. Copy the rest of `svg/` to `/public/brand/`.
> 3. Copy `react/DeployDeskLogo.tsx` into the components folder. Skip this if the site isn't React; use the SVG files directly.
> 4. Add these to the document `<head>` (in Next.js App Router, use the `metadata` export in `app/layout.tsx` instead):
>    ```html
>    <title>DeployDesk</title>
>    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
>    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
>    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
>    <link rel="manifest" href="/site.webmanifest">
>    <meta name="theme-color" content="#0b6ed9">
>    ```
> 5. Replace any existing logo or product name in the header, sidebar, login page and footer:
>    - App sidebar: `<DeployDeskLogo size={32} />` next to the text "DeployDesk" (14.5px/800) over "by Talentvibes" (11.5px, muted).
>    - Marketing header / login: `<DeployDeskLogo variant="lockup" size={40} />`
>    - Dark mode: `<DeployDeskLogo variant="lockup" tone="white" />`, or use `deploydesk-lockup-on-dark.svg`
> 6. Load **Plus Jakarta Sans** (weights 600 and 800) so the lockup text renders correctly. Use `next/font/google` in Next.js, or a Google Fonts `<link>`.
> 7. Rename every user-facing "Bench Exchange" to "DeployDesk". The company tagline is "by Talentvibes".

## Usage rules
- **Minimum size:** 16px for the mark, 24px tall for the lockup.
- **Clear space:** at least 25% of the mark's width on every side.
- **Backgrounds:** the colour mark works on white and on dark (#0f1729). On brand blue or photos, use the white version.
- **Don't:** recolour individual strokes, rotate the mark, add drop shadows, stretch it, or swap the warm and cool halves (the left/right meaning matters).
- **Brand blue (centre dot):** `#0b6ed9`. Confirm the exact hex with the brand team. If it changes, update the centre circle in every SVG and `theme_color` in the manifest.

## Font note
The lockup SVGs use live text in Plus Jakarta Sans and fall back to the system sans-serif if it isn't loaded. For a pixel-perfect file that doesn't depend on the font (emails, decks, third-party tools), open the lockup in Figma or Illustrator and outline the text.
