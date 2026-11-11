# Configuration templates

These files are specifications, not active production settings. During implementation copy and validate the relevant examples; do not rename them and assume the application is ready.

`model-registry.example.json` provides a design reference for the selected lineup and documented identifiers; the actual model catalog is implemented in the server-side typed module `server/config/models.ts`. Prices are intentionally unverified/null and every live smoke status is `not_run`. The three generation roles are configured but cannot make live requests until all activation gates pass. The optional Decision Engine is off by default.

The 12k/24k/48k context and 3,072/8,192/12,288 output limits are conservative application starting caps to test. They do not imply that the full allowance fits inside the sample $0.25 run ceiling. The budget controller must reserve against actual request context and maximum output with current rates; it may refuse an expensive requested route and explain alternatives.

`vercel.example.json` is to be installed and validated only after API entry files/build scripts exist. Known SPA routes are rewritten deliberately; test `/api/*` and all deep links in the deployed preview. Add the final tested security headers/CSP during implementation rather than deploying an untested generic policy.

`pwa-manifest.example.json` refers to runtime icon files derived at 192 and 512 pixels from the approved color app-icon master. Do not claim maskable support until safe-zone testing passes; the example uses `purpose: any`. The application's copies are in `public/icons/`, not in this spec package.

`design-tokens.css` is an initial custom Vulpes palette/spacing proposal, not a complete shadcn theme or a change to the approved logo. Map these semantic tokens into the installed component library's actual theme variables, and test contrast in both modes.

`reference-register.json` is the machine-readable source list. It is not an in-app medical evidence corpus or an authorization to browse/upload private data.
