-- Convert each previous saved position to an independent slot. Future captures
-- use random IDs; there is no uniqueness rule for album/playlist/episode IDs.
CREATE TABLE saved_bookmarks (
  account_id TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  context_type TEXT NOT NULL CHECK (context_type IN ('album','playlist','episode')),
  context_id TEXT NOT NULL CHECK (length(context_id) = 22),
  context_uri TEXT NOT NULL,
  context_name TEXT NOT NULL,
  image_url TEXT,
  creator_name TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_uri TEXT NOT NULL,
  item_name TEXT NOT NULL,
  disc_number INTEGER,
  track_number INTEGER,
  progress_ms INTEGER NOT NULL CHECK (progress_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, bookmark_id)
);
CREATE INDEX saved_bookmarks_created ON saved_bookmarks(account_id, created_at DESC, bookmark_id);

INSERT INTO saved_bookmarks (
  account_id,bookmark_id,label,context_type,context_id,context_uri,context_name,image_url,
  creator_name,item_id,item_uri,item_name,disc_number,track_number,progress_ms,duration_ms,created_at,updated_at
)
SELECT account_id,bookmark_id,'',context_type,context_id,context_uri,context_name,image_url,
  creator_name,item_id,item_uri,item_name,disc_number,track_number,progress_ms,duration_ms,updated_at,updated_at
FROM listening_bookmarks;
