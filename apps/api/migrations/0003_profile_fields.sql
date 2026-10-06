-- ============================================================================
-- OneLink — 0003_profile_fields.sql
--
-- Additive only. R1.2 completes the identity a public page renders. 0001 modelled
-- the two halves of a user that already existed (`display_name`, `bio`); this file
-- adds the two single-line fields that were missing and the one-to-many half:
--
--   * identity  users.location / users.pronouns
--   * socials   user_social_links — one row per platform, ordered and addressable
--
-- Why each piece lives where it does:
--
--   * `location` and `pronouns` are columns rather than part of a JSON blob,
--     because both render inline beside the display name and neither grows the
--     way a list does. They add to `users` exactly the way 0002's `pages.layout`
--     added to `pages`: two nullable TEXTs with no default, so existing rows keep
--     reading as "unset" instead of acquiring an invented value.
--   * Socials are a table, not a JSON column on `users` — the question **D9**
--     settled. A JSON list cannot be reordered or edited without rewriting all of
--     it, cannot be addressed by id (so a foreign id could not be answered with a
--     404), and cannot carry a UNIQUE constraint on the slot. Because of that,
--     0003 touches `users` with two ADD COLUMNs and nothing else.
--
-- Two notes, both inherited from 0002:
--
--   * SQLite cannot add a CHECK to an existing table, and `platform` is an
--     enumeration arriving with a migration, so it is enforced by
--     `validation/profile.schema.ts` (which is what turns an unknown platform into
--     a 422) and re-checked by `services/profile.service.ts`. The list itself is
--     `SOCIAL_PLATFORMS` in `lib/constants.ts` — code, not a seeded setting,
--     because it is a rendering contract (a name and an icon shipped in
--     `apps/web`) rather than policy an owner tunes.
--   * Every NOT NULL column carries a default; `location` and `pronouns` are
--     nullable, so no row in `users` can abort the migration.
--
-- Deliberately no `deleted_at`. A page and a link are soft-deleted because
-- moderation history and inbound URLs outlive them; a social row has neither, and
-- nothing references it. Removing one is a hard DELETE, and the audit entry — which
-- carries the platform and URL it held — is what survives. That is also why the
-- UNIQUE constraint below is safe: the slot is freed the moment the row is gone.
--
-- Rollback (stated, not discovered): `DROP TABLE user_social_links`, then
-- `ALTER TABLE users DROP COLUMN pronouns` and `... DROP COLUMN location`. Dropping
-- the table discards the social rows, so a rollback after R1.2 has been used is
-- lossy by definition. The forward-only alternative is to leave the schema and stop
-- reading it, which is safe because nothing in the API depends on these columns
-- being absent.
-- ============================================================================

ALTER TABLE users ADD COLUMN location TEXT;
ALTER TABLE users ADD COLUMN pronouns TEXT;

CREATE TABLE user_social_links (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  platform   TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- One row per slot, which is what makes a reorder total rather than ambiguous —
-- and, because `user_id` leads, also the index the read path uses ("this user's
-- socials, in order"). The service reorders in two phases (negate every position,
-- then assign the new ones) precisely because this index is checked per statement,
-- not at commit time.
CREATE UNIQUE INDEX idx_socials_user_position ON user_social_links(user_id, position);
