-- R2.3: daily aggregate analytics. No visitor identifiers or request metadata
-- are stored; the existing page/link counters remain the lifetime totals.
CREATE TABLE page_analytics_daily (
  page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  event_date TEXT    NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  clicks     INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (page_id, event_date)
) STRICT;

CREATE INDEX idx_page_analytics_daily_date
  ON page_analytics_daily(page_id, event_date DESC);