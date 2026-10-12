# Admin workspace

Build the supplied cyan/dark admin UI on the existing API without backend changes, dependency additions, branches, staging, commits, or pushes. The user has supplied the flows and visual reference and has directed feature implementation to proceed.

## Architecture and routes

- `/admin`: overview; `/admin/users`: users; `/admin/reports`: moderation; `/admin/appeals`: appeals; `/admin/settings`: platform policy; `/admin/audit`: audit log.
- Separate admin shell with sticky header, current OneLink branding, capability-filtered sidebar, mobile navigation, avatar menu, dashboard return, and logout.
- Active staff enter through login and the creator avatar dropdown. Anonymous users go to login. Non-staff, restricted, forced-password-change, and impersonated sessions cannot enter; redirect with a readable explanation.
- Keep backend role names: owner, admin, moderator, support, user. Owner is the highest privilege; do not invent a `super_admin` role.
- Use the existing session and request clients. Do not fetch resources or enable mutations without their capabilities. Preserve backend rank checks and last-owner errors.

## Screens

- Overview: real API counts, recent users, pending reports, recent audit activity. No fabricated growth chart; show useful account-status distribution instead.
- Users: server search, role/status filters, sorting and pagination; detail panel; create, edit, warn, suspend, ban, reactivate, delete, notes and sessions where supported. Required reason and confirmation for sensitive actions. Temporary passwords require change on first login. Never claim an email was sent.
- Reports: API queue and filters, raw snake_case detail DTOs, reporter/description/snapshot/action history, safe public-page link from stored snapshot, assign/dismiss/resolve; user warning/ban and whole-page removal with explicit confirmation. Show specific-link removal as unavailable. If action succeeds but report resolution fails, preserve that fact and retry only resolution.
- Appeals: list/detail, uphold/overturn/reduce with reason and duration validation; backend is authoritative on rank and sanction state.
- Settings: existing typed setting records grouped into clear panels; debounced, sequential autosave, invalid-input handling, visible failures, retry, and unsaved-navigation protection. Owner-only writes. Email templates and rate-limit rules unavailable because no API exists.
- Audit: chronological server pagination, action/status/date/search filters, inspect before/after/metadata, CSV export of filtered records through existing paginated API. Escape spreadsheet formula cells; freeze export date upper bound; no partial download on failure.

## Verification

Fixture-based Playwright checks for guards/login/menu, list filters, mutations/confirmation, permission/rank denial, unavailable actions, moderation/appeals, autosave/race/errors, CSV export, mobile layout and keyboard dialogs. Production build/typecheck plus API regression suite. Update README with shipped admin capabilities and remaining gaps.
