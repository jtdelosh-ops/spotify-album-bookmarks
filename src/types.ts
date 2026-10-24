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
  account_id: string; bookmark_id: string;
  context_type: 'album' | 'playlist' | 'episode'; context_id: string; context_uri: string; context_name: string;
  image_url: string | null; creator_name: string; item_id: string; item_uri: string; item_name: string;
  disc_number: number | null; track_number: number | null;
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
