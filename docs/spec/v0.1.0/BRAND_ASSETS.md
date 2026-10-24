# Approved brand assets

Source: the supplied `vulpes-brand-assets.zip`. All source files below were copied byte-for-byte; no logo was redesigned. Their SHA-256 values are recorded in `assets/brand-inventory.json`. The original README is included under `assets/brand/README.txt`.

## Use map

| Surface | Approved source | Notes |
|---|---|---|
| Main app header | `core-logos/vulpes-horizontal-transparent.png` | Preserve aspect ratio; do not crop the terminal S |
| Onboarding/about | `core-logos/vulpes-horizontal-with-descriptor-transparent.png` | Use only at a width where the descriptor remains readable |
| Compact symbol | `core-logos/vulpes-symbol-orange-2048-transparent.png` | No artificial outline or redraw |
| Primary PWA icon | `app-icons/vulpes-app-icon-color-1024.png` | Derive runtime sizes; validate safe zones separately |
| Alternative icon | `app-icons/vulpes-app-icon-light-1024.png` / `vulpes-app-icon-dark-1024.png` | Approved alternatives, not automatically interchangeable app identities |
| Small browser icons | `favicons/vulpes-favicon-32.png` and `vulpes-favicon-16.png` | Inspect small-size legibility; do not upscale these for large use |
| Dark/reversed logo | `monochrome/vulpes-logo-monochrome-light-transparent.png` | Approved light single-color asset on dark surface |
| Repo/social composition | `stacked-logos/` | Not the default narrow phone header |

Paths in the table are relative to `assets/brand/`. Copy only used, appropriately sized assets into the eventual app's `public/` directory. Proof sheets and source extractions belong in design documentation, not the shipped client bundle.

## Color and typography observations

Opaque pixels in the primary masters use `#F15A24` orange and `#1F2937` charcoal. The dark icon has a dominant `#1B2834` surface; the light icon uses `#F7F3EC`. The color-icon background is a slightly different sampled orange (`#F05820`); do not recolor the original asset to force exact equality.

The archive has no authoritative body-font specification, font binaries or SVG masters. Use the existing raster wordmark as supplied and a system UI font for the application initially. Do not claim these PNGs are vectors. The original proof explains that source artwork was traced for large exports; larger files do not imply additional original detail.

The CSS token file is a proposed interface palette derived from the assets. It does not change the approved logo palette. Test UI text contrast independently.

## Inventory

| Asset | Dimensions | Bytes |
|---|---|---:|
| `stacked-logos/vulpes-stacked-logo-reverse-transparent.png` | 2400 x 2400 | 172,002 |
| `stacked-logos/vulpes-stacked-logo-transparent.png` | 2400 x 2400 | 203,400 |
| `proofs/vulpes-batch-01-corrected-proof.png` | 1980 x 1260 | 192,864 |
| `proofs/vulpes-batch-02-proof.png` | 2200 x 1800 | 328,350 |
| `core-logos/vulpes-horizontal-transparent.png` | 3200 x 800 | 95,743 |
| `core-logos/vulpes-wordmark-charcoal-transparent.png` | 2500 x 720 | 61,589 |
| `core-logos/vulpes-horizontal-with-descriptor-transparent.png` | 3200 x 1060 | 130,299 |
| `core-logos/vulpes-symbol-orange-2048-transparent.png` | 2048 x 2048 | 108,565 |
| `favicons/vulpes-favicon-128.png` | 128 x 128 | 8,257 |
| `favicons/vulpes-favicon-16.png` | 16 x 16 | 649 |
| `favicons/vulpes-favicon-32.png` | 32 x 32 | 1,492 |
| `favicons/vulpes-favicon-512.png` | 512 x 512 | 36,995 |
| `favicons/vulpes-favicon-64.png` | 64 x 64 | 3,371 |
| `favicons/vulpes-favicon-256.png` | 256 x 256 | 17,633 |
| `app-icons/vulpes-app-icon-dark-1024.png` | 1024 x 1024 | 66,242 |
| `app-icons/vulpes-app-icon-light-1024.png` | 1024 x 1024 | 67,663 |
| `app-icons/vulpes-app-icon-color-1024.png` | 1024 x 1024 | 55,754 |
| `monochrome/vulpes-logo-monochrome-light-transparent.png` | 3200 x 1060 | 152,542 |
| `monochrome/vulpes-logo-monochrome-dark-transparent.png` | 3200 x 1060 | 222,122 |
| `monochrome/vulpes-symbol-monochrome-light-transparent.png` | 2048 x 2048 | 83,319 |
| `monochrome/vulpes-symbol-monochrome-dark-transparent.png` | 2048 x 2048 | 82,734 |
| `README.txt` | Text | 644 |
| `source-extractions/source-fox-native.png` | 213 x 205 | 16,614 |
| `source-extractions/source-descriptor-native.png` | 520 x 22 | 6,059 |
| `source-extractions/source-wordmark-native-COMPLETE.png` | 534 x 157 | 22,503 |
