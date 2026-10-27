const $ = id => document.getElementById(id);
let csrf = '';
let busy = false;
const onIPhone = /iPhone|iPod/.test(navigator.userAgent);
const thisPhone = 'this-iphone';
let deviceSnapshot = [];
let deviceSnapshotAt = 0;
let sessionReady = false;
const captureStorage = 'spotify-bookmarks-auto-update';
const updatePanels = new Map();
function pendingCapture() {
  try {
    const p=JSON.parse(localStorage.getItem(captureStorage));
    return p && /^[0-9a-f-]{36}$/.test(p.captureId) && typeof p.bookmarkId==='string' &&
      Number.isFinite(p.createdAt) && Date.now()-p.createdAt>=0 && Date.now()-p.createdAt<5*60000 ? p : null;
  } catch {return null;}
}
function clearCapture(id) {
  try {if(pendingCapture()?.captureId===id)localStorage.removeItem(captureStorage);} catch {}
}
function rememberedPhone() {
  try {
    const p = JSON.parse(localStorage.getItem('spotify-bookmarks-phone'));
    return p && typeof p.id==='string' && p.id && p.id.length<=256 && typeof p.name==='string' && p.name.length<=256 &&
      Number.isFinite(p.savedAt) && Date.now()-p.savedAt>=0 && Date.now()-p.savedAt<30*86400000 ? p : null;
  } catch { return null; }
}
function rememberPhone(phone) {
  try { localStorage.setItem('spotify-bookmarks-phone',JSON.stringify({id:phone.id,name:phone.name,savedAt:Date.now()})); } catch {}
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); }
async function api(path, method = 'GET', body, keepalive = false) {
  const response = await fetch(path,{method,headers:method === 'GET' ? {} : {'X-CSRF-Token':csrf,...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),cache:'no-store',keepalive});
  let data;
  try { data = await response.json(); } catch { throw new Error('The service returned an unreadable response. Try again.'); }
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'),{code:data.code});
  return data;
}
async function action(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, #playback-device').forEach(b => b.disabled = true);
  document.querySelectorAll('.resume-control, .recovery-control').forEach(a=>a.setAttribute('aria-disabled','true'));
  try { await task(); }
  catch (error) { status(error.message,true); if (['spotify_reconnect','invalid_grant','spotify_scopes'].includes(error.code)) $('signin').hidden = false; }
  finally {
    busy = false; document.querySelectorAll('button, #playback-device').forEach(b => b.disabled = false);
    document.querySelectorAll('.resume-control, .recovery-control').forEach(a=>a.setAttribute('aria-disabled','false'));
  }
}
function updateResumeLinks() {
  const localPhone = $('playback-device').value===thisPhone;
  document.querySelectorAll('.resume-control').forEach(a=>a.href=localPhone ? a.dataset.spotifyUri : '#');
}
function time(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function element(tag, text, cls) { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; }
function setupUpdate(b,bookmarkName,update) {
  async function monitor(p) {
    const started=Date.now();
    while(true){
      let result;
      try{result=await api('/api/update-captures/'+p.captureId);}
      catch(error){if(['capture_missing','capture_expired'].includes(error.code))clearCapture(p.captureId);throw error;}
      if(result.bookmarkId!==b.bookmark_id)throw new Error('Update belongs to a different bookmark.');
      if(result.status==='confirmed'){
        clearCapture(p.captureId);await render();status('Bookmark updated. Its name is unchanged.');return;
      }
      if(!['waiting','ready'].includes(result.status)){
        clearCapture(p.captureId);throw new Error(result.message||'Update could not complete. Your bookmark was not changed.');
      }
      if(Date.now()-started>=35000){status('Update has not been confirmed yet. Return to this page to check its result.',true);return;}
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  updatePanels.set(b.bookmark_id,{monitor,fail(error){status(error.message,true);}});
  if(onIPhone){
    update.href='spotify:';update.setAttribute('role','button');
    update.onkeydown=event=>{if(event.key===' '){event.preventDefault();if(!event.repeat)update.click();}};
  }
  update.onclick=event=>{
    if(busy){event.preventDefault();return;}
    if(!onIPhone){
      action(async()=>{status('Updating bookmark…');const r=await api('/api/bookmarks/'+encodeURIComponent(b.bookmark_id)+'/update','POST');await render();status(r.message);});return;
    }
    const previous=pendingCapture();
    if(previous&&previous.bookmarkId!==b.bookmark_id){
      const other=updatePanels.get(previous.bookmarkId);
      if(other){event.preventDefault();action(()=>other.monitor(previous));return;}
      clearCapture(previous.captureId);
    }
    // Reissue the same idempotent start after an uncertain/pre-job failure.
    const p=previous?.bookmarkId===b.bookmark_id?previous:{captureId:crypto.randomUUID(),bookmarkId:b.bookmark_id,createdAt:Date.now()};
    try{localStorage.setItem(captureStorage,JSON.stringify(p));}
    catch{event.preventDefault();status('Allow website storage so the update can finish while Spotify is open.',true);return;}
    const known=rememberedPhone();
    // Start the keepalive request in the native-link click, before Spotify opens.
    action(async()=>{
      status('Updating bookmark. Keep Spotify visible while its playing or paused position is saved…');
      try{
        await api('/api/bookmarks/'+encodeURIComponent(b.bookmark_id)+'/update-on-phone','POST',
          {captureId:p.captureId,seenDeviceIds:deviceSnapshot.map(d=>d.id),...(known?{deviceId:known.id}:{})},true);
        await monitor(p);
      }catch(error){status(error.message,true);}
    });
  };
}
async function restorePendingCapture() {
  const p=pendingCapture();if(!p||busy)return;
  const panel=updatePanels.get(p.bookmarkId);
  if(!panel){clearCapture(p.captureId);return;}
  await action(async()=>{try{await panel.monitor(p);}catch(error){if(['capture_missing','capture_expired'].includes(error.code))clearCapture(p.captureId);panel.fail(error);status(error.message,true);}});
}
async function refreshDevices() {
  const r = await api('/api/devices');
  let selected = $('playback-device').value;
  const selectedLabel = $('playback-device').selectedOptions[0]?.textContent || 'Selected device';
  deviceSnapshot = r.devices;
  deviceSnapshotAt = Date.now();
  const known = onIPhone ? rememberedPhone() : null;
  if (known?.id === selected) selected = thisPhone;
  const options = [...(onIPhone ? [new Option('This iPhone',thisPhone)] : []),new Option('Active Spotify device','')];
  for (const d of r.devices) {
    if (known?.id !== d.id) options.push(new Option(`${d.name}${d.isActive ? ' (active)' : ''}`,d.id));
  }
  // Keep an explicit target when it disappears; never silently switch to the
  // active speaker/computer after refreshing the dropdown.
  if (selected && !options.some(o=>o.value===selected)) options.push(new Option(`${selectedLabel.replace(/ \(unavailable\)$/,'')} (unavailable)`,selected));
  $('playback-device').replaceChildren(...options);
  $('playback-device').value = selected;
  updateResumeLinks();
  return r.devices.length;
}
async function render() {
  const data = await api('/api/bookmarks');
  updatePanels.clear();
  $('bookmarks').replaceChildren(); $('empty').hidden = data.bookmarks.length !== 0;
  for (const b of data.bookmarks) {
    const card = element('article',null,'card');
    if (b.image_url && /^https:\/\/i\.scdn\.co\//.test(b.image_url)) {
      const img = element('img',null,'cover'); img.src = b.image_url; img.alt = `${b.context_name} artwork`; img.loading = 'lazy'; card.append(img);
    } else { const placeholder = element('div','♪','cover'); placeholder.setAttribute('aria-hidden','true'); card.append(placeholder); }
    const bookmarkName = b.label || `${b.item_name} · ${time(b.progress_ms)}`;
    const info = element('div'); const title = element('h3',bookmarkName); const link = element('a',b.context_name === b.item_name ? 'Open in Spotify' : b.context_name);
    const kind = ['album','playlist','episode'].includes(b.context_type) ? b.context_type : 'album';
    link.href = `https://open.spotify.com/${kind}/${encodeURIComponent(b.context_id)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const source = element('p'); source.append(link);
    info.append(title,element('p',b.creator_name));
    if (b.label) info.append(element('p',b.item_name));
    info.append(source);
    const trackPosition = kind === 'album' && b.disc_number && b.track_number ? ` · Disc ${b.disc_number}, track ${b.track_number}` : '';
    info.append(element('p',`${time(b.progress_ms)} / ${time(b.duration_ms)}${trackPosition}`,'position'));
    const saved = element('time',`Created ${new Date(b.created_at).toLocaleString()}`); saved.dateTime = new Date(b.created_at).toISOString(); info.append(saved);
    if (b.updated_at !== b.created_at) {
      const edited = element('time',`Edited ${new Date(b.updated_at).toLocaleString()}`); edited.dateTime = new Date(b.updated_at).toISOString(); info.append(element('br'),edited);
    }
    card.append(info);
    const actions = element('div',null,'actions');
    const resume = element(onIPhone ? 'a' : 'button','Resume',onIPhone ? 'resume-control' : 'secondary');
    resume.setAttribute('aria-label',`Resume ${bookmarkName}`);
    if (onIPhone) {
      resume.setAttribute('role','button');
      resume.setAttribute('aria-disabled',String(busy));
      resume.dataset.spotifyUri = `spotify:${b.context_type==='episode' ? 'episode' : 'track'}:${encodeURIComponent(b.item_id)}`;
      resume.onkeydown = event=>{ if(event.key===' ') {event.preventDefault();if(!event.repeat)resume.click();} };
    }
    resume.onclick = event => {
      if (busy) { event.preventDefault();return; }
      if (onIPhone && $('playback-device').value===thisPhone) {
        const known = rememberedPhone();
        if (!known && (Date.now()-deviceSnapshotAt<0 || Date.now()-deviceSnapshotAt>60000)) {
          event.preventDefault();
          action(async()=>{await refreshDevices();status('Devices refreshed. Tap Resume again to open Spotify.');});
          return;
        }
        if (!known && deviceSnapshot.some(d=>d.type.toLowerCase()==='smartphone')) {
          event.preventDefault();
          status('Your phone is already available. Choose it by name under Where to play, then tap Resume.');
          $('playback-device').focus();return;
        }
        const body = {seenDeviceIds:deviceSnapshot.map(d=>d.id),...(known ? {deviceId:known.id} : {})};
        // Start the request synchronously during this click, before the real
        // Spotify link opens the app. Never await a preflight before navigation.
        action(async()=>{
          status('Opening Spotify. Keep it on the screen while your saved position resumes…');
          const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}/resume-on-phone`,'POST',body,true);
          rememberPhone(r.phone);status(r.message);
        });
        return;
      }
      event.preventDefault();
      action(async()=>{
      status('Requesting playback…');
      const deviceId = $('playback-device').value;
      try {
        const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}/resume`,'POST',deviceId ? {deviceId} : undefined);
        status(r.message);
      } catch (error) {
        if (['no_device','device_unavailable'].includes(error.code)) {
          const count = await refreshDevices();
          status(count ? 'Choose where to play above your saved places, then tap Resume again.' : 'No controllable devices are visible. Open Spotify on your device, then refresh devices.',true);
          $('playback-device').focus();
        } else throw error;
      }
      });
    };
    const update = element(onIPhone?'a':'button','Update position',onIPhone?'recovery-control':'quiet'); update.setAttribute('aria-label',`Update position for ${bookmarkName}`);
    setupUpdate(b,bookmarkName,update);
    const rename = element('button',b.label ? 'Rename' : 'Name','quiet'); rename.setAttribute('aria-label',`Name bookmark ${bookmarkName}`);
    const nameForm = element('form',null,'bookmark-name'); nameForm.hidden = true;
    const nameLabel = element('label','Bookmark name (optional)');
    const nameInput = element('input'); nameInput.id = `bookmark-name-${b.bookmark_id}`;
    nameInput.type = 'text'; nameInput.maxLength = 120; nameInput.value = b.label || ''; nameInput.autocomplete = 'off'; nameInput.placeholder = 'e.g. Before the gym';
    nameLabel.htmlFor = nameInput.id;
    const saveName = element('button','Save name','secondary'); saveName.type = 'submit';
    const cancelName = element('button','Cancel','quiet'); cancelName.type = 'button';
    const nameActions = element('div',null,'actions'); nameActions.append(saveName,cancelName);
    nameForm.append(nameLabel,nameInput,nameActions);
    rename.onclick = () => { nameForm.hidden = false; nameInput.focus(); nameInput.select(); };
    cancelName.onclick = () => { nameInput.value = b.label || ''; nameForm.hidden = true; rename.focus(); };
    nameForm.onsubmit = event => {
      event.preventDefault(); const name = nameInput.value;
      if (name.trim().length > 120) { status('Use at most 120 characters for the bookmark name.',true); return; }
      action(async () => { const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}`,'PATCH',{label:name}); await render(); status(r.message); });
    };
    const remove = element('button','Delete','quiet'); remove.setAttribute('aria-label',`Delete bookmark ${bookmarkName}`);
    remove.onclick = () => { if (confirm(`Delete bookmark “${bookmarkName}”?`)) action(async () => { const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}`,'DELETE'); await render(); status(r.message); }); };
    actions.append(resume,update,rename,remove); card.append(actions,nameForm); $('bookmarks').append(card);
  }
  updateResumeLinks();
}
$('save').onclick = () => action(async () => { status('Adding bookmark…'); const r = await api('/api/bookmarks/current','POST'); await render(); status(r.message); });
$('refresh-devices').onclick = () => action(async () => { status(''); const count = await refreshDevices(); status(count ? 'Choose where to play, then tap Resume.' : onIPhone ? 'Choose This iPhone and tap Resume to open Spotify, or refresh after opening Spotify on another device.' : 'No controllable devices are visible. Open Spotify, then refresh devices.'); });
$('playback-device').onchange = ()=>{status('');updateResumeLinks();};
document.addEventListener('visibilitychange',()=>{
  if (document.visibilityState==='visible' && sessionReady && !busy) {
    restorePendingCapture().then(()=>refreshDevices()).catch(error=>status(error.message,true));
  }
});
$('reconnect').onclick = () => { $('signin').hidden = false; $('setup-key').focus(); };
$('logout').onclick = () => action(async () => { await api('/api/logout','POST'); location.reload(); });
$('disconnect').onclick = () => {
  if (confirm('Disconnect Spotify and sign out of this bookmark app? Your bookmarks stay saved.')) action(async () => { await api('/api/disconnect','POST'); location.reload(); });
};
async function init() {
  $('phone-resume-help').hidden = !onIPhone;
  $('phone-recovery-help').hidden = !onIPhone;
  if (onIPhone) { $('playback-device').prepend(new Option('This iPhone',thisPhone)); $('playback-device').value=thisPhone; }
  try {
    const session = await api('/api/session'); csrf = session.csrf;
    sessionReady = true;
    $('library').hidden = false; $('signin').hidden = session.spotifyConnected;
    if (!session.spotifyConnected) status('Spotify needs to be reconnected. Your bookmarks are still here.',true);
    await render();
    await restorePendingCapture();
    try { await refreshDevices(); } catch (error) { status(error.message,true); }
  } catch (error) { $('signin').hidden = false; if (error.code !== 'sign_in') status(error.message,true); }
}
init();
