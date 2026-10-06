# Profile photo editor

Date: 2026-10-06
Status: Approved by the user on 2026-10-06
Baseline: `585dcbd`, plus the user's accepted auth and profile redesigns in the working tree

## Intent and scope

Let an account holder upload, crop, replace, and remove their profile photo from
`/app/profile`. The user asked to build the profile-editor features one at a time
and approved this photo flow in chat: select JPEG, PNG, or WebP; drag and zoom a
square crop; resize locally to 512 x 512 WebP; explicitly save; show initials when
removed; preserve the current photo if uploading or attaching its replacement fails.

Success means the saved photo survives reload, renders in the profile heading,
and can be replaced or removed through working API calls. This change includes
the missing media backend needed for that flow. It supersedes the earlier UI
spec's exclusion of avatar upload for this feature only.

Identity fields, socials, public-page rendering, and the full live profile
preview are separate steps. Page images, arbitrary media galleries, animated
avatars, and private evidence uploads are outside this pass.

## Existing foundation and approach

R2 bindings, `media_assets`, `users.avatar_key`, and the `media_upload_user`
throttle already exist. No migration is needed. The authenticated user DTO
already returns `avatarKey`; the self-edit schema currently rejects it.

Use the roadmap's shared media routes and browser processing (R1.3 / U5 / D4).
Keep media validation and storage in focused backend modules, and reusable crop
and image helpers under `apps/web/src/features/media/`. Profile-specific save
orchestration belongs with the profile editor.

An avatar-only endpoint would have fewer initial routes but duplicate the
roadmap's eventual media flow. Worker-side image transformation would introduce
an additional service or processing dependency. The shared API with browser
canvas processing fits the existing bindings and the approved interaction.
Only `kind=avatar` is supported initially; other kinds are rejected explicitly.

## Interface and accessibility

Add a Profile photo section above Profile details, using the accepted profile
page's fonts, soft controls, spacing, and section dividers. Show the saved photo
or initials, an Upload photo / Change photo button, and Remove photo when set.
Update section numbers and the existing jump navigation accordingly.

Selecting a supported file opens a labelled crop dialog with a square viewport,
a visible crop boundary, a zoom range, Reset crop, Cancel, and Save photo.
Center the image initially and cover the crop completely. Support pointer drag
for mouse and touch, arrow-key movement on the focused crop viewport, and native
keyboard interaction with the labelled zoom range. Clamp movement so the crop
never contains empty space. Describe these controls in accessible help text.

The dialog manages focus, Escape, and return focus to the trigger. Cancel and
Escape discard the draft without uploading. While saving, lock duplicate
actions and dialog dismissal, show processing/upload/saving states, and expose
upload progress with an accessible progress indicator. Do not publish the draft
to the main saved-photo display before the attach response succeeds.

Removing a saved photo requires a short confirmation. Successful removal shows
initials. Image-load errors also show initials. Restricted accounts, forced
password-change sessions, and impersonated sessions retain the existing profile
write guards; photo mutation controls are disabled with the existing explanation.

## Browser image processing

- Accept source JPEG, PNG, and WebP files up to 10 MiB. Reject empty files, SVG,
  GIF, unsupported formats, corrupt images, and decoded images over 40 million
  pixels with a useful inline error. The source file stays in the browser.
- Apply the browser's image orientation handling consistently to the crop preview
  and canvas output. Crop coordinates describe that same oriented image.
- Export a square 512 x 512 WebP through canvas. Start at quality 0.85 and lower
  quality in bounded steps if necessary to meet a 240 KiB encoded-byte cap.
  If encoding cannot meet the cap, report the error without uploading. Check
  that the returned blob actually has WebP bytes; unsupported encoding must not
  silently send PNG with a WebP label.
- Release image bitmaps and object URLs when replaced, cancelled, or unmounted.
  Selecting the same file again works. Crop and encoding errors preserve the
  saved photo and keep the controls usable.

## API contracts

All JSON responses use the existing success/error envelopes and request IDs.

| Route | Contract |
| --- | --- |
| `POST /api/v1/media?kind=avatar` | Raw WebP body with `Content-Type: image/webp`; returns 201 with `{ id, key, url, width, height, bytes }`. |
| `GET /api/v1/media/avatar` | Returns `{ media: metadata-or-null }` for the caller's current attached avatar; metadata has the upload-response shape. This supplies the deletion ID after reload without interpreting opaque storage keys in the UI. |
| `GET /api/v1/media/files/avatars/:ownerId/:filename` | Public image read for a matching active public avatar asset; returns actual WebP bytes, otherwise 404. |
| `PATCH /api/v1/auth/me` | Adds optional nullable `avatarKey` and an `expectedAvatarKey` precondition for avatar changes; returns the existing `{ user }` response. |
| `DELETE /api/v1/media/:id` | Deletes an owned avatar and clears the user's avatar pointer if it still refers to that asset; returns 204. |

Upload/delete use active-account, settled-password, and unimpersonated guards.
Current-avatar metadata permits an active, password-settled read-only support
session. Upload applies `media_upload_user` after guards and before parsing.
The existing `profile_write_user` throttle remains on profile attachment.
Expose `retry-after` to allowed CORS clients alongside the existing headers.

Raw WebP avoids multipart overhead and fits the existing 256 KiB global body
limit. Preserve that limit for every route. Reject upload bodies above 240 KiB,
empty bodies, unknown query kinds, wrong MIME declarations, and invalid bytes.
Use 413 for the byte cap, 422 for image validation, the existing guard error
codes, and 429 with `Retry-After` for throttling.

Validate the RIFF/WEBP signature, declared container and chunk lengths, and the
supported VP8/VP8L/VP8X dimension headers. Require exactly 512 x 512 dimensions,
an actual image payload, and a non-animated file. Never derive type or dimensions
from the filename or trust client metadata. This is bounded container validation;
the Worker does not run a full image decoder or transform the bytes.

Use a new ULID for every upload and keys `avatars/{userId}/{assetId}.webp`.
Store the exact validated bytes in `PUBLIC_BUCKET` with correct content metadata,
then insert the asset and its audit event in one D1 batch. If the database write
fails, attempt to delete the newly written object and log any compensation
failure with its key and request ID, excluding image bytes.

Attachment accepts only an active, public, avatar-kind asset owned by the caller.
A foreign, deleted, or unknown asset yields 404. `avatarKey: null` clears the
pointer; omission leaves it alone. Whenever `avatarKey` is supplied, require
`expectedAvatarKey` (string or null) matching the currently stored value. A
standalone precondition without an avatar change is invalid. An atomic
conditional update checks both the precondition and active asset eligibility;
conflicts return 409, and the audit records only changes that actually commit.
Ordinary identity writes keep their existing contract.

Serve only known, active public avatar rows and objects. Send `image/webp`,
`nosniff`, a content ETag, and `Cache-Control: no-store`, so removal is not hidden
by a long browser/CDN cache. Keep the existing security policy and same-site
resource policy. A missing object or inactive asset is 404, never SPA HTML.

## Save, replacement, removal, and recovery

1. Save photo encodes locally and uploads a new asset. The saved photo is untouched.
2. Attach the new key using the current saved key as the precondition. Merge the
   returned user through the existing session mechanism, preserving session-only
   fields. Unsaved identity and social drafts remain independent.
3. After attachment succeeds, delete the previous asset using its metadata ID.
   A successful replacement removes the old R2 object and asset row.
4. If attachment fails, delete the unused new asset. Keep the old saved photo and
   the crop draft available for retry. On an ambiguous network failure, re-read
   the session/current avatar before deciding which asset is unused; never
   blindly delete an asset that may now be the saved photo.
5. If attachment succeeded but old-file cleanup fails, keep the new photo, report
   that the photo was saved and cleanup needs retry, and offer Retry cleanup.
   Do not report the entire save as failed or revert a committed attachment.

Deletion first marks the owned asset `deleted` and conditionally clears a matching
avatar pointer in an audited D1 batch. This prevents concurrent attachment of an
asset being removed. Then delete the R2 object, and only afterward delete the
asset row. A storage failure retains the marked row for an idempotent retry;
it is no longer publicly served or attachable. If the pointer was cleared, the
UI refreshes the session and shows initials even when cleanup needs retry.
Deleting an already absent ID returns 204; an existing foreign asset returns
404 and is untouched. Deleting an old asset cannot clear a newer photo.

Extend the existing daily housekeeping pass to retry marked avatar deletions and
clean up active, unattached avatar assets older than 24 hours. Process at most
100 candidates per run. Before marking an active candidate, atomically recheck
that it is still unattached. This recovers interrupted browser saves and failed
cleanup across reloads without a separate job system. Each cleanup uses the
same mark/object-delete/row-delete order and records system audit events.

R2 and D1 cannot participate in one atomic transaction. Compensation and tracked
cleanup handle normal partial failures; a simultaneous object-write/database/
compensation outage can leave a storage object requiring operational recovery.
Do not claim guaranteed rollback across those services.

## Error handling and verification

Show inline errors for local selection/encoding failures. Server errors use the
existing API error messages and retry hints. Upload progress uses a transport
that sends credentials, times out, and parses the shared error envelope; it must
send the blob's actual MIME type. A conflict reloads the saved photo and asks the
user to retry against the current state. No automatic repeated uploads on 429.

Backend verification covers valid WebP variants, malformed/truncated containers,
animation, MIME mismatch, wrong dimensions, byte caps, guards, cross-user
ownership, distinct keys for identical filenames/bytes, upload throttling,
attachment preconditions, serving, removal, deletion retry, compensation,
concurrent attach/delete behavior, and housekeeping eligibility. Clear test R2
objects as well as database rows; media is already listed in `VOLATILE_TABLES`.

Browser verification covers select/cancel without upload, mouse/touch/keyboard
crop and zoom, exact exported dimensions and bounded size, upload progress,
real save/reload/replace/remove, initials fallback, invalid inputs, save/cleanup
failures, a changed-photo conflict, guarded sessions, and preservation of unsaved
identity edits. Inspect narrow mobile and desktop layouts with no overflow,
correct dialog focus, and no JavaScript errors. Run workspace typecheck, build,
the API tests, and diff whitespace checks before claiming completion.
