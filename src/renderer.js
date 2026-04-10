// ── State ──
let allChannels = [];
let favorites = new Set();
let activeGroup = 'All';
let currentChannel = null;
let hls = null;
let osdTimer = null;
let sidebarVisible = true;
let epgData = {};        // tvgId -> [{start, stop, title, desc}]
let favPanelOpen = false;
let epgPanelOpen = false;

const video = document.getElementById('video');
const placeholder = document.getElementById('placeholder');
const osd = document.getElementById('osd');

// ── Init ──
(async function init() {
  // Guard — if preload didn't load, show a clear error instead of cryptic crash
  if (!window.electronAPI) {
    document.body.innerHTML = '<div style="color:#fff;padding:40px;font-family:sans-serif;"><h2>Preload error</h2><p>window.electronAPI is undefined. The app was not packaged correctly.</p><p>Try: delete the dist/ folder and rebuild with <code>npm run build</code>.</p></div>';
    return;
  }

  // Apply platform class so CSS can adapt (e.g. hide custom titlebar on Windows)
  document.body.classList.add(window.electronAPI.platform);

  // Load saved favorites
  const saved = await window.electronAPI.loadData('favorites');
  if (saved) favorites = new Set(saved);

  // Load saved playlist URL and restore from cache instantly
  const savedURL = await window.electronAPI.loadData('last-url');
  if (savedURL) {
    document.getElementById('m3u-url').value = savedURL;
    const cached = await window.electronAPI.loadData('playlist-cache');
    if (cached && cached.length) {
      allChannels = unpackChannels(cached);
      setStatus('idle', `${allChannels.length} channels`);
      buildGroupTabs();
      renderChannels();
      renderFavorites();
    }
  }

  // Listen for file open from menu
  window.electronAPI.onOpenFile(async (filePath) => {
    await loadFromFile(filePath);
  });

  renderFavorites();
  setupVideoEvents();
  setupKeyboard();
})();

// ── Cache helpers ──
// Store as compact arrays [name, group, logo, url, tvgId, tvgName]
// instead of verbose objects — ~10x smaller on disk
function packChannels(channels) {
  return channels.map(c => [c.name, c.group, c.logo, c.url, c.tvgId, c.tvgName]);
}

function unpackChannels(packed) {
  return packed.map(c => ({
    name: c[0], group: c[1], logo: c[2], url: c[3], tvgId: c[4], tvgName: c[5]
  }));
}

// ── M3U Loading ──
async function loadPlaylist() {
  if (!window.electronAPI) { alert('Preload not loaded — please rebuild the app.'); return; }
  const url = document.getElementById('m3u-url').value.trim();
  if (!url) return;
  setStatus('loading', 'Loading…');
  try {
    const text = await window.electronAPI.fetchM3U(url);
    processM3U(text);
    await window.electronAPI.saveData('last-url', url);
    showToast('Playlist loaded');
  } catch (e) {
    setStatus('error', 'Failed: ' + e.message);
    showToast('Could not load playlist: ' + e.message);
  }
}

async function openFile() {
  const filePath = await window.electronAPI.openFileDialog();
  if (filePath) await loadFromFile(filePath);
}

async function loadFromFile(filePath) {
  setStatus('loading', 'Reading file…');
  try {
    const text = await window.electronAPI.readFile(filePath);
    processM3U(text);
    showToast('Playlist loaded from file');
  } catch (e) {
    setStatus('error', 'Failed to read file');
  }
}

function processM3U(text) {
  allChannels = parseM3U(text);
  if (!allChannels.length) {
    setStatus('error', 'No channels found');
    return;
  }
  window.electronAPI.saveData('playlist-cache', packChannels(allChannels));
  setStatus('idle', `${allChannels.length} channels`);
  activeGroup = 'All';
  buildGroupTabs();
  renderChannels();
  renderFavorites();
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const channels = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      cur = { name: '', group: 'General', logo: '', url: '', tvgId: '', tvgName: '' };
      const nameMatch = line.match(/,(.+)$/);
      if (nameMatch) cur.name = nameMatch[1].trim();
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      if (groupMatch) cur.group = groupMatch[1] || 'General';
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      if (logoMatch) cur.logo = logoMatch[1];
      const idMatch = line.match(/tvg-id="([^"]*)"/i);
      if (idMatch) cur.tvgId = idMatch[1];
      const nameTagMatch = line.match(/tvg-name="([^"]*)"/i);
      if (nameTagMatch) cur.tvgName = nameTagMatch[1];
    } else if (cur && !line.startsWith('#')) {
      cur.url = line;
      channels.push(cur);
      cur = null;
    }
  }
  return channels;
}

// ── Group tabs ──
function buildGroupTabs() {
  const groups = ['All', 'Favorites', ...new Set(allChannels.map(c => c.group))];
  document.getElementById('group-tabs').innerHTML = groups.map(g =>
    `<div class="gtab${g === activeGroup ? ' active' : ''}" data-group="${esc(g)}">${esc(g)}</div>`
  ).join('');
}

// Delegated listener for group tabs
document.getElementById('group-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-group]');
  if (tab) setGroup(tab.dataset.group);
});

function setGroup(g) {
  activeGroup = g;
  document.querySelectorAll('.gtab').forEach(el => {
    el.classList.toggle('active', el.dataset.group === g);
  });
  renderChannels();
}

// ── Channel list ──
function renderChannels() {
  const q = document.getElementById('search').value.toLowerCase();
  let list = allChannels;

  if (activeGroup === 'Favorites') {
    list = list.filter(c => favorites.has(c.name));
  } else if (activeGroup !== 'All') {
    list = list.filter(c => c.group === activeGroup);
  }
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q));

  const el = document.getElementById('channel-list');
  if (!list.length) {
    el.innerHTML = `<div class="list-empty">${allChannels.length ? 'No channels match.' : 'Load a playlist to get started.'}</div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const idx = allChannels.indexOf(c);
    const isFav = favorites.has(c.name);
    const isActive = currentChannel && currentChannel.name === c.name;
    const initials = c.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
    const logoHtml = c.logo
      ? `<img src="${esc(c.logo)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><span style="display:none">${initials}</span>`
      : initials;
    return `<div class="ch-item${isActive ? ' active' : ''}" id="chi-${idx}" data-idx="${idx}">
      <div class="ch-thumb">${logoHtml}</div>
      <div class="ch-meta">
        <div class="ch-name">${esc(c.name)}</div>
        <div class="ch-group">${esc(c.group)}</div>
      </div>
      <button class="fav-btn${isFav ? ' starred' : ''}" data-fav-idx="${idx}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '★' : '☆'}</button>
    </div>`;
  }).join('');
}

// Single delegated listener on channel list (set up once)
document.getElementById('channel-list').addEventListener('click', (e) => {
  // Fav button click
  const favBtn = e.target.closest('[data-fav-idx]');
  if (favBtn) {
    e.stopPropagation();
    toggleFav(parseInt(favBtn.dataset.favIdx));
    return;
  }
  // Channel row click
  const row = e.target.closest('[data-idx]');
  if (row) playChannel(parseInt(row.dataset.idx));
});

document.getElementById('channel-list').addEventListener('dblclick', (e) => {
  const row = e.target.closest('[data-idx]');
  if (row) toggleFullscreen();
});

// ── Playback ──
function playChannel(idx) {
  const ch = allChannels[idx];
  if (!ch) return;
  currentChannel = ch;

  // Update sidebar active state
  document.querySelectorAll('.ch-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('chi-' + idx);
  if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }

  // Update UI
  placeholder.style.display = 'none';
  document.getElementById('now-playing').innerHTML = `<strong>${esc(ch.name)}</strong> · ${esc(ch.group)}`;
  document.getElementById('osd-ch-name').textContent = ch.name;
  document.getElementById('osd-live-badge').style.display = 'inline-block';
  document.title = `${ch.name} — IPTV Player`;
  document.getElementById('titlebar-text').textContent = ch.name;

  startStream(ch.url);
  updateEPGPanel(ch);
}

function startStream(url) {
  if (hls) { hls.destroy(); hls = null; }
  video.src = '';
  setStatus('loading', 'Connecting…');
  updatePlayBtn(false);
  document.getElementById('seek-wrap').style.display = 'none';
  document.getElementById('seek-slider').value = 0;

  const isHLS = /\.m3u8|hls/i.test(url) || !url.includes('.');

  if (isHLS && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      setStatus('live', 'Live');
      updatePlayBtn(true);
    });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) {
        setStatus('error', 'Stream error');
        updatePlayBtn(false);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    video.src = url;
    video.play().catch(() => {});
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

function stopStream() {
  if (hls) { hls.destroy(); hls = null; }
  video.src = '';
  video.pause();
  currentChannel = null;
  placeholder.style.display = 'flex';
  document.getElementById('now-playing').textContent = 'No channel selected';
  document.getElementById('titlebar-text').textContent = 'IPTV Player';
  document.title = 'IPTV Player';
  setStatus('idle', 'Idle');
  updatePlayBtn(false);
}

// ── Video events ──
function setupVideoEvents() {
  video.addEventListener('play', () => { updatePlayBtn(true); setStatus('live', 'Live'); });
  video.addEventListener('pause', () => { updatePlayBtn(false); if (currentChannel) setStatus('idle', 'Paused'); });
  video.addEventListener('waiting', () => setStatus('loading', 'Buffering…'));
  video.addEventListener('canplay', () => { if (currentChannel) setStatus('live', 'Live'); });
  video.addEventListener('error', () => { setStatus('error', 'Stream failed'); updatePlayBtn(false); });

  // Seek bar — show for VOD, hide for live
  video.addEventListener('durationchange', () => {
    const seekWrap = document.getElementById('seek-wrap');
    if (video.duration && isFinite(video.duration)) {
      seekWrap.style.display = 'flex';
      document.getElementById('seek-duration').textContent = fmtSecs(video.duration);
    } else {
      seekWrap.style.display = 'none';
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!video.duration || !isFinite(video.duration)) return;
    const pct = (video.currentTime / video.duration) * 100;
    document.getElementById('seek-slider').value = pct;
    document.getElementById('seek-current').textContent = fmtSecs(video.currentTime);
  });

  // OSD mouse tracking on video
  const wrap = document.getElementById('video-wrap');
  wrap.addEventListener('mousemove', showOSD);
  wrap.addEventListener('mouseleave', hideOSD);
  wrap.addEventListener('click', () => { if (currentChannel) togglePlay(); });
}

function showOSD() {
  if (!currentChannel) return;
  osd.classList.add('visible');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(hideOSD, 3000);
}
function hideOSD() {
  osd.classList.remove('visible');
}

// ── Controls ──
function togglePlay() {
  if (!currentChannel) return;
  if (video.paused) video.play();
  else video.pause();
}

function updatePlayBtn(playing) {
  document.getElementById('play-icon').setAttribute('d', '');
  const icon = document.getElementById('play-icon');
  if (playing) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }
}

function toggleMute() {
  video.muted = !video.muted;
  updateVolIcon();
}

function setVolume(v) {
  video.volume = v / 100;
  video.muted = (v == 0);
  document.getElementById('vol-val').textContent = v + '%';
  updateVolIcon();
}

function updateVolIcon() {
  const icon = document.getElementById('vol-icon');
  const lines = document.getElementById('vol-lines');
  if (video.muted || video.volume === 0) {
    if (lines) lines.setAttribute('d', 'M23 9l-6 6M17 9l6 6');
  } else {
    if (lines) lines.setAttribute('d', 'M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.getElementById('video-wrap').requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function seekTo(pct) {
  if (video.duration && isFinite(video.duration)) {
    video.currentTime = (pct / 100) * video.duration;
  }
}

function fmtSecs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// ── Sidebar ──
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  document.getElementById('sidebar').classList.toggle('collapsed', !sidebarVisible);
  document.getElementById('toggle-sidebar-btn').classList.toggle('active', !sidebarVisible);
}

// ── Favorites ──
function toggleFav(idx) {
  const ch = allChannels[idx];
  if (!ch) return;
  if (favorites.has(ch.name)) {
    favorites.delete(ch.name);
    showToast(`Removed "${ch.name}" from favorites`);
  } else {
    favorites.add(ch.name);
    showToast(`Added "${ch.name}" to favorites`);
  }
  window.electronAPI.saveData('favorites', [...favorites]);
  renderChannels();
  renderFavorites();
}

function renderFavorites() {
  const list = allChannels.filter(c => favorites.has(c.name));
  const el = document.getElementById('fav-list');
  if (!list.length) {
    el.innerHTML = '<div class="list-empty">No favorites yet.<br/><span class="hint">Hover a channel and click ☆</span></div>';
    return;
  }
  el.innerHTML = list.map(c => {
    const idx = allChannels.indexOf(c);
    const initials = c.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
    return `<div class="fav-item" data-idx="${idx}">
      <div class="ch-thumb" style="width:28px;height:28px;font-size:10px">${initials}</div>
      <span class="fav-name">${esc(c.name)}</span>
      <button class="fav-remove" data-fav-idx="${idx}" title="Remove">✕</button>
    </div>`;
  }).join('');
}

// Delegated listener for favorites panel
document.getElementById('fav-list').addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-fav-idx]');
  if (removeBtn) {
    e.stopPropagation();
    toggleFav(parseInt(removeBtn.dataset.favIdx));
    return;
  }
  const row = e.target.closest('[data-idx]');
  if (row) playChannel(parseInt(row.dataset.idx));
});

function toggleFavPanel() {
  favPanelOpen = !favPanelOpen;
  document.getElementById('fav-panel').classList.toggle('hidden', !favPanelOpen);
  document.getElementById('toggle-fav-btn').classList.toggle('active', favPanelOpen);
  if (epgPanelOpen && favPanelOpen) { epgPanelOpen = false; document.getElementById('epg-panel').classList.add('hidden'); document.getElementById('toggle-epg-btn').classList.remove('active'); }
}

// ── EPG ──
function toggleEpgPanel() {
  epgPanelOpen = !epgPanelOpen;
  document.getElementById('epg-panel').classList.toggle('hidden', !epgPanelOpen);
  document.getElementById('toggle-epg-btn').classList.toggle('active', epgPanelOpen);
  if (favPanelOpen && epgPanelOpen) { favPanelOpen = false; document.getElementById('fav-panel').classList.add('hidden'); document.getElementById('toggle-fav-btn').classList.remove('active'); }
  if (epgPanelOpen && currentChannel) updateEPGPanel(currentChannel);
}

async function loadEPG() {
  const url = document.getElementById('epg-url').value.trim();
  if (!url) return;
  const el = document.getElementById('epg-content');
  el.innerHTML = '<div class="list-empty">Loading EPG…</div>';
  try {
    const text = await window.electronAPI.fetchM3U(url); // reuse http fetch
    parseXMLTV(text);
    showToast('EPG loaded');
    if (currentChannel) updateEPGPanel(currentChannel);
  } catch (e) {
    el.innerHTML = `<div class="list-empty">Failed to load EPG: ${esc(e.message)}</div>`;
  }
}

function parseXMLTV(xml) {
  epgData = {};
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const programmes = doc.querySelectorAll('programme');
  programmes.forEach(prog => {
    const channel = prog.getAttribute('channel');
    const start = parseXMLTVDate(prog.getAttribute('start'));
    const stop = parseXMLTVDate(prog.getAttribute('stop'));
    const title = prog.querySelector('title')?.textContent || '';
    const desc = prog.querySelector('desc')?.textContent || '';
    if (!epgData[channel]) epgData[channel] = [];
    epgData[channel].push({ start, stop, title, desc });
  });
}

function parseXMLTVDate(str) {
  if (!str) return null;
  // Format: 20240101123000 +0000
  const m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

function updateEPGPanel(ch) {
  if (!epgPanelOpen) return;
  const el = document.getElementById('epg-content');
  const tvgId = ch.tvgId || ch.tvgName || ch.name;
  const programmes = epgData[tvgId] || epgData[ch.name] || [];

  if (!programmes.length) {
    el.innerHTML = `<div class="list-empty">No guide data for <strong>${esc(ch.name)}</strong>.<br/>Load an XMLTV EPG above.</div>`;
    return;
  }

  const now = new Date();
  const entries = programmes.filter(p => p.stop > now || !p.stop).slice(0, 20);

  el.innerHTML = entries.map(p => {
    const isNow = p.start <= now && p.stop > now;
    const timeStr = p.start ? `${fmtTime(p.start)} – ${fmtTime(p.stop)}` : '';
    let progressHtml = '';
    if (isNow && p.start && p.stop) {
      const pct = Math.round(((now - p.start) / (p.stop - p.start)) * 100);
      progressHtml = `<div class="epg-progress"><div class="epg-progress-bar" style="width:${pct}%"></div></div>`;
    }
    return `<div class="epg-entry${isNow ? ' now' : ''}">
      <div class="epg-time">${timeStr}${isNow ? '<span class="epg-badge">NOW</span>' : ''}</div>
      <div class="epg-title">${esc(p.title)}</div>
      ${p.desc ? `<div class="epg-desc">${esc(p.desc.slice(0, 120))}${p.desc.length > 120 ? '…' : ''}</div>` : ''}
      ${progressHtml}
    </div>`;
  }).join('');
}

function fmtTime(d) {
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Status ──
function setStatus(state, msg) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  dot.className = 'dot ' + state;
  txt.textContent = msg;
}

// ── Keyboard shortcuts ──
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT') return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustVolume(5);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustVolume(-5);
        break;
      case 'ArrowRight':
        navigateChannel(1);
        break;
      case 'ArrowLeft':
        navigateChannel(-1);
        break;
      case 'b':
      case 'B':
        if (e.metaKey) { e.preventDefault(); toggleSidebar(); }
        break;
      case 'Escape':
        if (document.fullscreenElement) document.exitFullscreen();
        break;
    }
  });
}

function adjustVolume(delta) {
  const slider = document.getElementById('vol-slider');
  const newVal = Math.max(0, Math.min(100, parseInt(slider.value) + delta));
  slider.value = newVal;
  setVolume(newVal);
}

function navigateChannel(dir) {
  if (!currentChannel) return;
  const idx = allChannels.indexOf(currentChannel);
  if (idx === -1) return;
  const next = (idx + dir + allChannels.length) % allChannels.length;
  playChannel(next);
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Util ──
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
