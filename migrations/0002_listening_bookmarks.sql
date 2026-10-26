-- Keep the original album table intact for recovery. New saves use this table.
CREATE TABLE listening_bookmarks (
  account_id TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
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
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, bookmark_id),
  CHECK (bookmark_id = context_type || '_' || context_id)
);
CREATE INDEX listening_bookmarks_updated ON listening_bookmarks(account_id, updated_at DESC, bookmark_id);

INSERT INTO listening_bookmarks (
  account_id,bookmark_id,context_type,context_id,context_uri,context_name,image_url,
  creator_name,item_id,item_uri,item_name,disc_number,track_number,progress_ms,duration_ms,updated_at
)
SELECT account_id,'album_' || album_id,'album',album_id,album_uri,album_name,album_art_url,
  artist_name,track_id,track_uri,track_name,disc_number,track_number,progress_ms,duration_ms,updated_at
FROM bookmarks;
