import { AppError, type Env, type Fetch, type Session, type Bookmark } from './types.ts';
import { hash, randomToken, encrypt, decrypt, equalSecret } from './crypto.ts';
import { SCOPES, tokenExchange, storeAuthorization, spotify, spotifyFailure, bookmarkFromPlayback, playlistMetadata, resumeBookmark } from './spotify.ts';

const minute = 60000;
const day = 86400000;
function local(env: Env): boolean { return new URL(env.APP_ORIGIN).protocol === 'http:'; }
function cookieName(env: Env, kind: string): string { return `${local(env) ? '' : '__Host-'}album_${kind}`; }
function cookie(request: Request, name: string): string {
  return (request.headers.get('Cookie') ?? '').split(';').map(p => p.trim()).find(p => p.startsWith(`${name}=`))?.slice(name.length+1) ?? '';
}
function setCookie(env: Env, kind: string, value: string, age: number): string {
  return `${cookieName(env,kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local(env) ? '' : '; Secure'}`;
}
function json(data: unknown, status = 200): Response { return Response.json(data,{status}); }
function originCheck(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== env.APP_ORIGIN) throw new AppError(403,'csrf','Open the bookmark page and try again.');
}
function config(env: Env): void {
  const url = new URL(env.APP_ORIGIN);
  if (url.origin !== env.APP_ORIGIN || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Invalid application origin');
  if (!env.SETUP_KEY || env.SETUP_KEY.length < 32 || !env.ENCRYPTION_KEY || !env.SPOTIFY_CLIENT_ID || env.SPOTIFY_CLIENT_ID.startsWith('REPLACE')) throw new Error('Incomplete configuration');
}
async function limitedText(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new AppError(413,'request_too_large','Request is too large.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
async function rate(env: Env, key: string, limit: number, interval = minute): Promise<void> {
  const now = Date.now(), slot = Math.floor(now/interval), end = (slot+1)*interval;
  const bucket = await hash(`${env.SETUP_KEY}:${key}:${slot}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits (bucket,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(bucket,end).first<{count:number}>();
  if (!row || row.count > limit) throw new AppError(429,'app_rate_limit','Too many requests. Wait before trying again.',Math.ceil((end-now)/1000));
}
async function webSession(request: Request, env: Env): Promise<Session> {
  const token = cookie(request,cookieName(env,'session'));
  const row = token ? await env.DB.prepare(`SELECT * FROM sessions WHERE token_hash=? AND expires_at>?
    AND account_id=(SELECT account_id FROM owner WHERE singleton=1)`).bind(await hash(token),Date.now()).first<Session>() : null;
  if (!row) throw new AppError(401,'sign_in','Sign in from the bookmark page.');
  if (!['GET','HEAD'].includes(request.method)) {
    originCheck(request,env);
    if (!await equalSecret(request.headers.get('X-CSRF-Token') ?? '',row.csrf_token)) throw new AppError(403,'csrf','Reload the page and try again.');
  }
  return row;
}
async function bookmarkAccount(request: Request, env: Env): Promise<string> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return (await webSession(request,env)).account_id;
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new AppError(401,'shortcut_credential','Shortcut credential is invalid. Create a new credential on the bookmark page.');
  const row = await env.DB.prepare(`SELECT account_id FROM shortcut_credentials WHERE token_hash=? AND revoked_at IS NULL
    AND account_id=(SELECT account_id FROM owner WHERE singleton=1)`).bind(await hash(authorization.slice(7))).first<{account_id:string}>();
  if (!row) throw new AppError(401,'shortcut_credential','Shortcut credential was revoked or is invalid. Create a new one on the bookmark page.');
  return row.account_id;
}

async function routes(request: Request, env: Env, fetcher: Fetch): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, now = Date.now();
  if (url.origin !== env.APP_ORIGIN) throw new AppError(400,'wrong_origin','Use the configured bookmark page address.');
  const sensitive = path.startsWith('/api/') || path.startsWith('/auth/');
  if (!sensitive) {
    if (!['GET','HEAD'].includes(request.method)) throw new AppError(405,'method','Method not allowed.');
    return env.ASSETS.fetch(request);
  }
  await rate(env,`ip:${request.headers.get('CF-Connecting-IP') ?? 'local'}`,120);
  if (path === '/auth/spotify/start' && request.method === 'POST') {
    originCheck(request,env);
    await rate(env,`login:${request.headers.get('CF-Connecting-IP') ?? 'local'}`,10,10*minute);
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw new AppError(415,'content_type','Submit the sign-in form from the bookmark page.');
    const params = new URLSearchParams(await limitedText(request));
    if (!await equalSecret(params.get('setup_key') ?? '',env.SETUP_KEY)) throw new AppError(403,'setup_key','The private setup key is incorrect.');
    const state = randomToken(), verifier = randomToken(), browser = randomToken();
    const previous = cookie(request,cookieName(env,'oauth'));
    if (previous) await env.DB.prepare('DELETE FROM oauth_states WHERE browser_hash=?').bind(await hash(previous)).run();
    await env.DB.prepare('INSERT INTO oauth_states (state_hash,browser_hash,verifier_encrypted,expires_at) VALUES (?,?,?,?)')
      .bind(await hash(state),await hash(browser),await encrypt(env,verifier,'oauth'),now+10*minute).run();
    const target = new URL('https://accounts.spotify.com/authorize');
    target.search = new URLSearchParams({client_id:env.SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:`${env.APP_ORIGIN}/auth/spotify/callback`,
      state,scope:SCOPES.join(' '),code_challenge_method:'S256',code_challenge:await hash(verifier)}).toString();
    return new Response(null,{status:303,headers:{Location:target.toString(),'Set-Cookie':setCookie(env,'oauth',browser,600)}});
  }
  if (path === '/auth/spotify/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'), browser = cookie(request,cookieName(env,'oauth'));
    if (!state || !browser) throw new AppError(400,'oauth_state','Sign-in could not be verified. Start again from the bookmark page.');
    const transaction = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier_encrypted')
      .bind(await hash(state),await hash(browser),now).first<{verifier_encrypted:string}>();
    if (!transaction) throw new AppError(400,'oauth_state','Sign-in expired or was already used. Start again from the bookmark page.');
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new AppError(400,'oauth_denied','Spotify sign-in was cancelled. Start again from the bookmark page.');
    const token = await tokenExchange(env,fetcher,{grant_type:'authorization_code',code:url.searchParams.get('code')!,
      redirect_uri:`${env.APP_ORIGIN}/auth/spotify/callback`,code_verifier:await decrypt(env,transaction.verifier_encrypted,'oauth')});
    let profileResponse: Response;
    try { profileResponse = await fetcher('https://api.spotify.com/v1/me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)}); }
    catch { throw new AppError(502,'spotify_unavailable','Spotify could not be reached. Start sign-in again.'); }
    if (!profileResponse.ok) return spotifyFailure(profileResponse);
    const profile = await profileResponse.json() as {account_id?:string};
    if (typeof profile.account_id !== 'string' || !profile.account_id || profile.account_id.length > 256) throw new AppError(502,'spotify_identity','Spotify did not return a stable account ID. Start sign-in again.');
    await env.DB.prepare('INSERT INTO owner (singleton,account_id) VALUES (1,?) ON CONFLICT(singleton) DO NOTHING').bind(profile.account_id).run();
    const owner = await env.DB.prepare('SELECT account_id FROM owner WHERE singleton=1').first<{account_id:string}>();
    if (owner?.account_id !== profile.account_id) throw new AppError(403,'wrong_account','This instance belongs to a different Spotify account. Sign in with the original account.');
    const sessionToken = randomToken(), csrf = randomToken();
    await storeAuthorization(env,profile.account_id,token,now,env.DB.prepare('INSERT INTO sessions (token_hash,account_id,csrf_token,expires_at) VALUES (?,?,?,?)')
      .bind(await hash(sessionToken),profile.account_id,csrf,now+30*day));
    const headers = new Headers({Location:'/'});
    headers.append('Set-Cookie',setCookie(env,'session',sessionToken,30*86400));
    headers.append('Set-Cookie',setCookie(env,'oauth','',0));
    return new Response(null,{status:303,headers});
  }
  if (!path.startsWith('/api/')) throw new AppError(404,'not_found','Not found.');
  if (path === '/api/bookmarks/current' && request.method === 'POST') {
    const account = await bookmarkAccount(request,env);
    await rate(env,`save:${account}`,30);
    const response = await spotify(env,fetcher,'/me/player?additional_types=track,episode');
    const data = response.status === 204 ? null : await response.json();
    const bookmark = bookmarkFromPlayback(data,account,now);
    if (bookmark.context_type === 'playlist') {
      const metadata = await playlistMetadata(env,fetcher,bookmark.context_id);
      const previous = !metadata ? await env.DB.prepare(`SELECT context_name,image_url FROM saved_bookmarks
        WHERE account_id=? AND context_type='playlist' AND context_id=? ORDER BY created_at DESC,bookmark_id LIMIT 1`)
        .bind(account,bookmark.context_id).first<{context_name:string;image_url:string|null}>() : null;
      bookmark.context_name = metadata?.name ?? previous?.context_name ?? bookmark.context_name;
      bookmark.image_url = metadata?.image ?? previous?.image_url ?? bookmark.image_url;
    }
    const columns = Object.keys(bookmark);
    await env.DB.prepare(`INSERT INTO saved_bookmarks (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .bind(...Object.values(bookmark)).run();
    const position = `${Math.floor(bookmark.progress_ms/60000)}:${String(Math.floor(bookmark.progress_ms/1000)%60).padStart(2,'0')}`;
    return json({ok:true,bookmarkId:bookmark.bookmark_id,message:`Added bookmark for ${bookmark.item_name} at ${position}.`});
  }
  // A Shortcut credential grants only the save action, even if a browser session is also sent.
  if (request.headers.has('Authorization')) throw new AppError(403,'shortcut_scope','Shortcut credentials can only bookmark the current track.');
  const session = await webSession(request,env);
  await rate(env,`web:${session.account_id}`,60);
  if (path === '/api/session' && request.method === 'GET') {
    const credentials = await env.DB.prepare('SELECT authorized_at FROM spotify_credentials WHERE account_id=?').bind(session.account_id).first<{authorized_at:number}>();
    return json({ok:true,csrf:session.csrf_token,spotifyConnected:!!credentials});
  }
  if (path === '/api/bookmarks' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM saved_bookmarks WHERE account_id=? ORDER BY created_at DESC,bookmark_id').bind(session.account_id).all<Bookmark>();
    return json({ok:true,bookmarks:result.results.map(({account_id,...bookmark}) => bookmark)});
  }
  if (path === '/api/devices' && request.method === 'GET') {
    const response = await spotify(env,fetcher,'/me/player/devices');
    const data = await response.json() as any;
    return json({ok:true,devices:(Array.isArray(data.devices) ? data.devices : [])
      .filter((d: any) => typeof d.id === 'string' && d.id && d.is_restricted !== true)
      .map((d: any) => ({id:d.id,name:typeof d.name === 'string' ? d.name : 'Spotify device',
        type:typeof d.type === 'string' ? d.type : '',isActive:d.is_active === true}))});
  }
  const bookmarkRoute = /^\/api\/bookmarks\/((?:album_|playlist_|episode_)?[A-Za-z0-9]{22}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/resume)?$/.exec(path);
  if (bookmarkRoute && ((bookmarkRoute[2] && request.method === 'POST') || (!bookmarkRoute[2] && ['DELETE','PATCH'].includes(request.method)))) {
    // Bare album IDs from older open pages remain valid for migrated album rows.
    const bookmarkId = /^[A-Za-z0-9]{22}$/.test(bookmarkRoute[1]) ? `album_${bookmarkRoute[1]}` : bookmarkRoute[1];
    const bookmark = await env.DB.prepare('SELECT * FROM saved_bookmarks WHERE account_id=? AND bookmark_id=?').bind(session.account_id,bookmarkId).first<Bookmark>();
    if (!bookmark) throw new AppError(404,'bookmark_missing','This bookmark was already deleted. Reload the list.');
    if (request.method === 'PATCH') {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new AppError(415,'content_type','Send a bookmark name as JSON.');
      let body: any;
      try { body = JSON.parse(await limitedText(request)); }
      catch (error) { if (error instanceof AppError) throw error; throw new AppError(400,'bookmark_name','Enter a bookmark name of at most 120 characters.'); }
      if (!body || typeof body.label !== 'string' || body.label.trim().length > 120) throw new AppError(400,'bookmark_name','Enter a bookmark name of at most 120 characters.');
      const renamed = await env.DB.prepare('UPDATE saved_bookmarks SET label=?,updated_at=? WHERE account_id=? AND bookmark_id=? RETURNING bookmark_id')
        .bind(body.label.trim(),now,session.account_id,bookmarkId).first();
      if (!renamed) throw new AppError(404,'bookmark_missing','This bookmark was already deleted. Reload the list.');
      return json({ok:true,message:body.label.trim() ? 'Bookmark renamed.' : 'Bookmark name cleared.'});
    }
    if (request.method === 'DELETE') {
      const migrated = bookmarkId === `${bookmark.context_type}_${bookmark.context_id}`;
      await env.DB.batch([
        env.DB.prepare('DELETE FROM saved_bookmarks WHERE account_id=? AND bookmark_id=?').bind(session.account_id,bookmarkId),
        ...(migrated ? [env.DB.prepare('DELETE FROM listening_bookmarks WHERE account_id=? AND bookmark_id=?').bind(session.account_id,bookmarkId)] : []),
        ...(migrated && bookmark.context_type === 'album' ? [env.DB.prepare('DELETE FROM bookmarks WHERE account_id=? AND album_id=?').bind(session.account_id,bookmark.context_id)] : [])
      ]);
      return json({ok:true,message:'Bookmark deleted.'});
    }
    await rate(env,`resume:${session.account_id}`,15);
    const text = await limitedText(request);
    let selected: string | undefined;
    if (text) {
      let body: any;
      try { body = JSON.parse(text); } catch { throw new AppError(400,'device_request','Choose a Spotify device and try again.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.deviceId !== 'string' || !body.deviceId || body.deviceId.length > 256)
        throw new AppError(400,'device_request','Choose a Spotify device and try again.');
      selected = body.deviceId;
    }
    let device: any;
    if (selected) {
      const response = await spotify(env,fetcher,'/me/player/devices');
      const data = await response.json() as any;
      device = Array.isArray(data.devices) ? data.devices.find((d: any) => d.id === selected) : undefined;
      if (!device) throw new AppError(409,'device_unavailable','That device is no longer available. Refresh devices and choose again.');
    } else {
      const playback = await spotify(env,fetcher,'/me/player');
      const state = playback.status === 204 ? null : await playback.json() as any;
      device = state?.device;
      if (!device?.id || device.is_active !== true) throw new AppError(409,'no_device','Spotify reports no active player. Refresh devices, choose where to play, then tap Resume again.');
    }
    if (device.is_restricted) throw new AppError(403,'restricted_device','This Spotify device cannot be controlled. Choose another device in Spotify.');
    await resumeBookmark(env,fetcher,bookmark,device.id);
    return json({ok:true,message:`${bookmark.context_type === 'episode' ? 'Playback confirmed' : 'Resume requested'} on ${typeof device.name === 'string' ? device.name : 'your Spotify device'}.`});
  }
  if (path === '/api/shortcut-credentials') {
    if (request.method === 'GET') {
      const result = await env.DB.prepare('SELECT credential_id,created_at FROM shortcut_credentials WHERE account_id=? AND revoked_at IS NULL').bind(session.account_id).all();
      return json({ok:true,credentials:result.results});
    }
    if (request.method === 'POST') {
      const credential = randomToken(), credentialId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare('UPDATE shortcut_credentials SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL').bind(now,session.account_id),
        env.DB.prepare('INSERT INTO shortcut_credentials (credential_id,token_hash,account_id,created_at) VALUES (?,?,?,?)').bind(credentialId,await hash(credential),session.account_id,now)
      ]);
      return json({ok:true,credential,credentialId,message:'Copy this credential now. Creating it revoked all previous Shortcut credentials.'},201);
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('UPDATE shortcut_credentials SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL').bind(now,session.account_id).run();
      return json({ok:true,message:'All Shortcut credentials revoked.'});
    }
  }
  if (path === '/api/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.token_hash).run();
    return new Response(JSON.stringify({ok:true,message:'Signed out.'}),{headers:{'Content-Type':'application/json','Set-Cookie':setCookie(env,'session','',0)}});
  }
  if (path === '/api/disconnect' && request.method === 'POST') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM spotify_credentials WHERE account_id=?').bind(session.account_id),
      env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(session.account_id),
      env.DB.prepare('UPDATE shortcut_credentials SET revoked_at=? WHERE account_id=?').bind(now,session.account_id)
    ]);
    return new Response(JSON.stringify({ok:true,message:'Spotify credentials and sessions removed. Bookmarks are retained.'}),{headers:{'Content-Type':'application/json','Set-Cookie':setCookie(env,'session','',0)}});
  }
  throw new AppError(404,'not_found','Not found.');
}

function harden(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://i.scdn.co; connect-src 'self'; form-action 'self' https://accounts.spotify.com; base-uri 'none'; frame-ancestors 'none'");
  headers.set('X-Request-ID',requestId);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function createApp(fetcher: Fetch = fetch) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId = crypto.randomUUID();
      try { config(env); return harden(await routes(request,env,fetcher),requestId); }
      catch (error) {
        const known = error instanceof AppError;
        if (!known) console.error(JSON.stringify({event:'request_failed',request_id:requestId}));
        // Shortcuts can stop on non-2xx responses before reaching Show Notification.
        // Opt-in envelopes preserve the error in JSON while allowing that action to run.
        const httpStatus = known ? error.status : 500;
        const notification = request.method === 'POST' && new URL(request.url).pathname === '/api/bookmarks/current'
          && request.headers.get('X-Shortcut-Response') === 'notification';
        const response = json({ok:false,code:known ? error.code : 'server_error',message:known ? error.message : 'The service is not ready. Check configuration or try again.',httpStatus,requestId},notification ? 200 : httpStatus);
        if (known && error.retryAfter) response.headers.set('Retry-After',String(error.retryAfter));
        return harden(response,requestId);
      }
    },
    async scheduled(_event: unknown, env: Env): Promise<void> {
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(now),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now),
        env.DB.prepare('DELETE FROM shortcut_credentials WHERE revoked_at IS NOT NULL AND revoked_at<?').bind(now-30*day)
      ]);
    }
  };
}
export default createApp();
