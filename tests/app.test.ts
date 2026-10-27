import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/index.ts';
import { decrypt, hash } from '../src/crypto.ts';
import { bookmarkFromPlayback, resumeBody, SCOPES } from '../src/spotify.ts';

const origin = 'https://albums.example.test';
const account = 'immutable-account';
const album = 'a'.repeat(22), track = 't'.repeat(22);
const playback = () => ({is_playing:true,currently_playing_type:'track',progress_ms:123456,
  device:{id:'active-device',is_active:true,is_restricted:false,name:'iPhone'},
  item:{type:'track',id:track,name:'Movement II',duration_ms:900000,disc_number:2,track_number:1,
    artists:[{name:'Example Artist'}],album:{id:album,name:'Long Album',images:[{url:'https://i.scdn.co/image/example'}]}}});
const token = (extra = {}) => ({access_token:'access-1',refresh_token:'refresh-1',expires_in:3600,scope:SCOPES.join(' '),...extra});

// Execute the application's actual SQL against SQLite. This adapter does not emulate
// Cloudflare networking/runtime behavior; Wrangler checks cover packaging separately.
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_listening_bookmarks.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_independent_saves.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0004_shortcut_update_access.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0005_paused_update_captures.sql',import.meta.url),'utf8'));
  class Statement {
    sql: string; values: any[] = [];
    constructor(sql: string) { this.sql = sql; }
    bind(...values: any[]) { const s = new Statement(this.sql); s.values = values; return s; }
    async first() { return db.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return {results:db.prepare(this.sql).all(...this.values),success:true}; }
    async run() { const r = db.prepare(this.sql).run(...this.values); return {success:true,meta:{changes:Number(r.changes)}}; }
  }
  return {raw:db,prepare:(sql: string) => new Statement(sql),async batch(statements: Statement[]) {
    db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }};
}
function fixture() {
  const db = database();
  const calls: {url:string;init:any}[] = [];
  let handler = async (url: string, init: any) => {
    if (url.endsWith('/api/token')) return Response.json(token());
    if (url.endsWith('/v1/me')) return Response.json({account_id:account,id:'mutable-id'});
    if (new URL(url).pathname.endsWith('/me/player')) return Response.json(playback());
    if (url.includes('/me/player/play?')) return new Response(null,{status:204});
    throw new Error(`Unexpected Spotify route: ${url}`);
  };
  const app = createApp(async (input,init) => { const url = String(input); calls.push({url,init}); return handler(url,init); });
  const env: any = {DB:db,ASSETS:{fetch:async () => new Response('<html></html>',{headers:{'Content-Type':'text/html'}})},APP_ORIGIN:origin,
    SPOTIFY_CLIENT_ID:'test-client',SETUP_KEY:'s'.repeat(43),ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
  let sessionCookie = '', csrf = '';
  async function request(path: string, options: any = {}) {
    return app.fetch(new Request(origin+path,{method:options.method ?? 'GET',body:options.body,
      headers:{Origin:origin,...(sessionCookie ? {Cookie:sessionCookie} : {}),...(csrf ? {'X-CSRF-Token':csrf} : {}),...options.headers}}),env);
  }
  async function start() {
    const response = await request('/auth/spotify/start',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({setup_key:env.SETUP_KEY})});
    assert.equal(response.status,303);
    return {url:new URL(response.headers.get('Location')!),cookie:response.headers.getSetCookie()[0].split(';')[0]};
  }
  async function login() {
    const startResult = await start();
    const callback = await request(`/auth/spotify/callback?state=${startResult.url.searchParams.get('state')}&code=code-1`,{headers:{Cookie:startResult.cookie}});
    assert.equal(callback.status,303,await callback.clone().text());
    sessionCookie = callback.headers.getSetCookie().find(v => v.includes('album_session='))!.split(';')[0];
    const r = await request('/api/session'); csrf = (await r.json() as any).csrf;
    return {startResult,callback};
  }
  return {db,env,app,calls,request,start,login,setHandler:(h: typeof handler) => { handler = h; }};
}

test('PKCE uses S256, exact redirect, browser binding, encrypted verifier, one-use callback and secure cookies',async () => {
  const f = fixture(); const {startResult,callback} = await f.login();
  assert.equal(startResult.url.searchParams.get('redirect_uri'),origin+'/auth/spotify/callback');
  assert.equal(startResult.url.searchParams.get('code_challenge_method'),'S256');
  const params = new URLSearchParams(f.calls[0].init.body);
  assert.equal(await hash(params.get('code_verifier')!),startResult.url.searchParams.get('code_challenge'));
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM oauth_states').get()!.n,0);
  assert.match(callback.headers.getSetCookie()[0],/Secure/);
  assert.match(callback.headers.getSetCookie()[0],/HttpOnly/);
  assert.match(callback.headers.getSetCookie()[0],/SameSite=Lax/);
  const replay = await f.request(`/auth/spotify/callback?state=${startResult.url.searchParams.get('state')}&code=code-1`,{headers:{Cookie:startResult.cookie}});
  assert.equal(replay.status,400);
  const row: any = f.db.raw.prepare('SELECT * FROM spotify_credentials').get();
  assert.ok(!JSON.stringify(row).includes('refresh-1')); assert.ok(!JSON.stringify(row).includes('access-1'));
  assert.equal(await decrypt(f.env,row.refresh_encrypted,`${account}:refresh`),'refresh-1');
  assert.equal(row.account_id,account);
});

test('wrong setup key, cross-origin sign-in, wrong-browser callback and expired state are rejected',async () => {
  const f = fixture();
  const bad = await f.request('/auth/spotify/start',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'setup_key=bad'});
  assert.equal(bad.status,403);
  const cross = await f.request('/auth/spotify/start',{method:'POST',headers:{Origin:'https://evil.test'}}); assert.equal(cross.status,403);
  const s = await f.start();
  const path = `/auth/spotify/callback?state=${s.url.searchParams.get('state')}&code=x`;
  assert.equal((await f.request(path,{headers:{Cookie:'__Host-album_oauth=other'}})).status,400);
  const stored = f.db.raw.prepare('SELECT * FROM oauth_states').get()!;
  assert.ok(!String(stored.verifier_encrypted).includes(s.url.searchParams.get('code_challenge')!));
  f.db.raw.exec('UPDATE oauth_states SET expires_at=0');
  assert.equal((await f.request(path,{headers:{Cookie:s.cookie}})).status,400); assert.equal(f.calls.length,0);
});

test('unauthenticated access and missing CSRF cannot read or mutate bookmarks',async () => {
  const f = fixture(); assert.equal((await f.request('/api/bookmarks')).status,401); await f.login();
  assert.equal((await f.request('/api/bookmarks/current',{method:'POST',headers:{'X-CSRF-Token':''}})).status,403);
  assert.equal((await f.request('/api/bookmarks/current',{method:'POST',headers:{Origin:'https://evil.test'}})).status,403);
  f.db.raw.exec('UPDATE sessions SET expires_at=0'); assert.equal((await f.request('/api/bookmarks')).status,401);
});

test('single owner cannot be replaced by a second authorized account',async () => {
  const f = fixture(); await f.login();
  f.setHandler(async url => url.endsWith('/api/token') ? Response.json(token()) : Response.json({account_id:'another-account'}));
  const s = await f.start(); const r = await f.request(`/auth/spotify/callback?state=${s.url.searchParams.get('state')}&code=second`,{headers:{Cookie:s.cookie}});
  assert.equal(r.status,403); assert.equal(f.db.raw.prepare('SELECT account_id FROM owner').get()!.account_id,account);
});

test('each save adds an independent bookmark; resume preserves album and disc-two track URI and saved time; delete targets one save',async () => {
  const f = fixture(); await f.login();
  const firstSave = await f.request('/api/bookmarks/current',{method:'POST'}); assert.equal(firstSave.status,200);
  const firstId = (await firstSave.json() as any).bookmarkId;
  f.setHandler(async url => {
    if (new URL(url).pathname.endsWith('/me/player')) return Response.json({...playback(),progress_ms:234567});
    return new Response(null,{status:204});
  });
  const secondId = (await (await f.request('/api/bookmarks/current',{method:'POST'})).json() as any).bookmarkId;
  const list = await (await f.request('/api/bookmarks')).json() as any;
  assert.equal(list.bookmarks.length,2); assert.notEqual(firstId,secondId);
  assert.equal(list.bookmarks.find((b: any) => b.bookmark_id === firstId).progress_ms,123456);
  assert.equal(list.bookmarks.find((b: any) => b.bookmark_id === secondId).progress_ms,234567); assert.ok(!list.bookmarks[0].account_id);
  const resume = await f.request(`/api/bookmarks/${secondId}/resume`,{method:'POST'}); assert.equal(resume.status,200);
  const play = f.calls.find(c => c.url.includes('/me/player/play?'))!;
  assert.deepEqual(JSON.parse(play.init.body),{context_uri:`spotify:album:${album}`,offset:{uri:`spotify:track:${track}`},position_ms:234567});
  assert.match(play.url,/device_id=active-device/);
  assert.equal((await f.request(`/api/bookmarks/${secondId}`,{method:'DELETE'})).status,200);
  assert.equal((await f.request(`/api/bookmarks/${secondId}/resume`,{method:'POST'})).status,404);
});

test('no playback, local files, malformed episodes and missing progress never overwrite a saved bookmark; paused capture is supported',async () => {
  const f = fixture(); await f.login(); await f.request('/api/bookmarks/current',{method:'POST'});
  const examples = [null,{...playback(),item:{...playback().item,is_local:true}},
    {...playback(),currently_playing_type:'episode',item:{type:'episode'}},{...playback(),progress_ms:null}];
  for (const data of examples) {
    f.setHandler(async () => data ? Response.json(data) : new Response(null,{status:204}));
    const r = await f.request('/api/bookmarks/current',{method:'POST'}); assert.ok([409,422].includes(r.status));
  }
  assert.equal(f.db.raw.prepare('SELECT progress_ms FROM saved_bookmarks').get()!.progress_ms,123456);
  assert.equal(bookmarkFromPlayback({...playback(),is_playing:false,progress_ms:0},account,1).progress_ms,0);
  assert.deepEqual(resumeBody(bookmarkFromPlayback(playback(),account,1)),{context_uri:`spotify:album:${album}`,offset:{uri:`spotify:track:${track}`},position_ms:123456});
});

test('Shortcut credentials are hashed, narrowly scoped, rotated and revoked',async () => {
  const f = fixture(); await f.login();
  const first = await (await f.request('/api/shortcut-credentials',{method:'POST'})).json() as any;
  const saved: any = f.db.raw.prepare('SELECT * FROM shortcut_credentials').get(); assert.notEqual(saved.token_hash,first.credential);
  const options = {method:'POST',headers:{Cookie:'',Authorization:`Bearer ${first.credential}`,'X-CSRF-Token':'',Origin:''}};
  assert.equal((await f.request('/api/bookmarks/current',options)).status,200);
  assert.equal((await f.request('/api/bookmarks',{headers:{Authorization:`Bearer ${first.credential}`}})).status,403);
  assert.equal((await f.request(`/api/bookmarks/${album}/resume`,options)).status,403);
  const second = await (await f.request('/api/shortcut-credentials',{method:'POST'})).json() as any;
  assert.notEqual(second.credential,first.credential);
  assert.equal((await f.request('/api/bookmarks/current',options)).status,401);
  await f.request('/api/shortcut-credentials',{method:'DELETE'});
  assert.equal((await f.request('/api/bookmarks/current',{...options,headers:{Authorization:`Bearer ${second.credential}`}})).status,401);
});

test('expired access token refresh rotates refresh token; absent rotation retains existing token',async () => {
  const f = fixture(); await f.login();
  for (const rotated of [true,false]) {
    f.db.raw.exec('UPDATE spotify_credentials SET access_expires_at=0');
    f.setHandler(async (url, init) => {
      if (url.endsWith('/api/token')) {
        assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');
        return Response.json(rotated ? token({access_token:'access-2',refresh_token:'refresh-2'}) : {access_token:'access-3',expires_in:3600});
      }
      assert.equal(init.headers.Authorization,rotated ? 'Bearer access-2' : 'Bearer access-3'); return Response.json(playback());
    });
    assert.equal((await f.request('/api/bookmarks/current',{method:'POST'})).status,200);
    const row: any = f.db.raw.prepare('SELECT * FROM spotify_credentials').get();
    assert.equal(await decrypt(f.env,row.refresh_encrypted,`${account}:refresh`),'refresh-2'); assert.equal(row.refresh_lock,null);
  }
});

test('invalid_grant discards credentials, retains bookmarks, and requests reauthentication without retry',async () => {
  const f = fixture(); await f.login(); await f.request('/api/bookmarks/current',{method:'POST'});
  f.db.raw.exec('UPDATE spotify_credentials SET access_expires_at=0');
  let attempts = 0;
  f.setHandler(async () => { attempts++; return Response.json({error:'invalid_grant'},{status:400}); });
  const r = await f.request('/api/bookmarks/current',{method:'POST'}); assert.equal(r.status,401); assert.equal(attempts,1);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM spotify_credentials').get()!.n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM saved_bookmarks').get()!.n,1);
  assert.equal((await (await f.request('/api/session')).json() as any).spotifyConnected,false);
});

test('Spotify 401 refreshes once, 403/404 are actionable, 429 preserves Retry-After and distinguishes quota',async () => {
  const f = fixture(); await f.login(); let reads = 0;
  f.setHandler(async url => {
    if (url.endsWith('/api/token')) return Response.json(token({access_token:'access-2'}));
    reads++; return reads === 1 ? new Response(null,{status:401}) : Response.json(playback());
  });
  assert.equal((await f.request('/api/bookmarks/current',{method:'POST'})).status,200); assert.equal(reads,2);
  for (const [upstream,status,code] of [[403,403,'spotify_forbidden'],[404,409,'no_device'],[429,429,'spotify_quota']] as const) {
    f.setHandler(async () => Response.json({error:{reason:'QUOTA_EXCEEDED'}},{status:upstream,headers:{'Retry-After':'41'}}));
    const r = await f.request('/api/bookmarks/current',{method:'POST'}); assert.equal(r.status,status); assert.equal((await r.json() as any).code,code);
    if (upstream === 429) assert.equal(r.headers.get('Retry-After'),'41');
  }
});

test('resume rejects unavailable and restricted devices before issuing a playback command',async () => {
  const f = fixture(); await f.login();
  const bookmarkId = (await (await f.request('/api/bookmarks/current',{method:'POST'})).json() as any).bookmarkId;
  for (const data of [null,{...playback(),device:{id:'x',is_active:false}},{...playback(),device:{id:'x',is_active:true,is_restricted:true}}]) {
    f.setHandler(async () => data ? Response.json(data) : new Response(null,{status:204}));
    const r = await f.request(`/api/bookmarks/${bookmarkId}/resume`,{method:'POST'}); assert.ok([403,409].includes(r.status));
  }
  assert.equal(f.calls.filter(c => c.url.includes('/me/player/play?')).length,0);
});

test('refresh lease prevents concurrent refresh, and disconnect clears credentials, sessions and Shortcut access',async () => {
  const f = fixture(); await f.login(); await f.request('/api/shortcut-credentials',{method:'POST'});
  f.db.raw.exec(`UPDATE spotify_credentials SET access_expires_at=0,refresh_lock='in-flight',lock_expires_at=${Date.now()+30000}`);
  const r = await f.request('/api/bookmarks/current',{method:'POST'}); assert.equal(r.status,409); assert.equal(r.headers.get('Retry-After'),'2');
  assert.equal((await f.request('/api/disconnect',{method:'POST'})).status,200);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM spotify_credentials').get()!.n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM sessions').get()!.n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM shortcut_credentials WHERE revoked_at IS NULL').get()!.n,0);
});

test('request limits, scheduled cleanup and security headers are applied',async () => {
  const f = fixture();
  const initial = await f.request('/'); assert.match(initial.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/); assert.equal(initial.headers.get('Cache-Control'),'no-store');
  assert.equal(initial.headers.get('Referrer-Policy'),'strict-origin');
  assert.match(initial.headers.get('Content-Security-Policy')!,/form-action 'self' https:\/\/accounts\.spotify\.com;/);
  for (let i=0;i<120;i++) await f.request('/api/bookmarks');
  const r = await f.request('/api/bookmarks'); assert.equal(r.status,429); assert.ok(Number(r.headers.get('Retry-After')) > 0);
  f.db.raw.exec('UPDATE rate_limits SET expires_at=0'); await f.app.scheduled({},f.env);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM rate_limits').get()!.n,0);
});

test('opt-in Shortcut notification responses carry errors in JSON without bypassing authentication',async () => {
  const f = fixture();
  const r = await f.request('/api/bookmarks/current',{method:'POST',headers:{'X-Shortcut-Response':'notification'}});
  assert.equal(r.status,200);
  const data = await r.json() as any; assert.equal(data.ok,false); assert.equal(data.httpStatus,401); assert.equal(data.code,'sign_in');
  assert.equal(f.calls.length,0); assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM saved_bookmarks').get()!.n,0);
});
