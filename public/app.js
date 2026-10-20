const $ = id => document.getElementById(id);
let csrf = '';
let busy = false;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); }
async function api(path, method = 'GET') {
  const response = await fetch(path,{method,headers:method === 'GET' ? {} : {'X-CSRF-Token':csrf},cache:'no-store'});
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
async function render() {
  const data = await api('/api/bookmarks');
  $('bookmarks').replaceChildren(); $('empty').hidden = data.bookmarks.length !== 0;
  for (const b of data.bookmarks) {
    const card = element('article',null,'card');
    if (b.album_art_url && /^https:\/\/i\.scdn\.co\//.test(b.album_art_url)) {
      const img = element('img',null,'cover'); img.src = b.album_art_url; img.alt = `${b.album_name} album artwork`; img.loading = 'lazy'; card.append(img);
    } else { const placeholder = element('div','♪','cover'); placeholder.setAttribute('aria-hidden','true'); card.append(placeholder); }
    const info = element('div'); const title = element('h3'); const link = element('a',b.album_name);
    link.href = `https://open.spotify.com/album/${encodeURIComponent(b.album_id)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    title.append(link); info.append(title,element('p',b.artist_name),element('p',b.track_name),element('p',`${time(b.progress_ms)} / ${time(b.duration_ms)} · Disc ${b.disc_number}, track ${b.track_number}`,'position'));
    const saved = element('time',`Saved ${new Date(b.updated_at).toLocaleString()}`); saved.dateTime = new Date(b.updated_at).toISOString(); info.append(saved); card.append(info);
    const actions = element('div',null,'actions');
    const resume = element('button','Resume','secondary'); resume.setAttribute('aria-label',`Resume ${b.album_name}`);
    resume.onclick = () => action(async () => { status('Requesting playback…'); const r = await api(`/api/bookmarks/${b.album_id}/resume`,'POST'); status(r.message); });
    const remove = element('button','Delete','quiet'); remove.setAttribute('aria-label',`Delete bookmark for ${b.album_name}`);
    remove.onclick = () => { if (confirm(`Delete the bookmark for ${b.album_name}?`)) action(async () => { const r = await api(`/api/bookmarks/${b.album_id}`,'DELETE'); await render(); status(r.message); }); };
    actions.append(resume,remove); card.append(actions); $('bookmarks').append(card);
  }
}
async function credentialStatus() {
  const r = await api('/api/shortcut-credentials');
  $('credential-status').textContent = r.credentials.length ? `An active credential was created ${new Date(r.credentials[0].created_at).toLocaleString()}.` : 'No active Shortcut credential.';
}
function hideCredential() { $('credential').value = ''; $('credential-box').hidden = true; }
$('save').onclick = () => action(async () => { status('Saving your place…'); const r = await api('/api/bookmarks/current','POST'); await render(); status(r.message); });
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
