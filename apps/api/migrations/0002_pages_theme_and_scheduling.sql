-- ============================================================================
-- OneLink — 0002_pages_theme_and_scheduling.sql
--
-- Additive only. 0001_init.sql already models the *moderation* half of a page
-- (status, moderation_status, visibility, published_at, content_revision) and
-- the *identity* half of a link (title, url, domain, icon, position), and this
-- file adds exactly the things an owner-facing page API needs that 0001 had no
-- column for:
--
--   * presentation  pages.layout / pages.accent_color / pages.show_branding
--   * long text     page_links.description
--   * scheduling    page_links.starts_at / page_links.ends_at
--
-- Anything 0001 already had a column for keeps that column's name, and the API
-- follows the database rather than the other way round: link text is `title`
-- (not a new `label`), a link's icon is `icon` (not a new `icon_key`), publish
-- state is `pages.status` (not a new `is_published`), and the publish moment is
-- the existing `published_at` / `first_published_at`. Renaming existing columns
-- would have rewritten moderation code that already reads them, for no gain.
--
-- Two notes on ALTER TABLE:
--   * SQLite cannot add a CHECK to an existing table, so the enumerations here
--     (`layout`, and "the window ends after it starts") are enforced by the zod
--     schema and re-checked in the service.
--   * Every NOT NULL column carries a default so the rows already in the table
--     receive a usable value rather than aborting the migration.
-- ============================================================================

ALTER TABLE pages ADD COLUMN layout        TEXT    NOT NULL DEFAULT 'list';
ALTER TABLE pages ADD COLUMN accent_color  TEXT;
ALTER TABLE pages ADD COLUMN show_branding INTEGER NOT NULL DEFAULT 1;

ALTER TABLE page_links ADD COLUMN description TEXT;
ALTER TABLE page_links ADD COLUMN starts_at   INTEGER;
ALTER TABLE page_links ADD COLUMN ends_at     INTEGER;
