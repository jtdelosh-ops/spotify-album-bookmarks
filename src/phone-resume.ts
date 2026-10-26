import {AppError, type Bookmark, type Env, type Fetch} from './types.ts';
import {spotify, resumeBookmark} from './spotify.ts';

// iOS can hide an idle phone when Spotify is backgrounded. The client opens
// Spotify while this user-triggered request waits for the chosen ID, or one newly
// available phone on first use. Never fall back to an active speaker/computer.
export async function resumeOnPhone(env: Env, fetcher: Fetch, bookmark: Bookmark, target: {deviceId?:string;seenDeviceIds:string[]}): Promise<{id:string;name:string}> {
  const deadline = Date.now()+22000, phoneDeadline = Date.now()+12000;
  const boundedFetch: Fetch = (input, init = {}) => {
    const remaining = deadline-Date.now();
    if (remaining <= 0) return Promise.reject(new Error('Phone resume deadline exceeded'));
    const signal = AbortSignal.timeout(Math.max(1,Math.min(4000,remaining)));
    return fetcher(input,{...init,signal:init.signal ? AbortSignal.any([init.signal,signal]) : signal});
  };
  let phone: any;
  // Bound both time and upstream/D1 request count for the Free Worker runtime.
  for (let attempt=0; attempt<5 && Date.now()<phoneDeadline; attempt++) {
    const response = await spotify(env,boundedFetch,'/me/player/devices');
    const data = await response.json() as any;
    const devices = Array.isArray(data.devices) ? data.devices : [];
    if (target.deviceId) phone = devices.find((d: any)=>d.id === target.deviceId);
    else {
      const candidates = devices.filter((d: any)=>typeof d.id==='string' && d.id && !target.seenDeviceIds.includes(d.id) &&
        typeof d.type==='string' && d.type.toLowerCase()==='smartphone');
      if (candidates.length>1) throw new AppError(409,'phone_ambiguous','More than one phone became available. Return here, choose your phone under Where to play, and try again.');
      phone = candidates[0];
    }
    if (phone) break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if (!phone) throw new AppError(409,'phone_unavailable','Spotify did not make your saved phone available. Keep Spotify open and try again. If you reinstalled Spotify, choose your phone again under Where to play.');
  if (phone.is_restricted || typeof phone.type !== 'string' || phone.type.toLowerCase() !== 'smartphone')
    throw new AppError(403,'phone_restricted','The selected device is not a controllable phone. Choose your iPhone under Where to play.');
  const current = await env.DB.prepare('SELECT * FROM saved_bookmarks WHERE account_id=? AND bookmark_id=?')
    .bind(bookmark.account_id,bookmark.bookmark_id).first<Bookmark>();
  if (!current) throw new AppError(404,'bookmark_missing','This bookmark was deleted. Return to the bookmark page.');
  if (current.item_id !== bookmark.item_id || current.progress_ms !== bookmark.progress_ms || current.context_uri !== bookmark.context_uri)
    throw new AppError(409,'bookmark_changed','This saved position changed while waiting for Spotify. Return to the bookmark page and try again.');
  if (Date.now() >= deadline) throw new AppError(409,'phone_resume_unconfirmed','The phone resume request timed out. Check Spotify, then try again.');
  const started = Date.now();
  const deviceId = phone.id;
  await resumeBookmark(env,boundedFetch,current,deviceId);
  if (current.context_type !== 'episode') {
    let confirmed = false;
    for (let attempt=0; attempt<3 && Date.now()<deadline; attempt++) {
      await new Promise(resolve=>setTimeout(resolve,500));
      const response = await spotify(env,boundedFetch,'/me/player?additional_types=track,episode');
      const state = response.status === 204 ? null : await response.json() as any;
      const delta = state?.progress_ms-current.progress_ms;
      if (state?.device?.id===deviceId && state?.item?.id===current.item_id && state?.is_playing===true &&
          Number.isInteger(state.progress_ms) && delta>=-1500 && delta<=Date.now()-started+5000) { confirmed=true;break; }
    }
    if (!confirmed) throw new AppError(409,'phone_resume_unconfirmed','Spotify did not confirm this bookmark playing on your phone. Check Spotify before trying again.');
  }
  return {id:deviceId,name:typeof phone.name === 'string' ? phone.name : 'your phone'};
}
