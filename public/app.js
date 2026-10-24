const $ = id => document.getElementById(id);
let csrf = '';
let busy = false;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); }
async function api(path, method = 'GET', body) {
  const response = await fetch(path,{method,headers:method === 'GET' ? {} : {'X-CSRF-Token':csrf,...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),cache:'no-store'});
  let data;
  try { data = await response.json(); } catch { throw new Error('The service returned an unreadable response. Try again.'); }
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'),{code:data.code});
  return data;
}
async function action(task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await task(); }
  catch (error) { status(error.message,true); if (['spotify_reconnect','invalid_grant','spotify_scopes'].includes(error.code)) $('signin').hidden = false; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function time(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function element(tag, text, cls) { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; }
async function refreshDevices() {
  const selected = $('playback-device').value;
  const r = await api('/api/devices');
  const options = [new Option('Active Spotify device','')];
  for (const d of r.devices) options.push(new Option(`${d.name}${d.isActive ? ' (active)' : ''}`,d.id));
  $('playback-device').replaceChildren(...options);
  if (r.devices.some(d => d.id === selected)) $('playback-device').value = selected;
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
    const info = element('div'); const title = element('h3'); const link = element('a',b.context_name);
    const kind = ['album','playlist','episode'].includes(b.context_type) ? b.context_type : 'album';
    link.href = `https://open.spotify.com/${kind}/${encodeURIComponent(b.context_id)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    title.append(link); info.append(element('p',kind === 'episode' ? 'Podcast episode' : kind === 'playlist' ? 'Playlist' : 'Album','eyebrow'),title,element('p',b.creator_name));
    if (kind !== 'episode') info.append(element('p',b.item_name));
    const trackPosition = kind === 'album' && b.disc_number && b.track_number ? ` · Disc ${b.disc_number}, track ${b.track_number}` : '';
    info.append(element('p',`${time(b.progress_ms)} / ${time(b.duration_ms)}${trackPosition}`,'position'));
    const saved = element('time',`Saved ${new Date(b.updated_at).toLocaleString()}`); saved.dateTime = new Date(b.updated_at).toISOString(); info.append(saved); card.append(info);
    const actions = element('div',null,'actions');
    const resume = element('button','Resume','secondary'); resume.setAttribute('aria-label',`Resume ${b.context_name}`);
    resume.onclick = () => action(async () => {
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
    const remove = element('button','Delete','quiet'); remove.setAttribute('aria-label',`Delete bookmark for ${b.context_name}`);
    remove.onclick = () => { if (confirm(`Delete the bookmark for ${b.context_name}?`)) action(async () => { const r = await api(`/api/bookmarks/${encodeURIComponent(b.bookmark_id)}`,'DELETE'); await render(); status(r.message); }); };
    actions.append(resume,remove); card.append(actions); $('bookmarks').append(card);
  }
}
async function credentialStatus() {
  const r = await api('/api/shortcut-credentials');
  $('credential-status').textContent = r.credentials.length ? `An active credential was created ${new Date(r.credentials[0].created_at).toLocaleString()}.` : 'No active Shortcut credential.';
}
function hideCredential() { $('credential').value = ''; $('credential-box').hidden = true; }
$('save').onclick = () => action(async () => { status('Saving your place…'); const r = await api('/api/bookmarks/current','POST'); await render(); status(r.message); });
$('refresh-devices').onclick = () => action(async () => { const count = await refreshDevices(); status(count ? 'Choose where to play, then tap a saved place’s Resume button.' : 'No controllable devices are visible. Open Spotify, then refresh devices.'); });
$('create-key').onclick = () => {
  if (!confirm('Create a new credential? Any existing Shortcut credential will stop working.')) return;
  action(async () => { const r = await api('/api/shortcut-credentials','POST'); $('credential').value = r.credential; $('credential-box').hidden = false; await credentialStatus(); status(r.message); });
};
$('revoke-key').onclick = () => {
  if (confirm('Revoke your Shortcut credential? The Shortcut will stop saving bookmarks.')) action(async () => { const r = await api('/api/shortcut-credentials','DELETE'); hideCredential(); await credentialStatus(); status(r.message); });
};
$('hide-key').onclick = hideCredential;
$('reconnect').onclick = () => { $('signin').hidden = false; $('setup-key').focus(); };
$('logout').onclick = () => action(async () => { await api('/api/logout','POST'); location.reload(); });
$('disconnect').onclick = () => {
  if (confirm('Remove stored Spotify credentials, end all web sessions, and revoke Shortcut access? Bookmarks will stay saved.')) action(async () => { await api('/api/disconnect','POST'); location.reload(); });
};
document.addEventListener('visibilitychange',() => { if (document.hidden) hideCredential(); });
window.addEventListener('pagehide',hideCredential);
async function init() {
  $('endpoint').textContent = `${location.origin}/api/bookmarks/current`;
  try {
    const session = await api('/api/session'); csrf = session.csrf;
    $('library').hidden = false; $('signin').hidden = session.spotifyConnected;
    if (!session.spotifyConnected) status('Spotify needs to be reconnected. Your bookmarks are still here.',true);
    await render(); await credentialStatus();
  } catch (error) { $('signin').hidden = false; if (error.code !== 'sign_in') status(error.message,true); }
}
init();
