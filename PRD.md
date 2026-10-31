# LANDCU.BE — Local Contour Background Generator

## Purpose

Build a small, locally running webpage that displays a randomly generated topographic contour background. Opening or refreshing the page produces a new design. The first version is a visual proof of concept for website backgrounds.

## Experience

The user starts a local development server and opens its URL. A contour pattern fills the browser viewport immediately, with no buttons, menus, text, or other interface. The image remains still until the page is refreshed.

The default appearance is a charcoal background with subtle, lighter contour lines. The result should feel calm, organic, and usable behind website content. The supplied reference images guide the flowing shapes and nested loops; this version does not attempt to reproduce a specific geographic location.

## Scope

- One full-viewport webpage running entirely in the browser.
- A new random seed on every page load.
- Smooth procedural terrain and mathematically derived contour lines.
- Crisp rendering at different viewport sizes and pixel densities.
- No accounts, backend, or runtime network dependencies beyond public elevation tiles and consent-gated hosted-site analytics.
- The hosted site MUST NOT send design-link query strings to Google Analytics. Google also collects standard browser details (IP address, user agent, referrer, screen size).
- Where the origin is not `landcu.be`, the editor MUST NOT request `googletagmanager.com`.

## Analytics consent

REQ-1: Where the origin is `landcu.be`, the editor MUST NOT request `googletagmanager.com` before the visitor selects "Allow analytics".

Rationale: visitors decide before any Google request.

REQ-2: When the visitor selects "No thanks", the editor MUST NOT request `googletagmanager.com` on later loads in that browser.

Rationale: a declined choice stays declined.

REQ-3: When the visitor selects "Allow analytics", the editor MUST load the tag on later loads without showing the dialog.

Rationale: the choice is asked once.

```gherkin
REQ-1: Given a first visit to https://landcu.be/ with no stored choice
  When the page loads
  Then the analytics dialog is shown
  And no request to googletagmanager.com has been made

REQ-2: Given the visitor selected "No thanks"
  When the page is reloaded
  Then the dialog is not shown
  And no request to googletagmanager.com is made

REQ-3: Given the visitor selected "Allow analytics"
  When the page is reloaded
  Then the dialog is not shown
  And the tag is requested from googletagmanager.com
```

Controls, export buttons, animation, real geographic data, 3D previews, and website-content previews are outside this version.

## Generation requirements

Generate a continuous two-dimensional height field using seeded, smooth procedural noise. Combine a few spatial scales to produce broad hills and valleys with restrained smaller details. Use fixed, evenly spaced elevation levels to extract contour paths with marching squares or an equivalent contouring algorithm.

The initial visual should favour broad flowing shapes, a mix of nested loops and paths leaving the frame, and enough variation to avoid looking like evenly spaced parallel waves. Start with approximately 15–25 elevation levels and tune against the references. The number of visible lines will vary with terrain and viewport size.

Contour geometry must satisfy these rules:

- Different elevation contours do not cross.
- Paths close into loops or terminate at the visible boundary; they do not end arbitrarily inside the image.
- Ambiguous saddle cells are resolved consistently, for example with an asymptotic decider, to avoid accidental branching or broken joins.
- Terrain remains smooth enough that lines appear flowing rather than visibly following a grid.
- Any path smoothing must preserve the contour topology and avoid introducing crossings. Prefer sufficient sampling resolution over aggressive decorative smoothing.

Generate beyond the visible edges and clip the result to the viewport, so boundaries look like a crop from a larger landscape. These are synthetic terrain contours, not a survey or navigational map.

## Rendering and layout

Use SVG paths for the initial renderer, with one solid page background and consistent thin strokes. The SVG fills the viewport without stretching the terrain differently along each axis. There must be no page margins, scrollbars, visible grid, or labels.

On resize, preserve the current seed and terrain scale, then redraw the newly visible area. Existing terrain should remain anchored to the top-left origin rather than changing randomly during resizing. Debounce expensive regeneration where needed. A refresh selects a new seed.

Treat the image as decorative: hide the SVG from assistive technology. The page title is “LANDCU.BE”.

## Implementation direction

Use a minimal TypeScript web project with a lightweight local development server. Keep terrain generation, contour extraction, and SVG rendering separate so appearance can be refined independently.

Three.js is unnecessary for this version. The output is entirely two-dimensional; a future terrain preview could reuse the same height field.

Keep these settings together in source code, with no settings UI:

- Background and line colours.
- Stroke width and opacity.
- Terrain feature scale and noise detail.
- Sampling resolution and contour interval/count.
- Overscan margin around the viewport.

Use a seeded random generator throughout so a known seed and viewport can reproduce a result during development. Log the seed to the browser console for debugging. Document the commands to install dependencies and start the local server in a README.

## Performance

Target a visible pattern within one second of page load on a typical modern laptop at a 1440 × 900 viewport, after local assets load. Keep sampling bounded so large screens do not cause excessive memory use or long browser freezes. There is no continuous render loop; work occurs on load and resize only.

## Acceptance criteria

1. Following the README starts the page locally without credentials or external services.
2. The page shows only a full-viewport contour background, with no controls or scrollbars.
3. Refreshing produces a visibly different pattern; the console records its seed.
4. A fixed seed reproduces the same geometry for a fixed viewport and configuration.
5. Visual inspection across at least ten seeds finds flowing contours, nested loops, and no obvious grid artefacts, broken interior endpoints, or crossings.
6. The page works at mobile portrait, laptop, and large desktop viewport sizes, with crisp strokes on high-density screens.
7. Resizing keeps the seed and existing terrain anchored while filling the new viewport.
8. The browser reports no application errors, and generation meets the initial performance target on the development machine.

## Validation

Use focused geometry checks for closed paths, shared-cell joins, and saddle-cell handling. Inspect several fixed seeds at representative viewport sizes to assess aesthetics and edge clipping. Record initial generation timing in the browser. Avoid screenshot tests that require every random output to match a single reference.

## Possible follow-ups

Once the visual quality is established, consider colour and density controls, shareable seeds, SVG/PNG export, seamless tiling, and a Three.js terrain preview. None are required to complete this prototype.
