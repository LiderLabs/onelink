# Profile Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let account holders crop, upload, replace, and remove a persistent profile photo.

**Architecture:** Browser canvas exports a bounded WebP; a Hono media service stores it in existing R2/D1 bindings, and the profile API attaches its owned key. Conditional updates prevent stale attachments; tracked deletion and existing scheduled housekeeping recover interrupted cleanup. The profile UI keeps photo saves independent of identity/social drafts.

**Tech Stack:** Existing React, TypeScript, Vite, CSS, Hono, Zod, Cloudflare D1/R2, Vitest, and Playwright CLI; native canvas, pointer events, dialog, and XMLHttpRequest. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-06-profile-photo-design.md`

## Global Constraints

- Source JPEG, PNG, and WebP files up to 10 MiB; reject decoded images over 40 million pixels.
- Export 512 x 512, non-animated WebP, at most 240 KiB. Start encoding at quality 0.85.
- Preserve the existing 256 KiB global request-body limit.
- Keys are `avatars/{userId}/{assetId}.webp`; use a new ULID per upload.
- Avatar attachment requires owned, active, public, avatar-kind media and an `expectedAvatarKey` precondition.
- Mutation guards: active account, settled password, unimpersonated session. Preserve cookie credentials and existing envelopes.
- Keep the accepted profile design and all accepted auth/profile working-tree changes.
- Crop cancellation sends no upload; update the saved display only after attachment succeeds.
- Object deletion precedes asset-row deletion; first mark the row deleted and conditionally clear its avatar pointer.
- Daily cleanup considers unattached avatars older than 24 hours and marked deletions; at most 100 candidates per run.
- Scope is profile photos. Identity fields, socials, page images, and full public-profile preview are later steps.

## Review Focus

1. A save response is lost after the server commits: reconcile current state before deleting the new asset (Task 6).
2. Another tab changes the photo during a crop: stale attachment returns 409 without overwriting it or producing a success audit (Task 3).
3. A portrait JPEG has EXIF orientation: preview and exported crop show the same orientation (Task 4).
4. A user navigates during encoding/upload or selects a second file while the first is decoding: stale callbacks cannot upload or replace the newer draft (Tasks 4–6).
5. A photo save/refresh occurs with unsaved identity edits: the draft and navigation guard remain intact (Task 6).

## Execution preflight

- Read the spec and this plan. Invoke `superpowers:using-git-worktrees` before implementation; use its supported isolation workflow while carrying the accepted dirty UI baseline into that workspace. Do not start from plain HEAD and lose the accepted redesigns. Keep shared-workspace changes safe.
- Invoke the selected execution skill and TDD. Use `npm.cmd` in PowerShell. Read official primary documentation if implementation needs clarification about WebP structure, Workers APIs, or browser orientation behavior.
- Record initial status and establish the working baseline. The current spec commit is `6261689`; existing auth/profile edits are uncommitted. Each task's commit must contain only its intended delta from the preserved baseline.
- Browser checks use Playwright CLI `run-code --filename=<script>`; the files below contain a single `async page => { ... }` function. Run from a development browser on the Vite origin so cookies/proxy paths match real users. Fixture accounts are disposable local accounts; scripts never embed actual user credentials.

## File boundaries

| File | Responsibility |
| --- | --- |
| `apps/api/src/lib/media.ts` | Avatar constants, WebP validation, media URL construction. |
| `apps/api/src/services/media.service.ts` | Upload metadata, current-avatar read, public object read, owned deletion. |
| `apps/api/src/services/media-maintenance.service.ts` | Bounded retry/abandoned-avatar cleanup. |
| `apps/api/src/routes/media.ts` | HTTP parsing, guards, throttle, envelopes, image headers. |
| `apps/api/src/services/user.service.ts` | Extend existing self-profile update with conditional avatar attachment. |
| `apps/web/src/features/media/types.ts` | Frontend media, decoded-image, and crop types. |
| `apps/web/src/features/media/crop.ts` | Pure bounded crop geometry. |
| `apps/web/src/features/media/image.ts` | Source validation, oriented decode, canvas WebP export, resource release. |
| `apps/web/src/features/media/api.ts` | Credentialed progress upload and typed metadata/deletion calls. |
| `apps/web/src/features/media/PhotoCropDialog.tsx` | Accessible crop interaction and processing/upload states. |
| `apps/web/src/features/profile/ProfilePhotoEditor.tsx` | Profile-specific save/reconcile/remove/cleanup orchestration. |
| `apps/web/src/features/profile/ProfileAvatar.tsx` | Saved image with initials fallback. |
| `apps/web/src/features/profile/profile.css` | Photo section and crop-dialog styling in the existing design. |

### Task 1: Validate bounded WebP avatars

**Files:** Create `apps/api/src/lib/media.ts`, `apps/api/test/media.validation.spec.ts`, and `apps/api/test/fixtures/media.ts`.

**Interfaces:**
- Produces `AVATAR_SIZE = 512`, `MAX_AVATAR_BYTES = 240 * 1024`.
- Produces `validateAvatarWebp(bytes: Uint8Array, declaredMime: string): { mime: 'image/webp'; width: 512; height: 512; bytes: number }`, throwing existing AppError envelopes/statuses for invalid input.
- Produces `mediaUrl(key: string): string`, yielding the same-origin `/api/v1/media/files/` path for a validated avatar key.
- Fixtures export `avatarWebp(): Uint8Array` with a real decodable 512-square file and helpers for container mutations. Browser-generated fixture bytes are test data, not synthetic signatures passed off as valid images.

- [ ] Write named tests asserting valid lossy/lossless/extended WebP dimensions and MIME; `240 * 1024 + 1` bytes throws status 413; wrong MIME, empty bytes, non-WebP, non-512 dimensions, animation, invalid RIFF lengths, truncated chunks, and missing image payload throw status 422. Mutate real fixtures and recompute enclosing lengths when the case requires it.

  ```ts
  it('accepts a real 512-square WebP', () => {
    const bytes = avatarWebp()
    expect(validateAvatarWebp(bytes, 'image/webp')).toEqual({
      mime: 'image/webp', width: 512, height: 512, bytes: bytes.length,
    })
  })
  it('rejects an avatar beyond 240 KiB', () => {
    expect(() => validateAvatarWebp(new Uint8Array(240 * 1024 + 1), 'image/webp'))
      .toThrowError(expect.objectContaining({ status: 413 }))
  })
  ```
- [ ] Run `npm.cmd run test -w @onelink/api -- test/media.validation.spec.ts`; confirm failure names the missing validator or rejected behavior.
- [ ] Implement bounded RIFF/chunk parsing using official WebP container definitions. Reject contradictory dimensions and malformed payload headers; account for odd-chunk padding and bounds before reading. Build the relative URL without allowing key traversal.
- [ ] Re-run the targeted command; all validation assertions pass. Run API typecheck.
- [ ] Commit the validator and its fixtures/tests: `feat(api): validate bounded avatar WebP uploads`.

### Task 2: Upload, inspect, and serve avatar media

**Files:** Create `apps/api/src/services/media.service.ts`, `apps/api/src/routes/media.ts`, `apps/api/test/media.api.spec.ts`; modify `apps/api/src/types.ts`, `apps/api/src/app.ts`, and `apps/api/test/helpers.ts`.

**Interfaces:**
- Consumes Task 1's validator/constants/URL builder.
- Produces backend `MediaAssetRow` matching the existing table and `MediaDto = { id: string; key: string; url: string; width: number; height: number; bytes: number }`.
- Produces `uploadAvatar(env: Cloudflare.Env, actor: ActorInfo, bytes: Uint8Array, declaredMime: string, auditor: Auditor): Promise<MediaDto>`.
- Produces `getCurrentAvatar(db: D1Database, userId: string): Promise<MediaDto | null>` and `readPublicAvatar(env: Cloudflare.Env, key: string): Promise<R2ObjectBody>` (404 on unavailable media).
- Exports `mediaRoutes`, mounted at `/api/v1/media`.
- Test helper adds `rawApi(method: string, path: string, options: { body?: Uint8Array; cookie?: string | null; headers?: Record<string, string> }): Promise<Response>` and `resetMediaStorage(): Promise<void>`; existing JSON `api` behavior stays intact.

- [ ] Add real D1/R2 tests for upload 201, namespaced distinct keys for two users, byte-for-byte stored/served content, `{ media: null }` before attachment, public-read MIME/ETag/no-store, anonymous write rejection, account/password/impersonation guards, invalid kind/body/MIME/dimensions, and 413 at both caps. Assert upload attempt 61 returns 429 with Retry-After after resetting isolate caches.

  ```ts
  it('uploads and publicly serves the exact bounded bytes', async () => {
    const user = await createTestUser()
    const cookie = await loginAs(user)
    const bytes = avatarWebp()
    const response = await rawApi('POST', '/api/v1/media?kind=avatar', {
      cookie, body: bytes, headers: { 'content-type': 'image/webp' },
    })
    expect(response.status).toBe(201)
    const { data } = await response.json() as Envelope<MediaDto>
    expect(data.key).toBe(`avatars/${user.id}/${data.id}.webp`)
    const image = await rawApi('GET', data.url)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes)
  })
  ```
- [ ] Add a failure-injection service test: a failed asset/audit D1 batch deletes the new object; a failed compensation logs the key/request ID and no image contents. Use narrow binding wrappers only for the failing call; happy paths use real bindings.
- [ ] Run `npm.cmd run test -w @onelink/api -- test/media.api.spec.ts`; verify new routes fail before implementation.
- [ ] Implement raw-body upload after guards/throttle, metadata reads, and public byte responses. Insert asset/audit in one D1 batch after R2 put; compensate on failure. Reject undeclared query options. Add `retry-after` to CORS exposed headers, retaining the global body limit and existing security headers.
- [ ] Implement paginated test-bucket reset for objects created by this suite; call it before resetting DB rows. Public file reads map only validated avatar-path parameters to known active public assets.
- [ ] Re-run both media suites and API typecheck. Commit: `feat(api): upload and serve owned avatar media`.

### Task 3: Attach, delete, and recover avatar assets

**Files:** Modify `apps/api/src/validation/profile.schema.ts`, `apps/api/src/services/user.service.ts`, `apps/api/src/services/audit.service.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/services/media.service.ts`, `apps/api/src/routes/media.ts`, `apps/api/src/index.ts`, and `apps/api/test/media.api.spec.ts`; create `apps/api/src/services/media-maintenance.service.ts`, `apps/api/test/media.maintenance.spec.ts`.

**Interfaces:**
- Extends existing `UpdateProfileInput`/request schema with `avatarKey?: string | null` and `expectedAvatarKey?: string | null`; the precondition is required exactly when avatarKey is supplied.
- Keeps `updateOwnProfile(db, actor, input, auditor): Promise<ApiUser>` and existing identity semantics.
- Extends `auditInsertStmt(db: D1Database, entry: AuditEntry, requirePreviousChange?: boolean): D1PreparedStatement`; default remains the existing unconditional insert, while true inserts only if the preceding batch UPDATE changed one row.
- Produces `deleteOwnedAvatar(env: Cloudflare.Env, actor: ActorInfo, id: string, auditor: Auditor): Promise<void>`.
- Produces `cleanupAvatarMedia(env: Cloudflare.Env, referenceTime?: number): Promise<{ removed: number; failed: number }>`; integrate its counts into the existing maintenance report without dropping existing counters.

- [ ] Add attachment tests for owned key and null-clear, foreign/deleted/wrong-kind/private/unknown assets, absent/standalone/stale preconditions, and untouched identity-only writes. Assert committed changes have one success audit and conflicts have no success audit.

  ```ts
  const user = await createTestUser()
  const cookie = await loginAs(user)
  const response = await rawApi('POST', '/api/v1/media?kind=avatar', {
    cookie, body: avatarWebp(), headers: { 'content-type': 'image/webp' },
  })
  const { data: media } = await response.json() as Envelope<MediaDto>
  const attached = await api('PATCH', '/api/v1/auth/me', {
    cookie, body: { avatarKey: media.key, expectedAvatarKey: null },
  })
  expect(attached.status).toBe(200)
  const stale = await api('PATCH', '/api/v1/auth/me', {
    cookie, body: { avatarKey: null, expectedAvatarKey: null },
  })
  expect(stale.status).toBe(409)
  expect((stale.body as ErrorEnvelope).error.code).toBe('CONFLICT')
  const row = await env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
    .bind(user.id).first<{ avatar_key: string | null }>()
  expect(row?.avatar_key).toBe(media.key)
  const audits = await env.DB.prepare(
    "SELECT count(*) AS total FROM audit_logs WHERE action = 'user.profile_update' AND status = 'success' AND request_id = ?",
  ).bind(stale.headers.get('x-request-id')).first<{ total: number }>()
  expect(audits?.total).toBe(0)
  ```
- [ ] Add deletion tests asserting object/row disappearance, conditional pointer clearing, idempotent retry, foreign 404, missing 204, inactive public read, and retention of a marked row on R2 failure. Prove deleting an old asset leaves a newer attached photo alone.
- [ ] Add deterministic stale-read tests using narrow D1 wrappers/interleaving barriers: two concurrent attachments with the same expected key permit only one winner; asset deletion between validation and attachment prevents attachment. Assert pointer, rows, and audits agree.
- [ ] Add maintenance tests with exact timestamps: attached old and unattached recent assets survive; unattached older-than-24-hours and marked assets are removed; at most 100 candidates are processed; one storage failure retains its marked row and does not stop other cleanup. Inject an attachment after candidate selection and verify the final eligibility check protects it. Existing suspension/audit maintenance still passes.
- [ ] Run `npm.cmd run test -w @onelink/api -- test/media.api.spec.ts test/media.maintenance.spec.ts test/profile.api.spec.ts`; verify expected failures.
- [ ] Implement conditional avatar update and active-media eligibility in the SQL write, not only a preceding SELECT. Use a conditional audit INSERT in the same D1 batch tied to the successful UPDATE; inspect update changes for 409. Retain existing username uniqueness and normalization behavior.
- [ ] Implement deletion's mark-and-detach batch with audit, then R2 deletion, then row deletion. Reuse the cleanup primitive for system maintenance with an atomic unattached recheck. Await cleanup and report failures through existing maintenance logging.
- [ ] Re-run targeted suites, then `npm.cmd test` and API typecheck. Commit: `feat(api): attach and safely remove profile photos`.

### Task 4: Browser image processing and crop geometry

**Files:** Create `apps/web/src/features/media/types.ts`, `crop.ts`, `image.ts`, `scripts/browser/profile-photo-image-check.js`, and `scripts/browser/fixtures/source-photo.png` (a generated image with distinct corner colors).

**Interfaces:**
- Frontend types: `MediaAsset` mirrors `MediaDto`; `Crop = { x: number; y: number; size: number }` in oriented source pixels; `DecodedPhoto = { source: ImageBitmap; width: number; height: number; release: () => void }`.
- Produces `initialCrop(width: number, height: number): Crop`, `clampCrop(crop: Crop, width: number, height: number): Crop`, and `zoomCrop(crop: Crop, zoom: number, width: number, height: number): Crop` (zoom 1–4 relative to the initial cover crop, preserving center where possible).
- Produces `decodePhoto(file: File): Promise<DecodedPhoto>` and `encodeAvatar(photo: DecodedPhoto, crop: Crop): Promise<Blob>`.

- [ ] Write Playwright function checks importing these Vite modules in `page.evaluate`. Assert centered wide/tall crops, boundary clamping, stable zoom center, decoded image rejection above 40 million pixels and 10 MiB, invalid formats/corrupt data, and exported WebP MIME/signature/512-square dimensions/size at most `240 * 1024`.

  ```js
  const dimensions = await page.evaluate(async () => {
    const { initialCrop } = await import('/src/features/media/crop.ts')
    return initialCrop(1200, 800)
  })
  if (dimensions.x !== 200 || dimensions.y !== 0 || dimensions.size !== 800)
    throw new Error('wide source must start with a centered square crop')
  ```
- [ ] Include a JPEG fixture with EXIF orientation 6 and distinct colored corners; assert oriented decoded dimensions and expected exported corner colors. Add unsupported WebP encoder and excessive-output-size cases via scoped canvas overrides restored after each check.
- [ ] Run the CLI image-check script against the local Vite browser; confirm missing-module/behavior failures before implementation.
- [ ] Implement source checks and oriented `createImageBitmap` decode. Reject GIF and animated WebP inputs explicitly; source selection never sends bytes to the backend. Encode using qualities `[0.85, 0.75, 0.65, 0.55, 0.45]`, verifying WebP output and bounded size each attempt. Release resources on every rejected decode/export path owned by the helper.
- [ ] Implement pure crop geometry and repeat the script; all returned assertions pass. Run web typecheck. Commit: `feat(web): crop and encode profile photos in browser`.

### Task 5: Credentialed progress upload and accessible crop dialog

**Files:** Create `apps/web/src/features/media/api.ts`, `PhotoCropDialog.tsx`, and `scripts/browser/profile-photo-ui-check.js`; modify `apps/web/src/lib/api.ts` and `apps/web/src/features/profile/profile.css`.

**Interfaces:**
- Produces `uploadAvatar(blob: Blob, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void }): Promise<MediaAsset>`; use XMLHttpRequest with credentials, correct MIME, and 20-second timeout.
- Produces `getCurrentAvatar(): Promise<MediaAsset | null>` and `deleteAvatar(id: string): Promise<void>` through the existing request helper.
- Extracts shared `apiErrorFromResponse(status: number, headers: Headers, payload: unknown): ApiError` in `lib/api.ts`; both JSON fetch and XHR use identical envelope/Retry-After semantics. This is targeted transport reuse, not a client rewrite.
- Dialog props: `{ photo: DecodedPhoto; open: boolean; pending: boolean; phase: 'idle' | 'encoding' | 'uploading' | 'saving'; progress: number | null; error: string | null; onSave: (crop: Crop) => void; onCancel: () => void }`.

- [ ] Add browser assertions for normalized progress, upload credentials/MIME, network/timeout/abort/413/422/429 error envelopes and Retry-After. Use a scoped XHR stub in the Vite browser for deterministic transport events; restore it after each case.
- [ ] Add dialog interaction assertions in the same script using a disposable runtime React mount: focus trapping/return, Escape/cancel, pending dismissal lock, pointer/touch/arrow movement, zoom/reset, drag bounds, accessible label/help/progress/error, and one Save callback despite repeated clicks. The mount is test-only and lives in the browser script.

  ```js
  // The test mount opens the real dialog from a button labelled 'Open crop'.
  await page.getByRole('button', { name: 'Open crop' }).click()
  if (!(await page.getByRole('dialog', { name: 'Crop your photo' }).isVisible()))
    throw new Error('crop dialog must be labelled and visible')
  await page.keyboard.press('Escape')
  if (!(await page.getByRole('button', { name: 'Open crop' }).evaluate(el => el === document.activeElement)))
    throw new Error('Escape must return focus to the opening control')
  ```
- [ ] Run the UI-check script and confirm missing interfaces fail.
- [ ] Implement shared error parsing, transport, and native dialog crop viewport. Map pointer deltas through current rendered viewport dimensions into source pixels; maintain pointer capture and touch-action handling. Reset crop when the decoded photo changes. Release no caller-owned photo in this component.
- [ ] Style within the existing profile design with a responsive dialog that fits 320px width and short viewports. Honor reduced motion and keyboard focus visibility.
- [ ] Repeat image/UI scripts and web typecheck. Commit: `feat(web): add accessible photo crop and upload controls`.

### Task 6: Integrate photo saves, reconciliation, and removal

**Files:** Create `apps/web/src/features/profile/ProfilePhotoEditor.tsx`, `ProfileAvatar.tsx`, and `scripts/browser/profile-photo-flow-check.js`; modify `apps/web/src/features/profile/ProfileScreen.tsx`, `IdentityForm.tsx`, `profile.css`, and `apps/web/src/lib/types.ts`.

**Interfaces:**
- Consumes Tasks 4–5 plus existing `session.updateProfile(input): Promise<SessionUser>` and `session.refresh(): Promise<void>`.
- Extends frontend `UpdateProfileInput` with the Task 3 fields.
- Produces `ProfileAvatar({ avatarKey: string | null; displayName: string; className?: string })` and `ProfilePhotoEditor({ user: SessionUser; readable: boolean; writable: boolean; onBusyChange: (busy: boolean) => void })`.
- Adds `navigationLocked: boolean` to `IdentityFormProps`; ProfileScreen forwards photo busy state. Its existing `useUnsavedChanges` is the single route blocker for identity drafts and pending photo writes; do not mount a second competing router blocker.
- Uses the media metadata URL after reads and the key's declared server URL convention for heading images. Fallback on image load failure, reset failure state when key changes.

- [ ] Write a real local-browser flow: register a disposable account, generate a colored JPEG/PNG file, select it, crop, save, reload, replace, and remove. Assert each save response names owned media; exported upload has 512-square dimensions and bounded bytes; public old URLs become 404 and session avatar changes as expected.
- [ ] Add mocked rejection paths: select/cancel sends zero POSTs; upload/attach failure leaves the saved photo; cleanup failure keeps the committed new photo and exposes Retry cleanup; an attach response lost after commit is reconciled without deleting that asset; a failed reconciliation preserves ambiguous assets for housekeeping instead of guessing.
- [ ] Pin Review Focus cases: conflict with another tab reloads current metadata; unsaved bio survives photo save/removal/refresh and still triggers navigation warning; slow first-file decode cannot replace the second-file draft; pending save blocks route navigation and duplicate controls; unmount cancels transport and releases decoded resources without firing a stale save callback.

  ```js
  await page.getByLabel('Bio', { exact: true }).fill('Unsaved photo-test bio')
  await page.getByLabel('Choose profile photo', { exact: true })
    .setInputFiles('scripts/browser/fixtures/source-photo.png')
  await Promise.all([
    page.waitForResponse(res => res.url().endsWith('/api/v1/auth/me') && res.request().method() === 'PATCH' && res.status() === 200),
    page.getByRole('button', { name: 'Save photo', exact: true }).click(),
  ])
  await page.getByRole('dialog', { name: 'Crop your photo' }).waitFor({ state: 'hidden' })
  if ((await page.getByLabel('Bio', { exact: true }).inputValue()) !== 'Unsaved photo-test bio')
    throw new Error('photo save must preserve the unsaved identity draft')
  ```
- [ ] Add guarded-session cases, image-load initials fallback, same-file reselection, removal confirmation/cancel, and retry-after copy. Run the flow script; confirm failures before integrating.
- [ ] Implement decode generation tokens and resource cleanup; save sequence encode → upload → conditional attach → cleanup old. Label the file input `Choose profile photo` and crop dialog `Crop your photo`. Use `session.updateProfile` for adoption, preserving session-only fields. Reconcile ambiguous errors using fresh server session and media reads before cleanup. Keep cleanup retries separate from crop/save errors.
- [ ] Implement confirmed delete and session refresh, including deletion failures after pointer clearing. Extend the identity guard condition with `navigationLocked`; when navigation is blocked during a photo write, its confirmation is pending and cannot proceed until the operation settles. Retain existing discard/keep-editing behavior for identity drafts afterward. Add the photo section, heading avatar, section numbers, and photo jump link; preserve all existing profile guards.
- [ ] Repeat real/mocked browser flows and web typecheck/build. Commit: `feat(web): upload replace and remove profile photos`.

### Task 7: Verify the complete feature and document its local use

**Files:** Modify `README.md`, `ROADMAP.md`, `UI-ROADMAP.md`, and this plan's completed-task checkboxes as warranted; fixes belong in their owning feature/test files.

**Interfaces:** No new API; evidence must match the spec and actual tested behavior.

- [ ] Run `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd test`. Require clean exits and all tests passing. Investigate failures with systematic-debugging; add regression tests for material behavioral fixes.
- [ ] Run all three committed browser scripts against fresh healthy local API/Vite servers. Inspect 320/390/768/1440 widths and a short mobile viewport; require no overflow, usable drag/zoom/buttons, correct keyboard focus, preserved identity drafts, and zero unexpected JavaScript errors. Capture clean screenshots after fonts settle with reduced motion.
- [ ] Update README with actual photo limits/local run and browser-check commands. Update roadmap status for completed avatar media/crop work only; page images and other profile features remain accurate about their implementation status.
- [ ] Invoke requesting-code-review for the complete delta from the preserved UI baseline; provide the approved spec, plan, changed files, and actual verification results. Address important findings and rerun the affected checks.
- [ ] Commit documentation and any reviewed fixes in focused commits. Report what works, test evidence, local server URLs, and any material limitations. Let the user test and mark this feature active before beginning the next profile feature.

## Handoff

Recommended execution: **Native**, using `superpowers:executing-plans`, because the
seven tasks share a narrow set of media and session interfaces and can be verified
incrementally in this session. One independent review checks the complete feature.
Subagent-driven execution is also available if the user prefers a separate
implementer and review gate for each task.

Implementation starts only after the user reviews this plan and selects an
execution method.
