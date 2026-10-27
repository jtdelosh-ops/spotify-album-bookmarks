-- Temporary, browser-session-bound previews. Bookmarks change only on confirmation.
CREATE TABLE update_captures (
  capture_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  base_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','ready','failed','cancelled','confirmed')),
  capture_encrypted TEXT,
  error_code TEXT,
  error_message TEXT,
  confirmation_nonce TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX update_captures_expiry ON update_captures(expires_at);
