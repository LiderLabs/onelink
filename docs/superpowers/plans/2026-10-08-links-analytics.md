# Links and Analytics Implementation Plan

**Goal:** Build the supplied link manager and analytics views within the existing creator workspace.

**Architecture:** Link edits use the existing private draft API and its timestamp precondition. Analytics offers an unavailable state and explicit illustrative samples because the backend collects no analytics events.

**Constraints:** Preserve charcoal/cyan colors, auth logo, sticky header, all backend contracts, and existing changes. Work in the current workspace without staging, commits, pushes, or branches.

- [x] Link manager: browser acceptance check first; dedicated route; page selection; groups/search/status filtering; add/edit/remove, selection, visibility, ordering, scheduling; draft preview; conflict recovery.
- [x] Analytics: independent route and CSS; honest unavailable metrics; opt-in sample chart, ranges, insights, breakdowns, link table and CSV; responsive browser check.
- [x] Integrate sidebar routes, dashboard actions and breadcrumbs. Verify frontend typecheck, build and browser flows, then obtain a focused read-only review.

Validation: both focused browser scripts passed with real private draft persistence and 390px mobile layouts. Frontend typecheck and production build passed. Read-only review identified ordering, editor reset and modal feedback issues; all three were fixed and rechecked. Backend and Git staging were untouched.

Review focus: stale drafts must never overwrite newer edits; modal input must survive failed saves; schedules must use actual timestamps; publishing must remain explicit; sample analytics must never imply observed visitor activity.
