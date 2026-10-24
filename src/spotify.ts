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
export function spotifyImage(images: any): string | null {
  return Array.isArray(images) ? images.find((i: any) => typeof i?.url === 'string' && /^https:\/\/i\.scdn\.co\//.test(i.url))?.url ?? null : null;
}
// Display metadata is optional: private/unavailable playlists can still be saved
// from their playback context without requesting additional Spotify permissions.
export async function playlistMetadata(env: Env, fetcher: Fetch, playlistId: string): Promise<{name:string;image:string|null} | null> {
  try {
    const response = await spotify(env,fetcher,`/playlists/${playlistId}?fields=name,images`);
    const data = await response.json() as any;
    return data && typeof data.name === 'string' && data.name ? {name:data.name,image:spotifyImage(data.images)} : null;
  } catch (error) {
    if (error instanceof AppError) return null;
    // A malformed metadata response must not discard an otherwise valid position.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
export function bookmarkFromPlayback(data: any, account: string, now: number): Bookmark {
  if (!data || typeof data.is_playing !== 'boolean') throw new AppError(409, 'nothing_playing', 'Open a track or podcast episode in Spotify, playing or paused, then bookmark it. Spotify is not reporting a playback position.');
  const item = data.item;
  const episode = data.currently_playing_type === 'episode' && item?.type === 'episode';
  const track = data.currently_playing_type === 'track' && item?.type === 'track';
  if ((!episode && !track) || item?.is_local || !id(item?.id) || (episode && item?.show?.type === 'audiobook'))
    throw new AppError(422, 'unsupported_item', 'Save a Spotify music track or podcast episode. Local files, ads, and audiobook chapters are not supported.');
  if (!Number.isInteger(data.progress_ms) || data.progress_ms < 0 || !Number.isInteger(item.duration_ms) || item.duration_ms <= 0)
    throw new AppError(409, 'missing_position', 'Spotify did not provide a usable playback position. Try again.');
  if (typeof item.name !== 'string' || !item.name) throw new AppError(502, 'spotify_response', 'Spotify returned incomplete item information. Try again.');
  let kind: Bookmark['context_type'], contextId: string, contextName: string, creator: string, image: string | null;
  if (episode) {
    kind = 'episode'; contextId = item.id; contextName = item.name;
    creator = typeof item.show?.name === 'string' ? item.show.name : 'Podcast';
    image = spotifyImage(item.images) ?? spotifyImage(item.show?.images);
  } else {
    const album = item.album;
    if (!id(album?.id) || typeof album.name !== 'string' || !album.name) throw new AppError(502, 'spotify_response', 'Spotify returned incomplete album information. Try again.');
    const playlist = data.context?.type === 'playlist';
    const playlistId = playlist ? /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(data.context?.uri ?? '')?.[1] : undefined;
    if (playlist && !playlistId) throw new AppError(409, 'missing_context', 'Spotify did not identify this playlist. Open it in Spotify and try again.');
    kind = playlist ? 'playlist' : 'album'; contextId = playlistId ?? album.id;
    contextName = playlist ? `Playlist ${contextId.slice(-6)}` : album.name;
    creator = Array.isArray(item.artists) ? item.artists.map((a: any) => typeof a?.name === 'string' ? a.name : '').filter(Boolean).join(', ') : '';
    image = spotifyImage(album.images);
  }
  return {
    account_id:account,bookmark_id:crypto.randomUUID(),label:'',context_type:kind,context_id:contextId,
    context_uri:`spotify:${kind}:${contextId}`,context_name:contextName,image_url:image,creator_name:creator,
    item_id:item.id,item_uri:`spotify:${episode ? 'episode' : 'track'}:${item.id}`,item_name:item.name,
    disc_number:track && Number.isInteger(item.disc_number) ? item.disc_number : null,
    track_number:track && Number.isInteger(item.track_number) ? item.track_number : null,
    progress_ms:Math.min(data.progress_ms,item.duration_ms-1),duration_ms:item.duration_ms,created_at:now,updated_at:now
  };
}
export function resumeBody(bookmark: Bookmark): object {
  return bookmark.context_type === 'episode'
    ? {uris:[bookmark.item_uri],position_ms:bookmark.progress_ms}
    : {context_uri:bookmark.context_uri,offset:{uri:bookmark.item_uri},position_ms:bookmark.progress_ms};
}
