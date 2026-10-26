-- Existing credentials keep add-only access. Update/list access is opt-in when
-- creating a replacement credential from an authenticated browser session.
ALTER TABLE shortcut_credentials ADD COLUMN allow_updates INTEGER NOT NULL DEFAULT 0 CHECK (allow_updates IN (0,1));
