import {AppError, type Bookmark, type Env, type Fetch, type Session} from './types.ts';
import {decrypt, encrypt, hash, randomToken} from './crypto.ts';
import {bookmarkFromPlayback, playlistMetadata, spotify} from './spotify.ts';

interface CaptureJob {
  capture_id:string;account_id:string;session_hash:string;bookmark_id:string;base_fingerprint:string;
  status:'waiting'|'ready'|'failed'|'cancelled'|'confirmed';capture_encrypted:string|null;
  error_code:string|null;error_message:string|null;created_at:number;expires_at:number;
}
interface Captured {
  bookmark:Bookmark;capturedAt:number;phone?:{id:string;name:string};
}
export const captureIdValid = (id:unknown):id is string => typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const fingerprint = (b:Bookmark) => hash(JSON.stringify([b.created_at,b.updated_at,b.label,b.item_uri,b.context_uri,b.progress_ms]));
const aad = (job:CaptureJob) => `update-capture:${job.account_id}:${job.session_hash}:${job.capture_id}`;
function publicPreview(value:Captured) {
  const b=value.bookmark;
  return {itemName:b.item_name,creatorName:b.creator_name,contextName:b.context_name,positionMs:b.progress_ms,
    durationMs:b.duration_ms,capturedAt:value.capturedAt};
}
async function jobFor(env:Env,session:Session,id:string):Promise<CaptureJob> {
  const job=await env.DB.prepare('SELECT * FROM update_captures WHERE capture_id=? AND account_id=? AND session_hash=?')
    .bind(id,session.account_id,session.token_hash).first<CaptureJob>();
  if(!job)throw new AppError(404,'capture_missing','This capture is no longer available. Open Update position and try again.');
  if(job.expires_at<=Date.now())throw new AppError(409,'capture_expired','This captured position expired. Open Update position and capture it again.');
  return job;
}
async function stillWaiting(env:Env,job:CaptureJob):Promise<void> {
  const current=await env.DB.prepare(`SELECT status,expires_at FROM update_captures WHERE capture_id=?
    AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?)`)
    .bind(job.capture_id,job.session_hash,job.account_id,Date.now())
    .first<{status:string;expires_at:number}>();
  if(current?.status!=='waiting'||current.expires_at<=Date.now())throw new AppError(409,'capture_cancelled','Capture cancelled or expired.');
  const bookmark=await env.DB.prepare('SELECT * FROM saved_bookmarks WHERE account_id=? AND bookmark_id=?')
    .bind(job.account_id,job.bookmark_id).first<Bookmark>();
  if(!bookmark||await fingerprint(bookmark)!==job.base_fingerprint)
    throw new AppError(409,'bookmark_changed','This bookmark changed while waiting. Open Update position again.');
}
async function storeCapture(env:Env,fetcher:Fetch,job:CaptureJob,state:any,phone?:{id:string;name:string}):Promise<void> {
  const capturedAt=Date.now(),bookmark=bookmarkFromPlayback(state,job.account_id,capturedAt);
  if(bookmark.context_type==='playlist'){
    const metadata=await playlistMetadata(env,fetcher,bookmark.context_id);
    if(metadata){bookmark.context_name=metadata.name;bookmark.image_url=metadata.image;}
  }
  const value:Captured={bookmark,capturedAt,phone};
  const stored=await encrypt(env,JSON.stringify(value),aad(job));
  await env.DB.prepare("UPDATE update_captures SET status='ready',capture_encrypted=? WHERE capture_id=? AND status='waiting' AND expires_at>?")
    .bind(stored,job.capture_id,Date.now()).run();
}
async function capturePaused(env:Env,fetcher:Fetch,job:CaptureJob,target:{deviceId?:string;seenDeviceIds:string[]},automatic=false):Promise<void> {
  const deadline=Date.now()+25000,phoneDeadline=Date.now()+16000;
  const bounded:Fetch=(input,init={})=>{
    const remaining=deadline-Date.now();
    if(remaining<=0)throw new AppError(409,'capture_timeout','Capture timed out. Your bookmark was not changed.');
    const signal=AbortSignal.timeout(Math.max(1,Math.min(4000,remaining)));
    return fetcher(input,{...init,signal:init.signal?AbortSignal.any([init.signal,signal]):signal});
  };
  if(automatic){
    await stillWaiting(env,job);
    const response=await spotify(env,bounded,'/me/player?additional_types=track,episode');
    const current=response.status===204?null:await response.json();
    try {
      bookmarkFromPlayback(current,job.account_id,Date.now());
    } catch(error){
      if(!(error instanceof AppError)||!['nothing_playing','missing_position'].includes(error.code))throw error;
      // Only absent state needs phone reconnection. Unsupported audio still fails.
      return captureUnavailablePhone();
    }
    await storeCapture(env,bounded,job,current);return;
  }
  return captureUnavailablePhone();
  async function captureUnavailablePhone():Promise<void>{
  let phone:any,devices:any[]=[];
  for(let n=0;n<9&&Date.now()<phoneDeadline;n++){
    await stillWaiting(env,job);
    const response=await spotify(env,bounded,'/me/player/devices');
    devices=((await response.json()) as any).devices??[];
    if(!Array.isArray(devices))devices=[];
    if(target.deviceId)phone=devices.find(d=>d.id===target.deviceId);
    else{
      const candidates=devices.filter(d=>typeof d.id==='string'&&d.id&&(automatic||!target.seenDeviceIds.includes(d.id))&&d.type?.toLowerCase()==='smartphone');
      if(candidates.length>1)throw new AppError(409,'phone_ambiguous',automatic?'Spotify reported several phones and could not identify this iPhone. Your bookmark was not changed.':'Several phones appeared. Return and choose your iPhone by name under Where to play, then try recovery again.');
      phone=candidates[0];
    }
    if(phone)break;
    await new Promise(r=>setTimeout(r,1500));
  }
  if(!phone)throw new AppError(409,'phone_unavailable','The iPhone was not visible. Keep Spotify’s devices panel open with This iPhone selected, then try recovery again.');
  if(phone.is_restricted||phone.type?.toLowerCase()!=='smartphone')throw new AppError(403,'phone_restricted','Recovery requires a controllable phone. Choose your iPhone and try again.');
  if(devices.some(d=>d.is_active&&d.id!==phone.id))throw new AppError(409,'other_device_active','Another Spotify device is active. Recovery stopped without changing your bookmark.');
  await stillWaiting(env,job);
  const beforeResponse=await spotify(env,bounded,'/me/player?additional_types=track,episode');
  let state:any=beforeResponse.status===204?null:await beforeResponse.json();
  if(state&&((!automatic&&state.is_playing!==false)||typeof state.is_playing!=='boolean'||state.device?.id!==phone.id))
    throw new AppError(409,'playback_changed','Playback changed or belongs to another device. Leave this iPhone paused and try again.');
  const reconnected=!state;
  if(reconnected){
    // The one-press browser action explicitly requests capture and replacement.
    // Keep playback paused; never send a Play command to obtain a position.
    await stillWaiting(env,job);
    await spotify(env,bounded,'/me/player',{method:'PUT',body:JSON.stringify({device_ids:[phone.id],play:false})});
    for(let n=0;n<3&&Date.now()<deadline;n++){
      await new Promise(r=>setTimeout(r,500));
      const r=await spotify(env,bounded,'/me/player?additional_types=track,episode');
      state=r.status===204?null:await r.json();
      if(state)break;
    }
  }
  if(!state||((!automatic||reconnected)&&state.is_playing!==false)||typeof state.is_playing!=='boolean'||state.device?.id!==phone.id||state.device?.is_restricted||state.device?.type?.toLowerCase()!=='smartphone')
    throw new AppError(409,'paused_capture_unconfirmed','Spotify did not confirm a paused position on this iPhone. Your bookmark was not changed.');
  await storeCapture(env,bounded,job,state,{id:phone.id,name:typeof phone.name==='string'?phone.name:'iPhone'});
  }
}
export async function startPausedCapture(env:Env,fetcher:Fetch,session:Session,bookmark:Bookmark,
  input:{captureId:string;deviceId?:string;seenDeviceIds:string[]},context:Pick<ExecutionContext,'waitUntil'>,automatic=false):Promise<void> {
  const now=Date.now();
  const job:CaptureJob={capture_id:input.captureId,account_id:session.account_id,session_hash:session.token_hash,
    bookmark_id:bookmark.bookmark_id,base_fingerprint:await fingerprint(bookmark),status:'waiting',capture_encrypted:null,
    error_code:null,error_message:null,created_at:now,expires_at:now+5*60000};
  const results=await env.DB.batch([
    env.DB.prepare('DELETE FROM update_captures WHERE expires_at<=?').bind(now),
    env.DB.prepare(`INSERT OR IGNORE INTO update_captures
      (capture_id,account_id,session_hash,bookmark_id,base_fingerprint,status,created_at,expires_at) VALUES (?,?,?,?,?,'waiting',?,?)`)
      .bind(job.capture_id,job.account_id,job.session_hash,job.bookmark_id,job.base_fingerprint,now,job.expires_at)
  ]);
  if(!results[1].meta.changes){
    const existing=await jobFor(env,session,input.captureId);
    if(existing.bookmark_id!==bookmark.bookmark_id)throw new AppError(409,'capture_conflict','This capture belongs to a different bookmark. Open Update position again.');
    return;
  }
  const task=capturePaused(env,fetcher,job,input,automatic).then(async()=>{
    if(automatic)await confirmPausedCapture(env,session,job.capture_id);
  }).catch(async(error:unknown)=>{
    const known=error instanceof AppError;
    const noDevice=known&&error.code==='no_device';
    await env.DB.prepare("UPDATE update_captures SET status='failed',capture_encrypted=NULL,error_code=?,error_message=? WHERE capture_id=? AND status IN ('waiting','ready')")
      .bind(noDevice?'phone_unavailable':known?error.code:'capture_failed',
        noDevice?'Spotify could not reconnect this iPhone. Keep it paused with its devices panel open and This iPhone selected, then try recovery again. Your bookmark was not changed.'
          :known?error.message:'Capture could not complete. Your bookmark was not changed.',job.capture_id).run();
  });
  // Bounded provider work continues while Safari is backgrounded. Database
  // failure leaves a waiting/expired capture, never a successful bookmark update.
  context.waitUntil(task.catch(()=>{}));
}
export async function readPausedCapture(env:Env,session:Session,id:string):Promise<object> {
  const job=await jobFor(env,session,id);
  if(job.status==='ready'){
    const value=JSON.parse(await decrypt(env,job.capture_encrypted!,aad(job))) as Captured;
    return {status:'ready',captureId:id,bookmarkId:job.bookmark_id,expiresAt:job.expires_at,preview:publicPreview(value),phone:value.phone};
  }
  return {status:job.status,captureId:id,bookmarkId:job.bookmark_id,expiresAt:job.expires_at,
    code:job.error_code,message:job.error_message};
}
export async function cancelPausedCapture(env:Env,session:Session,id:string):Promise<void> {
  await jobFor(env,session,id);
  await env.DB.prepare("UPDATE update_captures SET status='cancelled',capture_encrypted=NULL WHERE capture_id=? AND status IN ('waiting','ready')")
    .bind(id).run();
}
export async function confirmPausedCapture(env:Env,session:Session,id:string):Promise<object> {
  const job=await jobFor(env,session,id);
  if(job.status==='confirmed')return {ok:true,message:'This captured position was already saved.'};
  if(job.status!=='ready')throw new AppError(409,'capture_not_ready','There is no captured position ready to confirm. Your bookmark was not changed.');
  const existing=await env.DB.prepare('SELECT * FROM saved_bookmarks WHERE account_id=? AND bookmark_id=?')
    .bind(session.account_id,job.bookmark_id).first<Bookmark>();
  if(!existing||await fingerprint(existing)!==job.base_fingerprint)throw new AppError(409,'bookmark_changed','This bookmark changed after capture. Open Update position again.');
  const value=JSON.parse(await decrypt(env,job.capture_encrypted!,aad(job))) as Captured;
  const {account_id,bookmark_id,label,created_at,updated_at,...playback}=value.bookmark;
  const columns=Object.keys(playback),nonce=randomToken(),now=Date.now();
  const base=[session.account_id,job.bookmark_id,existing.created_at,existing.updated_at,existing.label,existing.item_uri,existing.context_uri,existing.progress_ms];
  const where='account_id=? AND bookmark_id=? AND created_at=? AND updated_at=? AND label=? AND item_uri=? AND context_uri=? AND progress_ms=?';
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE update_captures SET status='confirmed',confirmation_nonce=?,capture_encrypted=NULL
      WHERE capture_id=? AND account_id=? AND session_hash=? AND status='ready' AND expires_at>?
      AND EXISTS (SELECT 1 FROM saved_bookmarks WHERE ${where})`)
      .bind(nonce,id,session.account_id,session.token_hash,now,...base),
    env.DB.prepare(`UPDATE saved_bookmarks SET ${columns.map(c=>`${c}=?`).join(',')},updated_at=MAX(updated_at+1,?)
      WHERE ${where} AND EXISTS(SELECT 1 FROM update_captures WHERE capture_id=? AND confirmation_nonce=? AND status='confirmed')`)
      .bind(...Object.values(playback),now,...base,id,nonce)
  ]);
  if(!result[1].meta.changes){
    const current=await jobFor(env,session,id);
    if(current.status==='confirmed')return {ok:true,message:'This captured position was already saved.'};
    throw new AppError(409,'bookmark_changed','This bookmark changed before confirmation. Open Update position again.');
  }
  return {ok:true,bookmarkId:job.bookmark_id,message:`Bookmark updated to the displayed capture of ${playback.item_name}. Its name is unchanged.`};
}
