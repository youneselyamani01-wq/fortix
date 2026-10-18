# FORTIX WEB — D-006 MINIATURE TEASER
Status: Illustrated React/CSS prototype committed on feature branch — **not built, browser-tested or deployed**
Date: 2026-10-17
Scope: `site/` homepage. Canonical mission remains `/nx`, independent verifier `/verify`.
Branch: `work/public-verification-path-20261017`

## 1. Purpose
Let a first-time visitor **see the autonomous taxi moving** and understand that significant events create evidence, without opening the full D-006 experience. The teaser is an invitation to explore, **not** a verifier and **not** a live telemetry feed.

Success = a clear, accessible route from homepage teaser to `/nx`, not an unsupported assertion of cryptographic validity. Preserve the relationship to the adjacent public PEB/download and pilot-space journeys.

## 2. Approved product direction (proposal)
- A compact, premium **floating teaser card anchored bottom-right** on wider desktop screens; no takeover, no modal by default, no audio.
- Show the real D-006 taxi world in motion using **approved, sanitized footage captured from the existing `/nx` view**. Use its actual assets or a vetted cropped capture; do not invent new causal events or synthetic NanoReceipt counts. The miniature must not execute a second mission engine.
- White or pale-blue surface, fine border, quiet shadow, saturated accent only on the active event/CTA, sans-serif UI. Preserve the FortiX palette and design language.
- Avoid the visual vocabulary of security alerts and dark dashboard widgets; keep road/taxi/event narrative unmistakable.

## 3. Exact footprint and placement
Desktop >=1200px:
- Fixed card in lower right, with 24px right and bottom safe margins (additional bottom safe-area inset if present).
- Recommended card width 340px, max width `min(340px, calc(100vw - 32px))`. Scene ratio 16:9, with a short text/CTA band under it; approximate total height 255–285px.
- Round corners 14–16px; close control must be visible with >=44x44px interactive area.
- Ensure it does **not obscure** the public-proof CTA, Pilot Space CTA, navigation, cookie notices or verifier UI. If a collision cannot be avoided, use an inline card instead of a fixed overlay.
Medium widths 768–1199px:
- Prefer a **non-sticky inline teaser directly below the hero CTAs** or immediately after the hero. A floating card may be enabled only if it demonstrably does not obstruct content.
Mobile <768px:
- **Never** show a fixed autoplaying corner overlay. Show a compact inline poster (landscape) after the hero content, with direct `/nx` link, or a small non-obtrusive launcher. No content occlusion.

## 4. Content / accessibility, exact copy
French:
- Eyebrow: `D-006 · Aperçu simulé`
- Headline: `Un trajet. Des preuves.`
- Caption: `Découvrez comment les événements d'une mission deviennent des NanoReceipts.`
- CTA: `Explorer la démo`
- Close label: `Fermer l'aperçu`
- Play label: `Lire l'aperçu`
- Pause label: `Mettre l'aperçu en pause`
- Descriptive alternative: `Extrait animé simulé de la mission de taxi autonome FortiX.`

English:
- Eyebrow: `D-006 · Simulated preview`
- Headline: `One journey. Evidence that travels.`
- Caption: `See how mission events become NanoReceipts.`
- CTA: `Explore the demo`
- Close label: `Dismiss preview`
- Play label: `Play preview`
- Pause label: `Pause preview`
- Descriptive alternative: `Simulated animated excerpt from the FortiX autonomous-taxi mission.`

All interactive elements keyboard reachable, visible focus indication. Full card must not be one nested clickable surface: close/pause/CTA are separate accessible controls. CTA should use the existing `DEMO_URL` resolver and open `/nx` in a separate tab.

## 5. Motion and evidence honesty
- 10–14 second silent loop with a clean first frame. Sequence idea: taxi traveling → traffic-light stop/restart → labeled NanoReceipt appearance → CTA end beat. Preserve actual D-006 event ordering in any edited montage.
- If moments from different positions in the 109s mission are cut together, call it a **montage/excerpt**, never uninterrupted real-time telemetry. No “Mission live”, no artificial NR counters, no `VALID` labels in the teaser.
- NanoReceipt visual markers must correspond to real D-006 event identifiers if shown; if unverified, show only the generic explanatory label “Événement → NanoReceipt” without pretending a receipt has just been created.
- No physical network badge or physical-world observation claims. The preview is explicitly simulated and does not itself verify anything.
- Use footage sanitized for machine names, local IP addresses, adapter GUIDs, private ids or local environment configuration.

## 6. Playback and performance
- Preferred production medium: short **optimized H.264 MP4** (+ optional WebM) generated from the approved capture, with a lightweight WebP/AVIF/JPEG poster. The MP4 is an implementation asset not yet produced.
- Target <=1.5 MB for the video where visual quality permits; poster ideally <=100KB. Treat these as budgets to validate, not promises.
- `muted`, `playsInline`; autoplay only if user preferences allow. Pause when out of viewport or browser hidden and after dismissal. Do not reserve multiple WebGL canvases for the teaser. Avoid a raw `iframe` of `/nx` because it loads a full second application.
- Honor `prefers-reduced-motion`: static poster, user-triggered playback only. On Save-Data, low bandwidth, or unsupported codecs: show poster/CTA.
- Reserve the card size before loading media to prevent layout shift; provide pause + close controls. Dismissal lasts for the current browsing session; never relaunch unexpectedly on the next route change within that session.
- Do not preload teaser media at higher priority than main hero text, main image or public evidence interactions.

## 7. Integration boundaries
- `site/src/components/teaser/D006Teaser.tsx` and `d006-teaser.css`, if implemented.
- `site/src/app/App.tsx`: render teaser once with section-aware placement and collision handling; ideally a layout-root sibling of `main`.
- `site/src/content/links.ts`: reuse `DEMO_URL`.
- `site/src/i18n/dictionary.ts` + `site/src/i18n/locales/{fr,en}.ts`: add all teaser copy and maintain bilingual parity.
- `site/public/media/`: approved optimized poster/video only. Never copy raw runtime logs or development machine metadata.
- Do not alter `demo/fortix-causal-editing-table/app/nx` mission logic, verdict logic, causal parent graph, PEB schema, network states or verifier just to build the preview.
- Keep the standalone public reference PEB and Pilot Space sections accessible.

## 8. Acceptance gates
1. Visual: recognizable moving taxi on 1440px desktop; content and CTA unobstructed; screen at 1024px/768px/390px has correct inline or compact mode.
2. Honesty: teaser reads as *simulated preview*, not live monitoring; no fictional counters or invented trust verdict.
3. Functional: click opens real `/nx` route; close/pause/play work; dismissal persisted for the current session.
4. Accessibility: keyboard, screen reader labels, focus states, reduced motion, no sound or unexpected playback.
5. Performance: media size budget measured; no second D-006 runtime; no duplicate WebGL runtime; responsive CLS checked.
6. Security: captures reviewed for machine/private data; no new analytics or third-party trackers.
7. Tests: site typecheck, lint, i18n, link check, unit tests, build, desktop/mobile rendered regression, direct /nx route. No merge or production publication without staging review.
8. Product priority: first complete the existing PR #1 public PEB + Pilot Space + staging release gates; add teaser as a separate follow-up change once the asset and layout pass review.

## Explicitly out of scope
No second D-006 engine, no embedded verifier, no evidence export from the teaser, no live network sentinel, no real-time "mission live" claim, no forced autoplay on mobile and no material change to FortiX's doctrinal claims.

## Open implementation dependency
An **approved D-006 media clip and poster do not yet exist in this work item**. Produce them only from verified/sanitized demo visuals; use a poster-only variant in staging until that gate is satisfied.

## 9. Prototype implementation (17 October 2026)
A lightweight React + CSS/SVG teaser was created in `site/src/components/teaser/` and mounted after the homepage hero. This is an **illustrative animation**, not footage recorded from `/nx`, and it is not a sampled replay of the canonical engine. The car is intentionally stylized, per owner acceptance that its silhouette need not match the main website. The simulated label is always visible. The NR glyph is generic; no real receipt count, ID, hash, signed evidence or verifier verdict is claimed by the teaser. The separate public PEB and independent verifier remain the paths for inspecting actual evidence.

This implementation replaces the preferred-MP4 **medium** for the initial iteration, reducing dependencies, size and the risk of releasing machine capture data. The 12-second loop illustrates motion → stop → restart; the exact canonical event timeline is **not** replayed. Real mission data, if needed, must still be inspected in `/nx`.

React tests are added to cover controls, route, locale and reduced-motion behavior. These tests and the site build **have not been executed** by this GitHub edit session; run the release gates and browser staging checks before merge. The component is not yet publicly deployed.
