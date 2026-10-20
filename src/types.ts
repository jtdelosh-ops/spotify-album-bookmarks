export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  SPOTIFY_CLIENT_ID: string;
  ENCRYPTION_KEY: string;
  SETUP_KEY: string;
}

export type Fetch = (input: string | Request, init?: RequestInit) => Promise<Response>;
export interface Credentials {
  account_id: string; generation: string;
  refresh_encrypted: string; access_encrypted: string;
  access_expires_at: number; scopes: string;
  authorized_at: number; updated_at: number;
  refresh_lock: string | null; lock_expires_at: number;
}
export interface Session {
  token_hash: string; account_id: string; csrf_token: string; expires_at: number;
}
export interface Bookmark {
  account_id: string; album_id: string; album_name: string; album_uri: string;
  album_art_url: string | null; artist_name: string; track_id: string; track_uri: string;
  track_name: string; disc_number: number; track_number: number;
  progress_ms: number; duration_ms: number; updated_at: number;
}

export class AppError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
