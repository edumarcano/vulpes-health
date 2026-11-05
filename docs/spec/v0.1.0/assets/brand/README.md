# Vulpes Brand Assets — v2 Review Package

**Status: review candidate, not yet approved or installed in the repository.**

This package keeps the approved orange fox and mixed-case Vulpes wordmark.
Horizontal layout was recomposed by aligning the fox visual center to the
wordmark (rather than the bottom of the descriptor) with measured spacing.
All light/dark/monochrome variations use the same raster master.

## Folders
- `masters/`: transparent fox, wordmark and descriptor rasters
- `lockups/`: horizontal and stacked, with/without descriptor, light/dark, mono
- `icons/`: 1024/512/192 light/dark/color icons; rounded alternatives; maskable 1024
- `favicons/`: 16 through 512px PNG plus multipage .ico
- `social/`: sharing banner and square avatars
- `preview/`: proof/contact sheets
- `docs/asset-manifest.json`: file dimensions and SHA-256 hashes

## Correct usage
Main app header: `lockups/vulpes-horizontal-wordmark-light.png`; dark theme: reverse.
Landing/README: horizontal descriptor version.
App icon: square PNG from `icons/`; use maskable icon for PWA maskable purpose.
Favicon: `favicons/favicon.ico` or 32px PNG.

## Important provenance
The brand board is a raster design generated earlier. The only recoverable local
reference in this build was `vulpes_brand_identity_guide.png` (1448x1086);
source fox roughly 200px high. New high-resolution output files are crisp
*raster reconstructions*, not true high-resolution source vectors. Fine
contour fidelity is limited by that source resolution, and these should be
reviewed at their actual deployed sizes. The redesign-free extraction may
differ slightly in edge antialiasing/color versus the originally exported PNG.
