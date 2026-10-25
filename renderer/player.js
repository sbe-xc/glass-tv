// Full-window player with tvOS-style chrome, channel surfing and a channel drawer.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('player'), video: $('video'), chrome: $('player-chrome'),
    banner: $('banner'), bannerLogo: $('banner-logo'), bannerName: $('banner-name'), bannerSub: $('banner-sub'), bannerPos: $('banner-pos'),
    status: $('player-status'), statusText: $('status-text'),
    error: $('player-error'), errorSub: $('error-sub'), errorCountdown: $('error-countdown'),
    drawer: $('drawer'), drawerTitle: $('drawer-title'), drawerSearch: $('drawer-search'), drawerList: $('drawer-list'),
    back: $('back-btn'), list: $('list-btn'), fav: $('fav-btn'), mute: $('mute-btn'), fs: $('fs-btn'),
    errorNext: $('error-next'), errorRetry: $('error-retry'), errorBack: $('error-back'),
    audioLogo: $('audio-logo'), audioName: $('audio-name'),
  };

  const state = {
    open: false, list: [], index: -1, title: '', hls: null, token: 0,
    chromeTimer: null, bannerTimer: null, errorTimer: null, countdown: 0, drawerOpen: false,
    lastSurfAt: 0,
  };

  const CHROME_MS = 3500;
  const BANNER_MS = 4500;
  const AUTO_SKIP_S = 5;

  function current() { return state.list[state.index]; }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  }

  function logoNode(ch, big) {
    if (ch.logo) {
      const img = document.createElement('img');
      img.src = ch.logo; img.alt = '';
      img.onerror = () => { img.replaceWith(initialsNode(ch)); };
      return img;
    }
    return initialsNode(ch);
  }
  function initialsNode(ch) { const d = document.createElement('div'); d.className = 'card-initials'; d.textContent = initials(ch.name); return d; }

  // ---------- chrome visibility ----------
  function showChrome(sticky) {
    el.root.classList.add('chrome-visible');
    clearTimeout(state.chromeTimer);
    if (!sticky) state.chromeTimer = setTimeout(hideChrome, CHROME_MS);
  }
  function hideChrome() {
    if (state.drawerOpen || !el.error.classList.contains('hidden')) return;
    el.root.classList.remove('chrome-visible');
  }
  function flashBanner() {
    el.root.classList.add('banner-visible');
    clearTimeout(state.bannerTimer);
    state.bannerTimer = setTimeout(() => el.root.classList.remove('banner-visible'), BANNER_MS);
  }

  // ---------- status / errors ----------
  function setStatus(text) {
    if (!text) { el.status.classList.add('hidden'); return; }
    el.statusText.textContent = text;
    el.status.classList.remove('hidden');
  }
  function clearError() {
    el.error.classList.add('hidden');
    clearInterval(state.errorTimer);
    el.errorCountdown.textContent = '';
  }
  function showError(reason) {
    setStatus('');
    el.errorSub.textContent = reason || 'The stream may be offline or geo-blocked.';
    el.error.classList.remove('hidden');
    showChrome(true);
    // When surfing, auto-advance so dead streams don't stall the experience
    const surfing = Date.now() - state.lastSurfAt < 20000;
    clearInterval(state.errorTimer);
    if (surfing && state.list.length > 1) {
      state.countdown = AUTO_SKIP_S;
      const tick = () => {
        el.errorCountdown.textContent = `Skipping to the next channel in ${state.countdown}s`;
        if (state.countdown-- <= 0) { clearInterval(state.errorTimer); step(1); }
      };
      tick();
      state.errorTimer = setInterval(tick, 1000);
    }
  }

  // ---------- playback ----------
  function destroyHls() {
    if (state.hls) { try { state.hls.destroy(); } catch (_) {} state.hls = null; }
    el.video.removeAttribute('src');
    el.video.load();
  }

  async function play(ch) {
    const token = ++state.token;
    clearError();
    destroyHls();
    el.root.classList.remove('audio-only');
    setStatus('Tuning in…');
    updateBanner();
    flashBanner();
    showChrome();

    await window.glasstv.setStreamHeaders({ url: ch.url, userAgent: ch.userAgent, referrer: ch.referrer });
    if (token !== state.token) return;

    const isHls = /\.m3u8(\?|$)/i.test(ch.url) || !/\.(mp4|webm|mp3|aac|ts|mpd)(\?|$)/i.test(ch.url);

    if (isHls && window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 20,
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 2,
      });
      state.hls = hls;
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (token !== state.token) return;
        if (!data.fatal) return;
        const d = data.details || data.type;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !data._recovered) {
          data._recovered = true; try { hls.recoverMediaError(); return; } catch (_) {}
        }
        let reason = 'The stream may be offline or geo-blocked.';
        if (/manifest/i.test(d)) reason = 'Couldn’t load the stream manifest — it’s probably offline.';
        else if (/timeout/i.test(d)) reason = 'The stream timed out.';
        else if (/codec|media|buffer/i.test(d)) reason = 'This stream uses a codec that can’t be decoded here.';
        showError(reason);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (token === state.token) el.video.play().catch(() => {}); });
      hls.loadSource(ch.url);
      hls.attachMedia(el.video);
    } else {
      el.video.src = ch.url;
      el.video.play().catch(() => {});
    }
  }

  function checkAudioOnly() {
    const audioOnly = el.video.videoWidth === 0 && !el.video.paused;
    el.root.classList.toggle('audio-only', audioOnly);
    if (audioOnly) {
      const ch = current();
      el.audioLogo.replaceChildren(logoNode(ch));
      el.audioName.textContent = ch.name;
    }
  }
  el.video.addEventListener('playing', () => { setStatus(''); clearError(); setTimeout(checkAudioOnly, 1500); });
  el.video.addEventListener('loadedmetadata', () => setTimeout(checkAudioOnly, 500));
  el.video.addEventListener('waiting', () => { if (el.error.classList.contains('hidden')) setStatus('Buffering…'); });
  el.video.addEventListener('stalled', () => { if (el.error.classList.contains('hidden')) setStatus('Buffering…'); });
  el.video.addEventListener('error', () => {
    if (state.hls) return; // hls.js reports its own errors
    showError('This stream can’t be played here.');
  });

  // ---------- banner ----------
  function updateBanner() {
    const ch = current();
    if (!ch) return;
    el.bannerLogo.replaceChildren(logoNode(ch, true));
    el.bannerName.textContent = ch.name;
    const bits = [ch.countryName, ch.categories.filter((c) => c !== 'Other').join(' · ')];
    if (ch.quality) bits.push(ch.quality);
    el.bannerSub.textContent = bits.filter(Boolean).join('  ·  ');
    el.bannerPos.textContent = `${state.index + 1} / ${state.list.length}${state.title ? '  ·  ' + state.title : ''}`;
    const fav = window.App.isFavorite(ch);
    el.fav.classList.toggle('on', fav);
  }

  // ---------- surfing ----------
  function step(delta) {
    if (!state.list.length) return;
    state.lastSurfAt = Date.now();
    state.index = (state.index + delta + state.list.length) % state.list.length;
    const ch = current();
    window.App.addRecent(ch);
    play(ch);
    renderDrawer();
  }
  function jumpTo(i) {
    if (i < 0 || i >= state.list.length) return;
    state.index = i;
    state.lastSurfAt = 0;
    window.App.addRecent(current());
    play(current());
    renderDrawer();
  }

  // ---------- drawer ----------
  function renderDrawer() {
    if (!state.drawerOpen) return;
    const q = el.drawerSearch.value.trim().toLowerCase();
    el.drawerTitle.textContent = state.title || 'Channels';
    const frag = document.createDocumentFragment();
    state.list.forEach((ch, i) => {
      if (q && !ch.search.includes(q)) return;
      const item = document.createElement('div');
      item.className = 'drawer-item' + (i === state.index ? ' current' : '');
      item.dataset.index = i;
      const logo = document.createElement('div'); logo.className = 'drawer-logo'; logo.appendChild(logoNode(ch));
      const text = document.createElement('div'); text.style.minWidth = '0';
      const name = document.createElement('div'); name.className = 'drawer-name'; name.textContent = ch.name;
      const meta = document.createElement('div'); meta.className = 'drawer-meta'; meta.textContent = [ch.countryName, ch.quality].filter(Boolean).join(' · ');
      text.append(name, meta);
      const num = document.createElement('div'); num.className = 'drawer-num'; num.textContent = i + 1;
      item.append(logo, text, num);
      frag.appendChild(item);
    });
    el.drawerList.replaceChildren(frag);
    const cur = el.drawerList.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  function toggleDrawer(force) {
    state.drawerOpen = typeof force === 'boolean' ? force : !state.drawerOpen;
    el.drawer.classList.remove('hidden');
    requestAnimationFrame(() => el.drawer.classList.toggle('open', state.drawerOpen));
    if (state.drawerOpen) { renderDrawer(); showChrome(true); el.drawerSearch.focus(); }
    else { el.drawerSearch.blur(); showChrome(); }
  }
  el.drawerList.addEventListener('click', (e) => {
    const item = e.target.closest('.drawer-item');
    if (item) jumpTo(Number(item.dataset.index));
  });
  el.drawerSearch.addEventListener('input', renderDrawer);

  // ---------- open / close ----------
  function open(list, index, title) {
    state.list = list; state.index = index; state.title = title || '';
    state.open = true; state.lastSurfAt = 0;
    el.root.classList.remove('hidden');
    window.App.addRecent(current());
    play(current());
  }
  function close() {
    state.token++;
    state.open = false;
    destroyHls();
    clearError(); setStatus('');
    toggleDrawer(false);
    el.root.classList.add('hidden');
    window.App.onPlayerClosed(current());
  }

  function toggleMute() {
    el.video.muted = !el.video.muted;
    el.mute.classList.toggle('muted', el.video.muted);
    window.App.toast(el.video.muted ? 'Muted' : 'Sound on');
  }
  function toggleFavorite() {
    const ch = current(); if (!ch) return;
    const on = window.App.toggleFavorite(ch);
    el.fav.classList.toggle('on', on);
    window.App.toast(on ? 'Added to Favorites' : 'Removed from Favorites');
    showChrome();
  }

  // ---------- wiring ----------
  el.root.addEventListener('mousemove', () => showChrome());
  el.root.addEventListener('click', (e) => {
    if (e.target === el.video || e.target.classList.contains('player-vignette')) {
      if (state.drawerOpen) toggleDrawer(false); else showChrome();
    }
  });
  el.video.addEventListener('dblclick', () => window.glasstv.toggleFullscreen());
  el.back.addEventListener('click', close);
  el.list.addEventListener('click', () => toggleDrawer());
  el.fav.addEventListener('click', toggleFavorite);
  el.mute.addEventListener('click', toggleMute);
  el.fs.addEventListener('click', () => window.glasstv.toggleFullscreen());
  el.errorNext.addEventListener('click', () => step(1));
  el.errorRetry.addEventListener('click', () => play(current()));
  el.errorBack.addEventListener('click', close);

  function handleKey(e) {
    if (!state.open) return false;
    const typing = document.activeElement === el.drawerSearch;
    switch (e.key) {
      case 'Escape':
        if (state.drawerOpen) toggleDrawer(false); else close();
        return true;
      case 'ArrowUp': case 'PageUp': case 'ArrowRight':
        if (typing) return false; step(1); return true;
      case 'ArrowDown': case 'PageDown': case 'ArrowLeft':
        if (typing) return false; step(-1); return true;
      case ' ':
        if (typing) return false;
        if (el.video.paused) el.video.play().catch(() => {}); else el.video.pause();
        showChrome(); return true;
      case 'l': case 'L': if (typing) return false; toggleDrawer(); return true;
      case 'f': case 'F': if (typing) return false; toggleFavorite(); return true;
      case 'm': case 'M': if (typing) return false; toggleMute(); return true;
      case 'i': case 'I': if (typing) return false; showChrome(); flashBanner(); return true;
      case 'Enter': if (typing) { const first = el.drawerList.querySelector('.drawer-item'); if (first) jumpTo(Number(first.dataset.index)); return true; } return false;
      default: return false;
    }
  }

  window.Player = { open, close, handleKey, isOpen: () => state.open, refreshBanner: updateBanner };
})();
