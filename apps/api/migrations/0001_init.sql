-- ============================================================================
-- OneLink — 0001_init.sql
-- Single-tenant platform schema.
--
-- Conventions (locked):
--   * Primary keys ......... TEXT ULID (uppercase Crockford Base32), Worker-generated
--   * Timestamps ........... INTEGER epoch-ms, written by the Worker (never by SQLite)
--                            + a VIRTUAL ISO-8601 companion for read convenience
--   * Deletes .............. soft delete (deleted_at) + app-level cascade in db.batch()
--   * Ownership FKs ........ ON DELETE RESTRICT  (tripwire: never destroy content w/ history)
--   * History FKs .......... ON DELETE SET NULL + a denormalized `*_label` snapshot
--                            (so a GDPR purge never erases the moderation record)
--   * Tables are STRICT: a value of the wrong storage class is an error, not
--     a silent coercion. This is what makes "epoch-ms INTEGER" trustworthy.
--
-- D1 notes:
--   * Foreign keys are ENFORCED by default. Ordering inside db.batch() matters.
--   * Only migration 0001 must exist for `readD1Migrations` in tests;
--     seed data lives in ../seed/ and is applied explicitly.
-- ============================================================================

-- ============================================================================
-- IDENTITY
-- ============================================================================

CREATE TABLE users (
  id                      TEXT    PRIMARY KEY,
  email                   TEXT    NOT NULL,
  email_original          TEXT,
  email_verified          INTEGER NOT NULL DEFAULT 0,
  email_verified_at       INTEGER,
  username                TEXT    NOT NULL,
  display_name            TEXT,
  bio                     TEXT,
  avatar_key              TEXT,
  password_hash           TEXT,
  password_changed_at     INTEGER,
  require_password_change INTEGER NOT NULL DEFAULT 0,
  role                    TEXT    NOT NULL DEFAULT 'user',
  status                  TEXT    NOT NULL DEFAULT 'active',
  status_reason           TEXT,
  status_changed_at       INTEGER,
  suspended_until         INTEGER,
  suspended_permanently   INTEGER NOT NULL DEFAULT 0,
  last_login_at           INTEGER,
  last_login_ip           TEXT,
  login_count             INTEGER NOT NULL DEFAULT 0,
  failed_login_count      INTEGER NOT NULL DEFAULT 0,
  locked_until            INTEGER,
  created_at              INTEGER NOT NULL,
  created_at_iso          TEXT GENERATED ALWAYS AS
                            (strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch')) VIRTUAL,
  updated_at              INTEGER NOT NULL,
  deleted_at              INTEGER,
  deleted_by              TEXT,
  CHECK (role IN ('owner', 'admin', 'moderator', 'support', 'user')),
  CHECK (status IN ('active', 'pending', 'suspended', 'banned', 'deleted')),
  -- `deleted_at` and `status = 'deleted'` must always agree. Catches drift.
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  -- A suspension must always carry either an expiry or an explicit "permanent".
  CHECK ((status = 'suspended') = (suspended_until IS NOT NULL OR suspended_permanently = 1))
) STRICT;

CREATE UNIQUE INDEX idx_users_email    ON users(email);
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status_created  ON users(status, created_at DESC);
CREATE INDEX idx_users_created         ON users(created_at DESC);
CREATE INDEX idx_users_team            ON users(role) WHERE role != 'user';

CREATE TABLE sessions (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT    NOT NULL,
  token_prefix    TEXT,
  user_agent      TEXT,
  ip              TEXT,
  device_label    TEXT,
  -- Non-NULL => this session was minted by an admin acting as this user.
  impersonated_by TEXT    REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoked_reason  TEXT
) STRICT;

CREATE UNIQUE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id, created_at DESC);
CREATE INDEX idx_sessions_live ON sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  requested_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  requested_ip TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER
) STRICT;

CREATE INDEX idx_prt_user ON password_reset_tokens(user_id, created_at DESC);

CREATE TABLE invitations (
  id               TEXT    PRIMARY KEY,
  email            TEXT    NOT NULL,
  role             TEXT    NOT NULL DEFAULT 'user',
  token_hash       TEXT    NOT NULL UNIQUE,
  invited_by       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  invited_by_label TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  accepted_at      INTEGER,
  accepted_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       INTEGER,
  CHECK (role IN ('owner', 'admin', 'moderator', 'support', 'user'))
) STRICT;

CREATE INDEX idx_inv_email ON invitations(email) WHERE accepted_at IS NULL;

-- ============================================================================
-- PAGES
-- ============================================================================

CREATE TABLE pages (
  id                   TEXT    PRIMARY KEY,
  user_id              TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug                 TEXT    NOT NULL UNIQUE,
  title                TEXT,
  bio                  TEXT,
  theme                TEXT,
  -- Two independent axes: what the OWNER wants vs what MODERATION allows.
  status               TEXT    NOT NULL DEFAULT 'draft',
  moderation_status    TEXT    NOT NULL DEFAULT 'visible',
  visibility           TEXT    NOT NULL DEFAULT 'public',
  removed_at           INTEGER,
  removed_by           TEXT    REFERENCES users(id) ON DELETE SET NULL,
  removed_reason       TEXT,
  -- Deliberately NOT a FK: `reports` references `pages`, so a real FK here would
  -- create a cycle. The value is validated in the service layer.
  removed_report_id    TEXT,
  restored_at          INTEGER,
  restored_by          TEXT    REFERENCES users(id) ON DELETE SET NULL,
  open_report_count    INTEGER NOT NULL DEFAULT 0,
  flag_count           INTEGER NOT NULL DEFAULT 0,
  view_count           INTEGER NOT NULL DEFAULT 0,
  content_revision     INTEGER NOT NULL DEFAULT 1,
  published_at         INTEGER,
  first_published_at   INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER,
  deleted_by           TEXT,
  CHECK (status IN ('draft', 'published', 'archived')),
  CHECK (moderation_status IN ('visible', 'under_review', 'removed')),
  CHECK (visibility IN ('public', 'unlisted')),
  CHECK ((moderation_status = 'removed') = (removed_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_pages_user       ON pages(user_id, created_at DESC);
CREATE INDEX idx_pages_slug_live  ON pages(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_pages_moderation ON pages(moderation_status, created_at DESC) WHERE moderation_status != 'visible';
CREATE INDEX idx_pages_reported   ON pages(open_report_count DESC, created_at DESC) WHERE open_report_count > 0;

CREATE TABLE page_links (
  id         TEXT    PRIMARY KEY,
  page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
  position   INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  domain     TEXT,
  icon       TEXT,
  clicks     INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE INDEX idx_links_page   ON page_links(page_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_links_domain ON page_links(domain) WHERE domain IS NOT NULL;

CREATE TABLE page_revisions (
  id         TEXT    PRIMARY KEY,
  page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
  revision   INTEGER NOT NULL,
  snapshot   TEXT    NOT NULL,
  reason     TEXT    NOT NULL,
  created_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK (reason IN ('publish', 'edit', 'report', 'moderation_removal', 'moderation_restore', 'daily')),
  CHECK (json_valid(snapshot))
) STRICT;

CREATE UNIQUE INDEX idx_revisions_page ON page_revisions(page_id, revision);

-- A slug whose page was removed stays reserved so nobody can inherit the
-- removed page's inbound links and reputation.
CREATE TABLE slug_reservations (
  id          TEXT    PRIMARY KEY,
  slug        TEXT    NOT NULL,
  page_id     TEXT    REFERENCES pages(id) ON DELETE SET NULL,
  reserved_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  released_at INTEGER
) STRICT;

CREATE UNIQUE INDEX idx_slug_reserved_active ON slug_reservations(slug) WHERE released_at IS NULL;

CREATE TABLE media_assets (
  id                TEXT    PRIMARY KEY,
  owner_user_id     TEXT    REFERENCES users(id) ON DELETE SET NULL,
  page_id           TEXT    REFERENCES pages(id) ON DELETE CASCADE,
  r2_key            TEXT    NOT NULL UNIQUE,
  bucket            TEXT    NOT NULL,
  kind              TEXT    NOT NULL,
  original_filename TEXT,
  mime              TEXT    NOT NULL,
  size_bytes        INTEGER NOT NULL,
  width             INTEGER,
  height            INTEGER,
  checksum          TEXT,
  uploaded_by       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  status            TEXT    NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  CHECK (bucket IN ('public', 'private')),
  CHECK (kind IN ('avatar', 'page_image', 'report_evidence', 'appeal_evidence')),
  CHECK (status IN ('active', 'deleted'))
) STRICT;

CREATE INDEX idx_media_owner ON media_assets(owner_user_id, created_at DESC);
CREATE INDEX idx_media_page  ON media_assets(page_id) WHERE status = 'active';

-- ============================================================================
-- MODERATION
-- ============================================================================

CREATE TABLE reports (
  id                TEXT    PRIMARY KEY,
  target_type       TEXT    NOT NULL DEFAULT 'page',
  target_id         TEXT    NOT NULL,
  page_id           TEXT    REFERENCES pages(id) ON DELETE RESTRICT,
  -- Immutable JSON of the page (+links) at report time: the evidence must not
  -- change under the moderator's feet if the owner edits the page.
  target_snapshot   TEXT,
  reporter_user_id  TEXT    REFERENCES users(id) ON DELETE SET NULL,
  reporter_label    TEXT,
  reporter_email    TEXT,
  reporter_ip       TEXT,
  category          TEXT    NOT NULL,
  description       TEXT,
  evidence_key      TEXT,
  status            TEXT    NOT NULL DEFAULT 'open',
  priority          INTEGER NOT NULL DEFAULT 0,
  assigned_admin_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
  resolution_action TEXT,
  resolved_by       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_label TEXT,
  resolved_at       INTEGER,
  dedupe_key        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  CHECK (target_type IN ('page', 'link', 'user')),
  CHECK (category IN ('spam', 'abuse', 'nsfw', 'impersonation', 'copyright', 'malware', 'harassment', 'other')),
  CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed', 'duplicate')),
  CHECK (priority BETWEEN 0 AND 2),
  CHECK (target_snapshot IS NULL OR json_valid(target_snapshot))
) STRICT;

CREATE INDEX idx_reports_queue    ON reports(priority DESC, created_at) WHERE status IN ('open', 'reviewing');
CREATE INDEX idx_reports_page     ON reports(page_id, created_at DESC);
CREATE INDEX idx_reports_assignee ON reports(assigned_admin_id) WHERE status IN ('open', 'reviewing');
CREATE INDEX idx_reports_dedupe   ON reports(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE sanctions (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type            TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  category        TEXT,
  issued_by       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  issued_by_label TEXT,
  report_id       TEXT    REFERENCES reports(id) ON DELETE SET NULL,
  duration_hours  INTEGER,
  expires_at      INTEGER,
  status          TEXT    NOT NULL DEFAULT 'active',
  lifted_by       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  lifted_at       INTEGER,
  lift_reason     TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (type IN ('warn', 'suspend', 'ban', 'content_removal', 'delete')),
  CHECK (status IN ('active', 'expired', 'lifted', 'overturned'))
) STRICT;

CREATE INDEX idx_sanctions_user    ON sanctions(user_id, created_at DESC);
CREATE INDEX idx_sanctions_active  ON sanctions(user_id) WHERE status = 'active';
CREATE INDEX idx_sanctions_expires ON sanctions(expires_at) WHERE status = 'active';

CREATE TABLE report_actions (
  id             TEXT    PRIMARY KEY,
  report_id      TEXT    NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  admin_id       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  admin_label    TEXT,
  action         TEXT    NOT NULL,
  target_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
  sanction_id    TEXT    REFERENCES sanctions(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (action IN ('note', 'assign', 'warn', 'suspend', 'remove_content', 'ban', 'dismiss', 'escalate', 'restore'))
) STRICT;

CREATE INDEX idx_ractions_report ON report_actions(report_id, created_at);

CREATE TABLE content_flags (
  id            TEXT    PRIMARY KEY,
  target_type   TEXT    NOT NULL,
  target_id     TEXT    NOT NULL,
  page_id       TEXT    REFERENCES pages(id) ON DELETE SET NULL,
  source        TEXT    NOT NULL,
  rule          TEXT,
  matched_text  TEXT,
  severity      INTEGER NOT NULL DEFAULT 1,
  confidence    REAL,
  status        TEXT    NOT NULL DEFAULT 'open',
  report_id     TEXT    REFERENCES reports(id) ON DELETE SET NULL,
  reviewed_by   TEXT    REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   INTEGER,
  review_notes  TEXT,
  created_at    INTEGER NOT NULL,
  CHECK (source IN ('auto', 'user', 'admin', 'system')),
  CHECK (status IN ('open', 'cleared', 'actioned', 'escalated')),
  CHECK (severity BETWEEN 1 AND 3)
) STRICT;

CREATE INDEX idx_flags_queue ON content_flags(severity DESC, created_at) WHERE status = 'open';

CREATE TABLE appeals (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sanction_id     TEXT    NOT NULL REFERENCES sanctions(id) ON DELETE CASCADE,
  message         TEXT    NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'pending',
  reviewed_by     TEXT    REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_label TEXT,
  reviewed_at     INTEGER,
  decision        TEXT,
  decision_notes  TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CHECK (decision IS NULL OR decision IN ('uphold', 'overturn', 'reduce'))
) STRICT;

CREATE INDEX idx_appeals_queue ON appeals(status, created_at);
CREATE UNIQUE INDEX idx_appeals_attempt ON appeals(sanction_id, attempt);

-- ============================================================================
-- ADMIN / PLATFORM
-- ============================================================================

-- Append-only. Never UPDATEd, never DELETEd.
-- `actor_label` / `target_label` are denormalized snapshots so the log stays
-- readable after the referenced user is renamed or purged.
CREATE TABLE audit_logs (
  id              TEXT    PRIMARY KEY,
  actor_user_id   TEXT    REFERENCES users(id) ON DELETE SET NULL,
  actor_label     TEXT,
  actor_role      TEXT,
  impersonated_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT    NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  target_label    TEXT,
  status          TEXT    NOT NULL DEFAULT 'success',
  before          TEXT,
  after           TEXT,
  metadata        TEXT,
  ip              TEXT,
  user_agent      TEXT,
  request_id      TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (status IN ('success', 'failure', 'denied')),
  CHECK (before IS NULL OR json_valid(before)),
  CHECK (after IS NULL OR json_valid(after)),
  CHECK (metadata IS NULL OR json_valid(metadata))
) STRICT;

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_actor   ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_target  ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_action  ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE user_notes (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id    TEXT    REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT,
  body         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_notes_user ON user_notes(user_id, created_at DESC);

CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  label      TEXT,
  grp        TEXT,
  description TEXT,
  is_public  INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  CHECK (type IN ('string', 'boolean', 'number', 'json'))
) STRICT;

CREATE TABLE email_templates (
  key        TEXT    PRIMARY KEY,
  subject    TEXT    NOT NULL,
  body_text  TEXT    NOT NULL,
  body_html  TEXT,
  variables  TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  CHECK (variables IS NULL OR json_valid(variables))
) STRICT;

CREATE TABLE rate_limits (
  key            TEXT    PRIMARY KEY,
  scope          TEXT    NOT NULL,
  -- NB: cannot be called `limit` — reserved SQLite keyword.
  max_requests   INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  action         TEXT    NOT NULL DEFAULT 'block',
  enabled        INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT    REFERENCES users(id) ON DELETE SET NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (scope IN ('ip', 'user', 'global')),
  CHECK (action IN ('block', 'throttle', 'captcha'))
) STRICT;
