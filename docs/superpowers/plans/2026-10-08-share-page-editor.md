# Share and Page Editor Plan

**Goal:** Implement the supplied Share & QR and Page editor screens using the existing charcoal/cyan creator workspace.

**Constraints:** Preserve all APIs, private drafts, publishing controls and revision history. Keep the auth logo and sticky header. No staging, commits, pushes or branches.

- [x] Share & QR: actual selected page address, honest publication status, copy/native/platform sharing, scan-safe colors, resolution and badge, PNG/SVG downloads, private preview.
- [x] Editor: reuse existing draft/media/history/publish logic; Profile, Links, Design and Publishing tabs; immediate preview; account photo/social controls; explicit distinction between account updates and private page drafts.
- [x] Connect sidebar routes and page selection; verify browser flows, mobile layout, draft persistence, QR exports and frontend build; manually review account ownership and draft/publication guards.

Validation: both focused browser checks and the frontend production build passed. The app and local API returned HTTP 200. The independent review agent was unavailable due to its usage limit, so the parent reviewed the changed flows directly. A broken Settings import after the intervening merge was corrected with a standalone creator settings route. No API files or Git staging were changed.

API mapping: page display name and introduction map to draft title/bio; page address uses the existing confirmed slug-change API. Profile photo/social changes use the account APIs and apply across pages. No unsupported theme or analytics fields are introduced.
