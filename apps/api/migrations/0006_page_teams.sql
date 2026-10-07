-- R2.1: page-scoped collaboration. The page owner remains the authority on
-- pages.user_id; collaborators are separate rows with deliberately weaker roles.
CREATE TABLE page_members (
  id         TEXT    PRIMARY KEY,
  page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role       TEXT    NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (page_id, user_id)
) STRICT;

CREATE INDEX idx_page_members_user ON page_members(user_id, page_id);

CREATE TABLE page_invitations (
  id                  TEXT    PRIMARY KEY,
  page_id             TEXT    NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
  email               TEXT    NOT NULL,
  role                TEXT    NOT NULL CHECK (role IN ('viewer', 'editor')),
  invited_by          TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  accepted_at         INTEGER,
  accepted_by_user_id TEXT    REFERENCES users(id) ON DELETE SET NULL,
  revoked_at          INTEGER,
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
) STRICT;

CREATE UNIQUE INDEX idx_page_invitations_pending
  ON page_invitations(page_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_page_invitations_email
  ON page_invitations(email, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
