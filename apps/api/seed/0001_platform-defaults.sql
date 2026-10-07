-- ============================================================================
-- OneLink — seed/platform-defaults.sql
--
-- Runtime policy defaults. Applied explicitly (NOT via `d1 migrations apply`)
-- so the migration set stays pure schema.
--
--   npm run db:seed:local      # dev
--   npm run db:seed:remote     # production
--
-- Uses INSERT OR IGNORE: re-running never clobbers an admin's edits.
-- `updated_at` uses a fixed epoch-ms for 2025-01-01T00:00:00Z so seeds are
-- reproducible; the Worker stamps real timestamps thereafter.
-- ============================================================================

-- ---------------------------------------------------------------- settings --
INSERT OR IGNORE INTO settings (key, value, type, label, grp, description, is_public, updated_at) VALUES
  ('platform.name',               'OneLink',                    'string',  'Platform name',        'platform',   'Shown in the UI, emails and page titles.', 1, 1735689600000),
  ('platform.tagline',            'All your links, one page.',  'string',  'Tagline',              'platform',   'Short marketing line.', 1, 1735689600000),
  ('platform.support_email',      'support@onelink.local',      'string',  'Support email',        'platform',   'Reply-to address for outbound mail.', 1, 1735689600000),
  ('platform.pages_base_url',     'https://onelink.local/',     'string',  'Public page base URL', 'platform',   'Prefix used when building public page links.', 1, 1735689600000),
  ('platform.registration_open',  'true',                       'boolean', 'Registration open',    'platform',   'When off, /auth/register refuses new sign-ups.', 1, 1735689600000),
  ('platform.maintenance_mode',   'false',                      'boolean', 'Maintenance mode',     'platform',   'Blocks all writes with 503. Reads still work.', 1, 1735689600000),
  ('platform.maintenance_message','We are performing scheduled maintenance. Please check back shortly.', 'string', 'Maintenance message', 'platform', 'Body returned while maintenance mode is on.', 1, 1735689600000),

  ('moderation.auto_flag_enabled',       'false', 'boolean', 'Automatic flagging',     'moderation', 'Run keyword rules against new page content.', 0, 1735689600000),
  ('moderation.require_reason',          'true',  'boolean', 'Reason required',        'moderation', 'Force a reason on every sanction.', 0, 1735689600000),
  ('moderation.report_cooldown_minutes', '0',     'number',  'Per-reporter cooldown',  'moderation', 'Minutes a reporter must wait between reports.', 0, 1735689600000),

  ('content.max_links_per_page', '50', 'number', 'Max links per page', 'content', 'Upper bound on page_links rows.', 1, 1735689600000),
  ('content.trash_retention_days', '30', 'number', 'Link trash retention (days)', 'content', 'How long soft-deleted page links remain recoverable.', 0, 1735689600000),
  -- S3 (R1.0): the console lives under /app/*, so `app` is reserved alongside
  -- the SPA's own paths. `INSERT OR IGNORE` means a database that already has
  -- this row keeps the list it has, so an operator upgrading an existing
  -- deployment runs this once:
  --   UPDATE settings
  --      SET value = json_insert(value, '$[#]', 'app')
  --    WHERE key = 'content.reserved_slugs';
  ('content.reserved_slugs',     '["admin","api","app","settings","login","logout","signup","register","dashboard","about","terms","privacy","support","help","static","assets","health","favicon.ico","robots.txt","sitemap.xml"]', 'json', 'Reserved slugs', 'content', 'Slugs nobody may claim. Mirrors DEFAULT_RESERVED_SLUGS in src/lib/constants.ts.', 1, 1735689600000),
  ('content.reserved_usernames', '["owner","admin","administrator","root","system","sysadmin","staff","support","help","moderator","security","abuse","billing","postmaster","webmaster","noreply","no-reply","mail","email","api","onelink","official","me","settings","login","logout","register","signup","dashboard","account","anonymous","guest","null","undefined"]', 'json', 'Reserved usernames', 'content', 'Usernames public sign-up may not claim. Mirrors DEFAULT_RESERVED_USERNAMES in src/lib/constants.ts.', 0, 1735689600000),

  ('appeals.max_attempts', '2',  'number', 'Max appeal attempts',  'appeals', 'Per sanction, before the door closes.', 0, 1735689600000),
  ('appeals.window_days',  '30', 'number', 'Appeal window (days)', 'appeals', 'How long after a sanction an appeal is accepted.', 0, 1735689600000),

  ('audit.retention_days',  '0',     'number', 'Audit retention (days)', 'audit', '0 keeps audit logs forever.', 0, 1735689600000),
  ('audit.export_max_rows', '50000', 'number', 'Audit export cap',       'audit', 'Maximum rows returned by a single export.', 0, 1735689600000);

-- -------------------------------------------------------- email templates --
INSERT OR IGNORE INTO email_templates (key, subject, body_text, variables, enabled, updated_at) VALUES
  ('password_reset',
   'Reset your {{platform_name}} password',
   'Hi {{display_name}},' || char(10) || char(10) ||
   'Use the link below to choose a new password. It expires in {{expires_in}}.' || char(10) ||
   'If you did not request this, you can safely ignore this email.' || char(10) || char(10) ||
   '{{reset_url}}' || char(10) || char(10) || '-- {{platform_name}}',
   '["platform_name","display_name","reset_url","expires_in"]', 1, 1735689600000),

  ('staff_invitation',
   'You have been invited to {{platform_name}}',
   'Hi,' || char(10) || char(10) ||
   '{{inviter_name}} invited you to join {{platform_name}} as {{role}}.' || char(10) || char(10) ||
   '{{invite_url}}' || char(10) || char(10) || 'This invite expires in {{expires_in}}.',
   '["platform_name","inviter_name","role","invite_url","expires_in"]', 1, 1735689600000),

  ('page_invitation',
   'You have been invited to collaborate on a {{platform_name}} page',
   'Hi,' || char(10) || char(10) ||
   '{{inviter_name}} invited you to collaborate on "{{page_name}}" as a {{role}}.' || char(10) || char(10) ||
   'Sign in to review and accept the invitation:' || char(10) || '{{invite_url}}' ||
   char(10) || char(10) || 'This invite expires in {{expires_in}}.',
   '["platform_name","inviter_name","page_name","role","invite_url","expires_in"]', 1, 1735689600000),

  ('warning_issued',
   'A warning was issued on your {{platform_name}} account',
   'Hi {{display_name}},' || char(10) || char(10) || 'Reason: {{reason}}' || char(10) || char(10) ||
   'You can appeal this decision until {{appeal_deadline}}.',
   '["platform_name","display_name","reason","appeal_deadline"]', 1, 1735689600000),

  ('account_suspended',
   'Your {{platform_name}} account is suspended',
   'Hi {{display_name}},' || char(10) || char(10) || 'Reason: {{reason}}' || char(10) ||
   'Suspension ends: {{expires_at}}',
   '["platform_name","display_name","reason","expires_at"]', 1, 1735689600000),

  ('account_banned',
   'Your {{platform_name}} account has been closed',
   'Hi {{display_name}},' || char(10) || char(10) || 'Reason: {{reason}}',
   '["platform_name","display_name","reason"]', 1, 1735689600000),

  ('appeal_received',
   'We received your appeal',
   'Hi {{display_name}},' || char(10) || char(10) ||
   'Your appeal for "{{sanction_type}}" is queued for review. We will email you when a decision is made.',
   '["platform_name","display_name","sanction_type"]', 1, 1735689600000),

  ('appeal_decided',
   'Your appeal has been reviewed',
   'Hi {{display_name}},' || char(10) || char(10) || 'Decision: {{decision}}' || char(10) || char(10) ||
   '{{decision_notes}}',
   '["platform_name","display_name","decision","decision_notes"]', 1, 1735689600000),

  ('report_received',
   'Thanks for your report',
   'We received your report about {{target_label}} and will review it shortly. Reference: {{report_id}}',
   '["platform_name","target_label","report_id"]', 1, 1735689600000);

-- ------------------------------------------------------------- rate limits --
INSERT OR IGNORE INTO rate_limits (key, scope, max_requests, window_seconds, action, enabled, updated_at) VALUES
  ('login_ip',           'ip',     20,   900,  'block',    1, 1735689600000),
  ('login_user',         'user',   10,   900,  'block',    1, 1735689600000),
  ('register_ip',        'ip',     5,    3600, 'block',    1, 1735689600000),
  ('password_reset_ip',  'ip',     5,    3600, 'block',    1, 1735689600000),
  ('pages_write_user',   'user',   120,  3600, 'block',    1, 1735689600000),
  -- R1.1: `PATCH /auth/me`. Deliberately NOT folded into `pages_write_user` —
  -- renaming yourself is not editing a page, and one budget for both would let a
  -- profile form spend the allowance an editor needs. `block`, because a profile
  -- write is a deliberate human action with nothing to degrade to.
  ('profile_write_user', 'user',   60,   3600, 'block',    1, 1735689600000),
  -- Autosave is allowed to degrade; the dedicated route turns throttle depletion into a soft 429.
  ('page_autosave_user','user',  1200,   3600, 'throttle', 1, 1735689600000),
  ('report_create_ip',   'ip',     10,   3600, 'block',    1, 1735689600000),
  ('media_upload_user',  'user',   60,   3600, 'throttle', 1, 1735689600000),
  ('api_global',         'global', 6000, 60,   'throttle', 1, 1735689600000);
