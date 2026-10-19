// TV remote (D-pad) support for the Android build. Loaded after renderer.js and
// reuses its globals (playChannel, togglePlay, currentChannel, video, ...).
(function () {
  const FOCUSABLE = [
    '#titlebar .tb-btn',
    '.playlist-row input', '.playlist-row button',
    '.gtab', '#search', '.ch-item', '#video-wrap',
    '#controls .ctrl-btn',
    '#fav-panel:not(.hidden) .panel-close', '#fav-panel:not(.hidden) .fav-item',
    '#epg-panel:not(.hidden) .panel-close', '#epg-panel:not(.hidden) input', '#epg-panel:not(.hidden) button',
  ].join(',');
  const SCROLLERS = '#channel-list, #group-tabs, #fav-list, #epg-content';
  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  let watching = false;
  let hintShown = false;

  // ── Watch mode (full screen video) ──
  // requestFullscreen() isn't available in a plain WebView, so the video is
  // expanded with CSS instead. renderer.js calls this global on double-click too.
  window.toggleFullscreen = () => setWatching(!watching);

  function setWatching(on) {
    if (on && !currentChannel) return;
    watching = on;
    document.body.classList.toggle('tv-watch', on);
    if (on) {
      if (document.activeElement) document.activeElement.blur();
      showOSD();
    } else {
      hideOSD();
      focusDefault();
    }
  }

  function stepChannel(dir) {
    const rows = [...document.querySelectorAll('#channel-list .ch-item')];
    const cur = rows.findIndex(r => r.classList.contains('active'));
    if (cur === -1 || rows.length < 2) navigateChannel(dir);
    else playChannel(parseInt(rows[(cur + dir + rows.length) % rows.length].dataset.idx));
    showOSD();
  }

  function seekBy(secs) {
    if (!video.duration || !isFinite(video.duration)) { showOSD(); return; }
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + secs));
    showToast(`${fmtSecs(video.currentTime)} / ${fmtSecs(video.duration)}`);
  }

  function handleWatchKey(dir, enter) {
    if (enter) { togglePlay(); showOSD(); }
    else if (dir === 'up') stepChannel(-1);
    else if (dir === 'down') stepChannel(1);
    else if (dir === 'left') seekBy(-10);
    else if (dir === 'right') seekBy(10);
  }

  // Mirror the status pill (Buffering…, Stream error) into the OSD while watching.
  const osdStatus = document.createElement('span');
  osdStatus.id = 'osd-tv-status';
  document.getElementById('osd-top').appendChild(osdStatus);
  new MutationObserver(() => {
    osdStatus.textContent = document.getElementById('status-text').textContent;
    if (watching) showOSD();
  }).observe(document.getElementById('status-text'), { childList: true, characterData: true, subtree: true });

  // ── Spatial navigation ──
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    const scroller = el.closest(SCROLLERS);
    if (scroller && scroller !== el) {
      const s = scroller.getBoundingClientRect();
      if (r.bottom <= s.top || r.top >= s.bottom || r.right <= s.left || r.left >= s.right) return false;
    }
    return true;
  }

  function focusEl(el) {
    if (!el) return false;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function focusDefault() {
    focusEl(document.querySelector('#channel-list .ch-item.active')
      || document.querySelector('#channel-list .ch-item')
      || document.getElementById('m3u-url'));
  }

  function geoMove(from, dir) {
    const a = from.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      if (el === from || from.contains(el) || el.contains(from) || !visible(el)) continue;
      const b = el.getBoundingClientRect();
      let main, gap, offset;
      if (dir === 'left' || dir === 'right') {
        main = dir === 'right' ? b.left - a.right : a.left - b.right;
        gap = Math.max(0, b.top - a.bottom, a.top - b.bottom);
        offset = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2;
      } else {
        main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        gap = Math.max(0, b.left - a.right, a.left - b.right);
        offset = Math.abs((b.left + b.right) - (a.left + a.right)) / 2;
      }
      if (main < -2) continue;
      const score = main + gap * 3 + offset * 0.1;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return focusEl(best);
  }

  function move(dir) {
    const el = document.activeElement;
    if (!el || el === document.body || !visible(el)) { focusDefault(); return; }

    // Star button inside a channel row
    if (el.classList.contains('fav-btn')) {
      const row = el.closest('.ch-item');
      if (dir === 'left') return focusEl(row);
      if (dir === 'right') return geoMove(row, dir);
      const sib = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
      if (sib) return focusEl(sib.querySelector('.fav-btn') || sib);
      return geoMove(row, dir);
    }

    const row = el.closest('.ch-item, .fav-item');
    if (row && (dir === 'up' || dir === 'down')) {
      const sib = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
      if (sib && sib.matches('.ch-item, .fav-item')) return focusEl(sib);
    }
    if (row && row.classList.contains('ch-item') && dir === 'right') {
      return focusEl(row.querySelector('.fav-btn'));
    }
    if (el.classList.contains('gtab') && (dir === 'left' || dir === 'right')) {
      const sib = dir === 'right' ? el.nextElementSibling : el.previousElementSibling;
      if (sib) return focusEl(sib);
    }
    geoMove(el, dir);
  }

  function pageRows(dir) {
    const el = document.activeElement;
    let row = el && el.closest('.ch-item, .fav-item');
    if (!row) { focusDefault(); return; }
    for (let i = 0; i < 10; i++) {
      const sib = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
      if (!sib || !sib.matches('.ch-item, .fav-item')) break;
      row = sib;
    }
    focusEl(row);
  }

  // ── Activation ──
  function editInput(el) {
    const v = prompt(el.placeholder || 'Enter value', el.value);
    if (v === null) return;
    el.value = v.trim();
    if (el.id === 'm3u-url') loadPlaylist();
    else if (el.id === 'epg-url') loadEPG();
    else if (el.id === 'search') renderChannels();
  }

  // Lists are re-rendered with innerHTML, so restore focus to the same item afterwards.
  function focusKey(el) {
    if (el.id) return '#' + el.id;
    const scroller = el.closest(SCROLLERS);
    const scope = scroller ? '#' + scroller.id + ' ' : '';
    if (el.dataset.favIdx) return `${scope}[data-fav-idx="${el.dataset.favIdx}"]`;
    if (el.dataset.idx) return `${scope}[data-idx="${el.dataset.idx}"]`;
    return null;
  }

  function restoreFocus(key) {
    setTimeout(() => {
      const cur = document.activeElement;
      if (cur && cur !== document.body && document.contains(cur)) return;
      const el = key && document.querySelector(key);
      if (el) focusEl(el);
      else focusDefault();
    });
  }

  function activate(el) {
    if (!el || el === document.body) { focusDefault(); return; }
    if (el.tagName === 'INPUT' && el.type === 'text') { editInput(el); return; }
    if (el.id === 'video-wrap') { setWatching(true); return; }
    if (el.classList.contains('ch-item') && el.classList.contains('active') && currentChannel) {
      setWatching(true);
      return;
    }
    const key = focusKey(el);
    el.click();
    restoreFocus(key);
    if (el.classList.contains('ch-item') && !hintShown) {
      hintShown = true;
      setTimeout(() => showToast('Press OK again for full screen'), 2600);
    }
  }

  function toggleFavFocused() {
    const el = document.activeElement;
    const row = el && el.closest('[data-idx]');
    const idx = row ? parseInt(row.dataset.idx) : allChannels.indexOf(currentChannel);
    if (idx < 0) return;
    const key = el && el !== document.body ? focusKey(el) : null;
    toggleFav(idx);
    if (key) restoreFocus(key);
  }

  // ── Key handling ──
  // Capture phase on window runs before renderer.js's document listener, whose
  // arrow-key shortcuts (volume / channel) would otherwise break D-pad navigation.
  window.addEventListener('keydown', (e) => {
    const dir = DIRS[e.key];
    const enter = e.key === 'Enter' || e.keyCode === 13;
    if (!dir && !enter) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (watching) handleWatchKey(dir, enter);
    else if (enter) activate(document.activeElement);
    else move(dir);
  }, true);

  // Called by MainActivity for media / channel / menu buttons.
  window.__onRemoteKey = (name) => {
    switch (name) {
      case 'playpause': togglePlay(); if (watching) showOSD(); break;
      case 'play': if (currentChannel) video.play(); break;
      case 'pause': video.pause(); break;
      case 'stop': setWatching(false); stopStream(); break;
      case 'chup': watching || !document.activeElement.closest('.ch-item, .fav-item') ? stepChannel(-1) : pageRows(-1); break;
      case 'chdown': watching || !document.activeElement.closest('.ch-item, .fav-item') ? stepChannel(1) : pageRows(1); break;
      case 'ff': seekBy(30); break;
      case 'rew': seekBy(-30); break;
      case 'menu': toggleFavFocused(); break;
      case 'guide': if (watching) setWatching(false); toggleEpgPanel(); break;
    }
  };

  // Called by MainActivity on the Back button. Return true if handled;
  // otherwise the app asks for a second press to exit.
  window.__onBack = () => {
    if (watching) { setWatching(false); return true; }
    if (favPanelOpen) { toggleFavPanel(); focusDefault(); return true; }
    if (epgPanelOpen) { toggleEpgPanel(); focusDefault(); return true; }
    if (!sidebarVisible) { toggleSidebar(); return true; }
    return false;
  };

  setTimeout(focusDefault, 300);
})();
