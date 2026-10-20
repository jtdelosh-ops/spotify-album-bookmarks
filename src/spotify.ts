import { AppError, type Env, type Fetch, type Credentials, type Bookmark } from './types.ts';
import { decrypt, encrypt, randomToken } from './crypto.ts';

export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; error?: string };

async function call(fetcher: Fetch, url: string, init: RequestInit): Promise<Response> {
  try { return await fetcher(url, {...init, signal:AbortSignal.timeout(10000)}); }
  catch { throw new AppError(502, 'spotify_unavailable', 'Spotify could not be reached. Try again shortly.'); }
}
async function json(response: Response): Promise<any> {
  try { return await response.json(); }
  catch { throw new AppError(502, 'spotify_response', 'Spotify returned an unreadable response. Try again.'); }
}
export async function spotifyFailure(response: Response): Promise<never> {
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as any;
    const value = response.headers.get('Retry-After');
    const seconds = value && /^\d+$/.test(value) ? Math.max(1, Number(value)) : undefined;
    const quota = body?.error?.reason === 'QUOTA_EXCEEDED';
    throw new AppError(429, quota ? 'spotify_quota' : 'spotify_rate_limit', quota
      ? 'Spotify development quota is exhausted. Try later; repeated attempts will not help.'
      : `Spotify is busy. ${seconds ? `Wait ${seconds} seconds before trying again.` : 'Try again later.'}`, seconds);
  }
  if (response.status === 401) throw new AppError(401, 'spotify_reconnect', 'Reconnect Spotify from the bookmark page.');
  if (response.status === 403) throw new AppError(403, 'spotify_forbidden', 'Spotify refused access. Check Premium, app allowlist, permissions, and device restrictions.');
  if (response.status === 404) throw new AppError(409, 'no_device', 'Open Spotify and play something on the device you want to use, then try again.');
  throw new AppError(502, 'spotify_error', 'Spotify could not complete this request. Try again or open Spotify to check playback.');
}
export async function tokenExchange(env: Env, fetcher: Fetch, params: Record<string,string>): Promise<TokenResponse> {
  const response = await call(fetcher, 'https://accounts.spotify.com/api/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({...params, client_id:env.SPOTIFY_CLIENT_ID})
  });
  if (!response.ok) {
    if (response.status === 400) {
      const data = await json(response);
      if (data.error === 'invalid_grant') throw new AppError(401, 'invalid_grant', 'Spotify authorization expired or was revoked. Reconnect Spotify.');
      throw new AppError(400, 'oauth_exchange', 'Spotify could not authorize this sign-in. Start sign-in again.');
    }
    return spotifyFailure(response);
  }
  const data = await json(response) as TokenResponse;
  if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in < 1)
    throw new AppError(502, 'spotify_response', 'Spotify returned incomplete credentials. Reconnect Spotify.');
  return data;
}
export function requireScopes(scopes: string): void {
  if (!SCOPES.every(scope => scopes.split(' ').includes(scope)))
    throw new AppError(403, 'spotify_scopes', 'Both playback permissions are required. Sign in again and approve them.');
}
export async function storeAuthorization(env: Env, account: string, token: TokenResponse, now: number, session: D1PreparedStatement): Promise<void> {
  if (!token.refresh_token) throw new AppError(502, 'spotify_response', 'Spotify did not provide a refresh token. Sign in again.');
  requireScopes(token.scope ?? '');
  const refresh = await encrypt(env, token.refresh_token, `${account}:refresh`);
  const access = await encrypt(env, token.access_token, `${account}:access`);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO spotify_credentials (account_id,generation,refresh_encrypted,access_encrypted,access_expires_at,scopes,authorized_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET generation=excluded.generation,
      refresh_encrypted=excluded.refresh_encrypted,access_encrypted=excluded.access_encrypted,
      access_expires_at=excluded.access_expires_at,scopes=excluded.scopes,authorized_at=excluded.authorized_at,
      updated_at=excluded.updated_at,refresh_lock=NULL,lock_expires_at=0`)
      .bind(account,randomToken(),refresh,access,now + token.expires_in*1000,token.scope!,now,now),
    env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(account), session
  ]);
}

async function accessToken(env: Env, fetcher: Fetch, rejectedToken?: string): Promise<string> {
  const account = (await env.DB.prepare('SELECT account_id FROM owner WHERE singleton=1').first<{account_id:string}>())?.account_id;
  let row = account ? await env.DB.prepare('SELECT * FROM spotify_credentials WHERE account_id=?').bind(account).first<Credentials>() : null;
  if (!row || !account) throw new AppError(401, 'spotify_reconnect', 'Reconnect Spotify from the bookmark page.');
  const cached = async (c: Credentials): Promise<string | null> => {
    if (c.access_expires_at <= Date.now()+60000) return null;
    const token = await decrypt(env,c.access_encrypted,`${account}:access`);
    return token !== rejectedToken ? token : null;
  };
  const hit = await cached(row);
  if (hit) return hit;
  const lease = randomToken();
  const locked = await env.DB.prepare(`UPDATE spotify_credentials SET refresh_lock=?,lock_expires_at=?
    WHERE account_id=? AND generation=? AND lock_expires_at < ? RETURNING *`)
    .bind(lease,Date.now()+30000,account,row.generation,Date.now()).first<Credentials>();
  if (!locked) throw new AppError(409, 'spotify_busy', 'Spotify credentials are being updated. Try again in a moment.', 2);
  row = locked;
  try {
    const secondHit = await cached(row);
    if (secondHit) return secondHit;
    const refreshToken = await decrypt(env,row.refresh_encrypted,`${account}:refresh`);
    let token: TokenResponse;
    try { token = await tokenExchange(env,fetcher,{grant_type:'refresh_token',refresh_token:refreshToken}); }
    catch (error) {
      if (error instanceof AppError && error.code === 'invalid_grant') {
        await env.DB.prepare('DELETE FROM spotify_credentials WHERE account_id=? AND generation=? AND refresh_lock=?')
          .bind(account,row.generation,lease).run();
      }
      throw error;
    }
    const scopes = token.scope ?? row.scopes;
    requireScopes(scopes);
    const refresh = await encrypt(env,token.refresh_token ?? refreshToken,`${account}:refresh`);
    const access = await encrypt(env,token.access_token,`${account}:access`);
    const updated = await env.DB.prepare(`UPDATE spotify_credentials SET refresh_encrypted=?,access_encrypted=?,access_expires_at=?,scopes=?,updated_at=?
      WHERE account_id=? AND generation=? AND refresh_lock=? RETURNING account_id`)
      .bind(refresh,access,Date.now()+token.expires_in*1000,scopes,Date.now(),account,row.generation,lease).first();
    if (!updated) throw new AppError(409, 'spotify_busy', 'Spotify authorization changed. Try again.');
    return token.access_token;
  } finally {
    await env.DB.prepare('UPDATE spotify_credentials SET refresh_lock=NULL,lock_expires_at=0 WHERE account_id=? AND generation=? AND refresh_lock=?')
      .bind(account,row.generation,lease).run();
  }
}
export async function spotify(env: Env, fetcher: Fetch, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await accessToken(env,fetcher);
  const request = () => call(fetcher,`https://api.spotify.com/v1${path}`,{
    ...init, headers:{...init.headers, Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}
  });
  let response = await request();
  if (response.status === 401) { token = await accessToken(env,fetcher,token); response = await request(); }
  if (!response.ok) return spotifyFailure(response);
  return response;
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{22}$/.test(value);
export function bookmarkFromPlayback(data: any, account: string, now: number): Bookmark {
  if (!data || data.is_playing !== true) throw new AppError(409, 'nothing_playing', 'Play a music track in Spotify, then bookmark it. Paused tracks are not saved.');
  const track = data.item, album = track?.album;
  if (data.currently_playing_type !== 'track' || track?.type !== 'track' || track.is_local || !id(track.id) || !id(album?.id))
    throw new AppError(422, 'unsupported_item', 'Only Spotify music tracks with an album can be bookmarked. Local files, ads, episodes, and audiobooks are not supported.');
  if (!Number.isInteger(data.progress_ms) || data.progress_ms < 0 || !Number.isInteger(track.duration_ms) || track.duration_ms <= 0)
    throw new AppError(409, 'missing_position', 'Spotify did not provide a usable playback position. Try again.');
  if (typeof track.name !== 'string' || typeof album.name !== 'string') throw new AppError(502, 'spotify_response', 'Spotify returned incomplete track information. Try again.');
  const image = album.images?.find((i: any) => typeof i?.url === 'string' && /^https:\/\/i\.scdn\.co\//.test(i.url))?.url ?? null;
  return {
    account_id:account,album_id:album.id,album_name:album.name,album_uri:`spotify:album:${album.id}`,
    album_art_url:image,artist_name:(track.artists ?? []).map((a: any) => typeof a.name === 'string' ? a.name : '').filter(Boolean).join(', '),
    track_id:track.id,track_uri:`spotify:track:${track.id}`,track_name:track.name,
    disc_number:Number.isInteger(track.disc_number) ? track.disc_number : 1,
    track_number:Number.isInteger(track.track_number) ? track.track_number : 1,
    progress_ms:Math.min(data.progress_ms,track.duration_ms-1),duration_ms:track.duration_ms,updated_at:now
  };
}
export function resumeBody(bookmark: Bookmark): object {
  return {context_uri:bookmark.album_uri,offset:{uri:bookmark.track_uri},position_ms:bookmark.progress_ms};
}
