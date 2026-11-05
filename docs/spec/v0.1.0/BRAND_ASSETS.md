# Approved brand assets

Source: the supplied `vulpes-brand-assets-v2-review.zip`. All source files below were copied byte-for-byte; no logo was redesigned. Their SHA-256 values are recorded in `assets/brand-inventory.json`. The v2 README is included under `assets/brand/README.md`.

This document records repository approval. The supplied README's review-candidate status describes the source package before adoption; it is preserved unchanged for provenance and inventory verification. Public redistribution follows the repository [branding permissions](../../../BRANDING.md).

## Use map

| Surface | Approved source | Notes |
|---|---|---|
| Main app header (light) | `lockups/vulpes-horizontal-wordmark-light.png` | Preserves visual center alignment; no descriptor at mobile header scale |
| Main app header (dark) | `lockups/vulpes-horizontal-wordmark-reverse.png` | Matched 2945x940 aspect ratio; prevents layout shift across theme toggles |
| Onboarding / hero | `lockups/vulpes-horizontal-descriptor-light.png` | Render at minimum 240px width to ensure descriptor legibility |
| Onboarding / hero (dark) | `lockups/vulpes-horizontal-descriptor-reverse.png` | Reverse variant with descriptor for dark surfaces |
| Vertical / repo profiles | `lockups/vulpes-stacked-light.png` / `reverse.png` | Balanced stacked lockup for square or column-first surfaces |
| Single-color print / receipt | `lockups/vulpes-mono-charcoal-*.png` / `white-*.png` | Pure monochrome lockups without accent tint |
| Primary PWA icon | `icons/vulpes-icon-color-192.png` and `512.png` | Full-bleed square app icons (`purpose: "any"`) |
| Adaptive PWA icon | `icons/vulpes-maskable-color-1024.png` | Dedicated maskable icon with safe zone padding (`purpose: "maskable"`) |
| Alternate theme icons | `icons/vulpes-icon-dark-*.png` / `light-*.png` | System theme-matched icon alternates |
| Desktop browser favicon | `favicons/favicon-32.png` and `favicon-16.png` | Modern tab icons |
| Fallback & multi-res ICO | `favicons/favicon.ico` | 16/32/48/64/128/256 multi-layer ICO |
| Apple touch icon | `favicons/favicon-180.png` | iOS home screen bookmark target |
| Social card & sharing banner | `social/vulpes-social-banner-1200x630.png` | Standard 1.91:1 Open Graph banner |
| Organization / profile avatar | `social/vulpes-avatar-color-1200.png` | High-resolution square social avatar |

Paths in the table are relative to `assets/brand/`. Copy only used, appropriately sized assets into the application `public/` directory. Proof sheets, source extractions, and masters belong in design documentation, not the shipped client bundle.

## Color and geometry rules

Opaque pixels in the primary masters use `#F15A24` orange and `#1F2937` charcoal. The dark icon has a dominant `#1B2834` surface; the light icon uses `#F7F3EC`. The color-icon background is sampled orange (`#F05820`); do not recolor the original asset to force exact equality.

- **Aspect ratios:** The horizontal wordmark lockup is exactly `2945 : 940` (3.133 : 1). The descriptor lockup is `2945 : 948` (3.106 : 1). Always preserve aspect ratio without stretching or non-uniform scaling.
- **Legibility minimums:** Do not render the descriptor lockup below 240px rendered width. In compact headers (< 200px width), use the wordmark-only lockup.
- **Clear space:** Maintain surrounding clearance of at least 50% of the mark height around any lockup.
- **Raster provenance:** Files are crisp raster reconstructions from native source references, not vectors. Do not trace, add outlines, redraw, or upscale beyond native dimensions.

## Inventory

| Asset | Dimensions | Bytes |
|---|---|---:|
| `docs/asset-manifest.json` | JSON | 9,189 |
| `favicons/favicon-128.png` | 128 x 128 | 10,328 |
| `favicons/favicon-16.png` | 16 x 16 | 596 |
| `favicons/favicon-180.png` | 180 x 180 | 16,532 |
| `favicons/favicon-256.png` | 256 x 256 | 27,251 |
| `favicons/favicon-32.png` | 32 x 32 | 1,625 |
| `favicons/favicon-48.png` | 48 x 48 | 2,793 |
| `favicons/favicon-512.png` | 512 x 512 | 73,050 |
| `favicons/favicon-64.png` | 64 x 64 | 4,113 |
| `favicons/favicon.ico` | ICO | 46,992 |
| `icons/vulpes-icon-color-1024.png` | 1024 x 1024 | 171,277 |
| `icons/vulpes-icon-color-192.png` | 192 x 192 | 16,202 |
| `icons/vulpes-icon-color-512.png` | 512 x 512 | 66,233 |
| `icons/vulpes-icon-color-rounded-1024.png` | 1024 x 1024 | 186,748 |
| `icons/vulpes-icon-dark-1024.png` | 1024 x 1024 | 195,457 |
| `icons/vulpes-icon-dark-192.png` | 192 x 192 | 18,501 |
| `icons/vulpes-icon-dark-512.png` | 512 x 512 | 75,894 |
| `icons/vulpes-icon-dark-rounded-1024.png` | 1024 x 1024 | 210,502 |
| `icons/vulpes-icon-light-1024.png` | 1024 x 1024 | 195,102 |
| `icons/vulpes-icon-light-192.png` | 192 x 192 | 16,671 |
| `icons/vulpes-icon-light-512.png` | 512 x 512 | 71,728 |
| `icons/vulpes-icon-light-rounded-1024.png` | 1024 x 1024 | 210,959 |
| `icons/vulpes-maskable-color-1024.png` | 1024 x 1024 | 138,659 |
| `lockups/vulpes-horizontal-descriptor-light.png` | 2945 x 948 | 330,103 |
| `lockups/vulpes-horizontal-descriptor-reverse.png` | 2945 x 948 | 328,870 |
| `lockups/vulpes-horizontal-wordmark-light.png` | 2945 x 940 | 272,925 |
| `lockups/vulpes-horizontal-wordmark-reverse.png` | 2945 x 940 | 271,863 |
| `lockups/vulpes-mono-charcoal-descriptor.png` | 2945 x 948 | 303,313 |
| `lockups/vulpes-mono-charcoal-wordmark.png` | 2945 x 940 | 251,025 |
| `lockups/vulpes-mono-white-descriptor.png` | 2945 x 948 | 303,305 |
| `lockups/vulpes-mono-white-wordmark.png` | 2945 x 940 | 251,014 |
| `lockups/vulpes-stacked-light.png` | 1960 x 1656 | 307,230 |
| `lockups/vulpes-stacked-reverse.png` | 1960 x 1656 | 306,428 |
| `masters/descriptor-charcoal-transparent-1800.png` | 1800 x 66 | 104,899 |
| `masters/descriptor-native.png` | 516 x 19 | 6,028 |
| `masters/fox-orange-native.png` | 214 x 200 | 17,215 |
| `masters/fox-orange-transparent-2000.png` | 1712 x 1600 | 882,232 |
| `masters/vulpes-fox-charcoal-transparent.png` | 2191 x 2048 | 1,152,520 |
| `masters/vulpes-fox-orange-transparent.png` | 2191 x 2048 | 1,298,383 |
| `masters/vulpes-fox-white-transparent.png` | 2191 x 2048 | 531,986 |
| `masters/vulpes-wordmark-charcoal-transparent.png` | 2600 x 755 | 370,000 |
| `masters/vulpes-wordmark-native.png` | 530 x 154 | 14,010 |
| `masters/vulpes-wordmark-orange-transparent.png` | 2600 x 755 | 419,407 |
| `masters/vulpes-wordmark-white-transparent.png` | 2600 x 755 | 207,975 |
| `masters/wordmark-charcoal-transparent-2500.png` | 2500 x 726 | 347,954 |
| `preview/01-main-proof.png` | 2200 x 2450 | 542,664 |
| `preview/02-variants-proof.png` | 2100 x 1760 | 347,419 |
| `README.md` | Markdown | 1,688 |
| `social/vulpes-avatar-color-1200.png` | 1200 x 1200 | 212,847 |
| `social/vulpes-avatar-dark-1200.png` | 1200 x 1200 | 242,583 |
| `social/vulpes-avatar-light-1200.png` | 1200 x 1200 | 245,827 |
| `social/vulpes-social-banner-1200x630.png` | 1200 x 630 | 104,499 |
