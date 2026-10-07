-- R1.6: isolate editor autosaves from the currently published page state.
CREATE TABLE page_drafts (
  id         TEXT    PRIMARY KEY,
  page_id    TEXT    NOT NULL UNIQUE REFERENCES pages(id) ON DELETE RESTRICT,
  content    TEXT    NOT NULL CHECK (json_valid(content)),
  updated_by TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_page_drafts_updated ON page_drafts(updated_at);
