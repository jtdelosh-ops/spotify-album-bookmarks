PRAGMA foreign_keys = ON;

CREATE TABLE owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  account_id TEXT NOT NULL UNIQUE
);

CREATE TABLE spotify_credentials (
  account_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  refresh_encrypted TEXT NOT NULL,
  access_encrypted TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  scopes TEXT NOT NULL,
  authorized_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  refresh_lock TEXT,
  lock_expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE shortcut_credentials (
  credential_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE bookmarks (
  account_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  album_name TEXT NOT NULL,
  album_uri TEXT NOT NULL,
  album_art_url TEXT,
  artist_name TEXT NOT NULL,
  track_id TEXT NOT NULL,
  track_uri TEXT NOT NULL,
  track_name TEXT NOT NULL,
  disc_number INTEGER NOT NULL,
  track_number INTEGER NOT NULL,
  progress_ms INTEGER NOT NULL CHECK (progress_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, album_id)
);
CREATE INDEX bookmarks_updated ON bookmarks(account_id, updated_at DESC);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
