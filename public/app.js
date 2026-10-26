const $ = id => document.getElementById(id);
let csrf = '';
let busy = false;
const onIPhone = /iPhone|iPod/.test(navigator.userAgent);
const thisPhone = 'this-iphone';
let deviceSnapshot = [];
let deviceSelectionVersion = 0;
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
  try { await task(); }
  catch (error) { status(error.message,true); if (['spotify_reconnect','invalid_grant','spotify_scopes'].includes(error.code)) $('signin').hidden = false; }
  finally { busy = false; document.querySelectorAll('button, #playback-device').forEach(b => b.disabled = false); }
}
function clearPhonePreparation() {
  deviceSelectionVersion++;
  document.querySelectorAll('.bookmark-phone').forEach(panel=>panel.hidden=true);
  status('');
}
function time(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function element(tag, text, cls) { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; }
async function refreshDevices() {
  const r = await api('/api/devices');
  let selected = $('playback-device').value;
  const selectedLabel = $('playback-device').selectedOptions[0]?.textContent || 'Selected device';
  deviceSnapshot = r.devices;
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
  return r.devices.length;
}
async function render() {
  const data = await api('/api/bookmarks');
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
    const resume = element('button','Resume','secondary'); resume.setAttribute('aria-label',`Resume ${bookmarkName}`);
    let preparePhone;
    resume.onclick = () => action(async () => {
      clearPhonePreparation();
      if (onIPhone && $('playback-device').value===thisPhone) { await preparePhone(); return; }
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
    const update = element('button','Update position','quiet'); update.setAttribute('aria-label',`Update position for ${bookmarkName}`);
    const updatePanel = element('div',null,'bookmark-update'); updatePanel.hidden = true;
    updatePanel.append(element('p',`Replace the saved audio and position for “${bookmarkName}” with Spotify’s current playing or paused item? Your bookmark name stays the same.`));
    const updateNow = element('button','Update now','secondary');
    updateNow.setAttribute('aria-label',`Confirm update for ${bookmarkName}`);
    const cancelUpdate = element('button','Cancel update','quiet');
    const updateActions = element('div',null,'actions'); updateActions.append(updateNow,cancelUpdate); updatePanel.append(updateActions);
    update.onclick = () => { updatePanel.hidden = false; updateNow.focus(); };
    cancelUpdate.onclick = () => { updatePanel.hidden = true; update.focus(); };
    updateNow.onclick = () => action(async () => { status('Updating bookmark…'); const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}/update`,'POST'); await render(); status(r.message); });
    const rename = element('button',b.label ? 'Rename' : 'Name','quiet'); rename.setAttribute('aria-label',`Name bookmark ${bookmarkName}`);
    const phonePanel = element('div',null,'bookmark-phone'); phonePanel.hidden = true;
    if (onIPhone) {
      const phoneInfo = element('p');
      const launch = element('a','Open Spotify & resume','phone-launch');
      launch.href = `spotify:${b.context_type==='episode' ? 'episode' : 'track'}:${encodeURIComponent(b.item_id)}`;
      const cancelPhone = element('button','Cancel','quiet');
      const phoneActions = element('div',null,'actions'); phoneActions.append(launch,cancelPhone);phonePanel.append(phoneInfo,phoneActions);
      let prepared;
      preparePhone = async()=>{
        await refreshDevices();
        const known = rememberedPhone();
        if (!known && deviceSnapshot.some(d=>d.type.toLowerCase()==='smartphone')) {
          phonePanel.hidden=true;
          status('Your phone is already available. Choose it by name under Where to play, then tap Resume.');
          $('playback-device').focus();return;
        }
        prepared = {at:Date.now(),selectionVersion:deviceSelectionVersion,body:{seenDeviceIds:deviceSnapshot.map(d=>d.id),...(known ? {deviceId:known.id} : {})}};
        phoneInfo.textContent = `Tap Open Spotify & resume${known?.name ? ` for ${known.name}` : ''}, then keep Spotify on the screen while this bookmark starts. You do not need to press Play first.`;
        phonePanel.hidden=false;launch.focus();status('Ready. Tap Open Spotify & resume below your selected bookmark.');
      };
      launch.onclick = event => {
        if (busy || !prepared || Date.now()-prepared.at>60000 || prepared.selectionVersion!==deviceSelectionVersion || $('playback-device').value!==thisPhone) {
          event.preventDefault();status('Choose This iPhone and tap Resume again to prepare a fresh request.');return;
        }
        const body = prepared.body;prepared=null;
        // Start the authenticated request before the link opens Spotify. Keepalive
        // plus the Worker's waitUntil protect it while Safari is backgrounded.
        action(async()=>{
          status('Opening Spotify. Keep it on the screen while your saved position resumes…');
          const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}/resume-on-phone`,'POST',body,true);
          rememberPhone(r.phone);phonePanel.hidden=true;status(r.message);
        });
      };
      cancelPhone.onclick = ()=>{prepared=null;phonePanel.hidden=true;status('');resume.focus();};
    }
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
    actions.append(resume,update,rename,remove); card.append(actions,phonePanel,updatePanel,nameForm); $('bookmarks').append(card);
  }
}
$('save').onclick = () => action(async () => { status('Adding bookmark…'); const r = await api('/api/bookmarks/current','POST'); await render(); status(r.message); });
$('refresh-devices').onclick = () => action(async () => { clearPhonePreparation(); const count = await refreshDevices(); status(count ? 'Choose where to play, then tap Resume.' : onIPhone ? 'Choose This iPhone and tap Resume to open Spotify, or refresh after opening Spotify on another device.' : 'No controllable devices are visible. Open Spotify, then refresh devices.'); });
$('playback-device').onchange = clearPhonePreparation;
$('reconnect').onclick = () => { $('signin').hidden = false; $('setup-key').focus(); };
$('logout').onclick = () => action(async () => { await api('/api/logout','POST'); location.reload(); });
$('disconnect').onclick = () => {
  if (confirm('Disconnect Spotify and sign out of this bookmark app? Your bookmarks stay saved.')) action(async () => { await api('/api/disconnect','POST'); location.reload(); });
};
async function init() {
  $('phone-resume-help').hidden = !onIPhone;
  if (onIPhone) { $('playback-device').prepend(new Option('This iPhone',thisPhone)); $('playback-device').value=thisPhone; }
  try {
    const session = await api('/api/session'); csrf = session.csrf;
    $('library').hidden = false; $('signin').hidden = session.spotifyConnected;
    if (!session.spotifyConnected) status('Spotify needs to be reconnected. Your bookmarks are still here.',true);
    await render();
    try { await refreshDevices(); } catch (error) { status(error.message,true); }
  } catch (error) { $('signin').hidden = false; if (error.code !== 'sign_in') status(error.message,true); }
}
init();
