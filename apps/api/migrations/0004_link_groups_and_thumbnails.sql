-- R1.5: page link groups and image metadata.
-- Existing links remain ungrouped with no thumbnail and open in the current tab.
CREATE TABLE link_groups (
  id         TEXT    PRIMARY KEY,
  page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_link_groups_page_position ON link_groups(page_id, position);

ALTER TABLE page_links ADD COLUMN group_id TEXT REFERENCES link_groups(id);
ALTER TABLE page_links ADD COLUMN open_in_new_tab INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_links ADD COLUMN thumbnail_key TEXT;
