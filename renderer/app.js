// Browse UI: Watch Now / Categories / Countries / Favorites / Search, with tvOS-style spatial focus navigation.
(function () {
  const $ = (id) => document.getElementById(id);
  const content = $('content');
  const tabsEl = $('tabs');

  const state = {
    channels: [], categories: [], countries: [],
    byId: new Map(),
    view: 'home', // home | categories | countries | favorites | search | list
    listCtx: null, // { title, channels, backView }
    favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
    recents: JSON.parse(localStorage.getItem('recents') || '[]'), // tvgId|name keys
    focusEl: null,
    searchQuery: '',
    lastPlayedKey: null,
  };

  const key = (ch) => ch.tvgId ? ch.tvgId : 'name:' + ch.name;
  const persist = () => {
    localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
    localStorage.setItem('recents', JSON.stringify(state.recents.slice(0, 30)));
  };

  // ---------- helpers ----------
  function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'; }
  function h(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 1600);
  }

  function isFavorite(ch) { return state.favorites.has(key(ch)); }
  function toggleFavorite(ch) {
    const k = key(ch);
    if (state.favorites.has(k)) state.favorites.delete(k); else state.favorites.add(k);
    persist();
    document.querySelectorAll(`.card[data-key="${CSS.escape(k)}"] .card-fav`).forEach((b) => b.classList.toggle('on', state.favorites.has(k)));
    return state.favorites.has(k);
  }
  function addRecent(ch) {
    const k = key(ch);
    state.recents = [k, ...state.recents.filter((x) => x !== k)].slice(0, 30);
    state.lastPlayedKey = k;
    persist();
  }
  function resolveKeys(keys) { return keys.map((k) => state.byId.get(k)).filter(Boolean); }

  // ---------- card ----------
  function channelCard(ch, list, index, listTitle) {
    const card = h('div', 'card' + (ch.logo ? ' has-logo' : ''));
    card.tabIndex = -1; card.dataset.key = key(ch);
    if (ch.logo) {
      const bg = h('div', 'card-bg'); bg.style.backgroundImage = `url("${ch.logo}")`; card.appendChild(bg);
      const logo = h('div', 'card-logo'); const img = document.createElement('img'); img.loading = 'lazy'; img.src = ch.logo; img.alt = '';
      img.onerror = () => { card.classList.remove('has-logo'); logo.replaceWith(h('div', 'card-initials', initials(ch.name))); };
      logo.appendChild(img); card.appendChild(logo);
    } else {
      card.appendChild(h('div', 'card-initials', initials(ch.name)));
    }
    const footer = h('div', 'card-footer');
    const text = h('div'); text.style.minWidth = '0';
    text.append(h('div', 'card-name', ch.name), h('div', 'card-meta', [ch.countryName, ch.categories.filter((c) => c !== 'Other')[0]].filter(Boolean).join(' · ')));
    footer.appendChild(text);
    if (ch.quality) footer.appendChild(h('div', 'card-badge', ch.quality.toUpperCase()));
    card.appendChild(footer);

    const fav = h('button', 'card-fav' + (isFavorite(ch) ? ' on' : ''));
    fav.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z"/></svg>';
    fav.title = 'Favorite';
    fav.addEventListener('click', (e) => { e.stopPropagation(); const on = toggleFavorite(ch); toast(on ? 'Added to Favorites' : 'Removed from Favorites'); if (state.view === 'favorites' && !on) render(); });
    card.appendChild(fav);

    card.addEventListener('click', () => Player.open(list, index, listTitle));
    card.addEventListener('mouseenter', () => setFocus(card, false));
    return card;
  }

  function cardRow(title, channels, opts = {}) {
    const row = h('section', 'row');
    const head = h('div', 'row-head');
    head.appendChild(h('div', 'row-title', title));
    if (opts.seeAll) { const link = h('button', 'row-link', `See all ${channels.length} ›`); link.addEventListener('click', opts.seeAll); head.appendChild(link); }
    row.appendChild(head);
    const scroller = h('div', 'row-scroller');
    const shown = channels.slice(0, opts.limit || 24);
    shown.forEach((ch, i) => scroller.appendChild(channelCard(ch, channels, i, title)));
    row.appendChild(scroller);
    return row;
  }

  function grid(channels, title) {
    const g = h('div', 'grid');
    const frag = document.createDocumentFragment();
    const CHUNK = 120;
    let i = 0;
    const renderChunk = () => {
      const end = Math.min(i + CHUNK, channels.length);
      for (; i < end; i++) frag.appendChild(channelCard(channels[i], channels, i, title));
      g.appendChild(frag);
      if (i < channels.length) requestAnimationFrame(renderChunk);
    };
    renderChunk();
    return g;
  }

  // ---------- views ----------
  function pickFeatured() {
    const recent = resolveKeys(state.recents)[0];
    if (recent) return { ch: recent, kicker: 'Continue watching', list: resolveKeys(state.recents), title: 'Recently watched' };
    const pool = state.channels.filter((c) => c.logo && c.quality && /1080p|720p/.test(c.quality) && c.categories.some((g) => ['News', 'Entertainment', 'Music', 'Documentary'].includes(g)));
    const ch = pool[Math.floor(Math.random() * pool.length)] || state.channels[0];
    const cat = state.categories.find((c) => c.name === ch.categories[0]);
    return { ch, kicker: 'Featured', list: cat ? cat.channels : state.channels, title: cat ? cat.name : 'All channels' };
  }

  function renderHome() {
    const frag = document.createDocumentFragment();
    const f = pickFeatured();
    if (f.ch) {
      const hero = h('div', 'hero'); hero.tabIndex = -1;
      if (f.ch.logo) { const bg = h('div', 'hero-bg'); bg.style.backgroundImage = `url("${f.ch.logo}")`; hero.appendChild(bg); }
      const text = h('div', 'hero-text');
      text.append(h('div', 'hero-kicker', f.kicker), h('div', 'hero-title', f.ch.name),
        h('div', 'hero-sub', [f.ch.countryName, f.ch.categories.filter((c) => c !== 'Other').join(' · '), f.ch.quality].filter(Boolean).join('  ·  ')));
      const cta = h('button', 'pill-btn primary hero-cta'); cta.innerHTML = '<span>▶</span> Watch';
      text.appendChild(cta);
      hero.appendChild(text);
      if (f.ch.logo) { const lg = h('div', 'hero-logo'); const img = document.createElement('img'); img.src = f.ch.logo; img.alt = ''; lg.appendChild(img); hero.appendChild(lg); }
      const idx = Math.max(0, f.list.indexOf(f.ch));
      hero.addEventListener('click', () => Player.open(f.list, idx, f.title));
      hero.addEventListener('mouseenter', () => setFocus(hero, false));
      frag.appendChild(hero);
    }

    const recents = resolveKeys(state.recents);
    if (recents.length) frag.appendChild(cardRow('Continue Watching', recents));
    const favs = resolveKeys([...state.favorites]);
    if (favs.length) frag.appendChild(cardRow('Favorites', favs, { seeAll: () => switchView('favorites') }));

    for (const name of ['News', 'Sports', 'Entertainment', 'Movies', 'Music', 'Kids', 'Documentary']) {
      const cat = state.categories.find((c) => c.name === name);
      if (!cat) continue;
      // prefer channels with logos and known quality so the rows look rich
      const sorted = [...cat.channels].sort((a, b) => score(b) - score(a));
      // shuffle the best-looking ~80 so the row isn't an alphabetical slice every launch
      const top = shuffle(sorted.slice(0, 80)).concat(sorted.slice(80));
      frag.appendChild(cardRow(name, top, { seeAll: () => openList(cat.name, cat.channels, 'categories') }));
    }
    content.replaceChildren(frag);
  }
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function score(ch) { return (ch.logo ? 2 : 0) + (/1080p/.test(ch.quality) ? 2 : /720p/.test(ch.quality) ? 1 : 0) + (ch.tags.length ? -1 : 0); }

  function renderCategories() {
    const frag = document.createDocumentFragment();
    const head = h('div', 'section-head'); head.append(h('div', 'section-title', 'Categories'), h('div', 'section-count', `${state.categories.length} genres`)); frag.appendChild(head);
    const g = h('div', 'tile-grid');
    const glyphs = { News: '📰', Sports: '🏟️', Movies: '🎬', Music: '🎵', Kids: '🧸', Entertainment: '✨', Documentary: '🌍', Religious: '🕊️', General: '📺', Series: '🎞️', Comedy: '😂', Education: '🎓', Culture: '🏛️', Legislative: '🏛', Lifestyle: '🌿', Shop: '🛍️', Business: '📈', Classic: '🎞', Outdoor: '🏕️', Travel: '✈️', Animation: '🎨', Cooking: '🍳', Family: '👨‍👩‍👧', Auto: '🏎️', Weather: '🌤️', Science: '🔬', Public: '🏢', Other: '📡', Relax: '🌙', Interactive: '🕹️' };
    for (const cat of state.categories) {
      const t = h('div', 'tile'); t.tabIndex = -1;
      const logos = h('div', 'tile-logos');
      cat.channels.filter((c) => c.logo).slice(0, 6).forEach((c) => { const img = document.createElement('img'); img.loading = 'lazy'; img.src = c.logo; img.alt = ''; img.onerror = () => img.remove(); logos.appendChild(img); });
      t.append(logos, h('div', 'tile-glyph', glyphs[cat.name] || '📡'), h('div', 'tile-name', cat.name), h('div', 'tile-count', `${cat.channels.length} channels`));
      t.addEventListener('click', () => openList(cat.name, cat.channels, 'categories'));
      t.addEventListener('mouseenter', () => setFocus(t, false));
      g.appendChild(t);
    }
    frag.appendChild(g);
    content.replaceChildren(frag);
  }

  function renderCountries() {
    const frag = document.createDocumentFragment();
    const head = h('div', 'section-head'); head.append(h('div', 'section-title', 'Countries'), h('div', 'section-count', `${state.countries.length} regions`)); frag.appendChild(head);
    const g = h('div', 'tile-grid');
    for (const c of state.countries) {
      const t = h('div', 'tile'); t.tabIndex = -1;
      t.append(h('div', 'tile-glyph', c.flag), h('div', 'tile-name', c.name), h('div', 'tile-count', `${c.channels.length} channels`));
      t.addEventListener('click', () => openList(`${c.flag}  ${c.name}`, c.channels, 'countries'));
      t.addEventListener('mouseenter', () => setFocus(t, false));
      g.appendChild(t);
    }
    frag.appendChild(g);
    content.replaceChildren(frag);
  }

  function renderFavorites() {
    const favs = resolveKeys([...state.favorites]);
    const frag = document.createDocumentFragment();
    const head = h('div', 'section-head'); head.append(h('div', 'section-title', 'Favorites'), h('div', 'section-count', `${favs.length} channels`)); frag.appendChild(head);
    if (!favs.length) {
      const e = h('div', 'empty'); e.append(h('b', null, 'No favorites yet'), document.createTextNode('Hover a channel and tap the heart, or press F while watching.')); frag.appendChild(e);
    } else frag.appendChild(grid(favs, 'Favorites'));
    content.replaceChildren(frag);
  }

  function renderSearch() {
    const frag = document.createDocumentFragment();
    const wrap = h('div', 'search-wrap');
    const input = h('input', 'search-input'); input.placeholder = 'Search channels, countries, genres'; input.value = state.searchQuery; input.id = 'search-input';
    wrap.append(input, h('div', 'search-hint', 'Press Esc to leave search · ↓ to jump to results'));
    frag.appendChild(wrap);
    const results = h('div'); results.id = 'search-results';
    frag.appendChild(results);
    content.replaceChildren(frag);
    const run = () => {
      state.searchQuery = input.value;
      const q = input.value.trim().toLowerCase();
      if (!q) { results.replaceChildren(); return; }
      const terms = q.split(/\s+/);
      const hits = state.channels.filter((c) => terms.every((t) => c.search.includes(t)));
      const sorted = hits.sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || (score(b) - score(a)));
      results.replaceChildren();
      if (!sorted.length) { const e = h('div', 'empty'); e.append(h('b', null, 'No matches'), document.createTextNode(`Nothing found for “${input.value}”.`)); results.appendChild(e); return; }
      const head = h('div', 'section-head'); head.append(h('div', 'section-count', `${sorted.length} result${sorted.length === 1 ? '' : 's'}`)); results.appendChild(head);
      results.appendChild(grid(sorted.slice(0, 400), `Search: ${input.value}`));
    };
    let deb; input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(run, 120); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); input.blur(); const first = results.querySelector('.card'); if (first) setFocus(first, true); }
      if (e.key === 'Escape') { input.blur(); switchView('home'); }
    });
    run();
    input.focus();
  }

  function renderList() {
    const { title, channels, backView } = state.listCtx;
    const frag = document.createDocumentFragment();
    const back = h('button', 'back-link', `‹ ${backView === 'countries' ? 'Countries' : 'Categories'}`);
    back.addEventListener('click', () => switchView(backView));
    frag.appendChild(back);
    const head = h('div', 'section-head'); head.append(h('div', 'section-title', title), h('div', 'section-count', `${channels.length} channels`)); frag.appendChild(head);
    frag.appendChild(grid(channels, title.replace(/^\S+\s+/, (m) => (/\p{Extended_Pictographic}/u.test(m) ? '' : m))));
    content.replaceChildren(frag);
  }

  function openList(title, channels, backView) {
    state.listCtx = { title, channels, backView };
    state.view = 'list';
    render();
  }

  function switchView(view) {
    state.view = view;
    render();
  }

  function render() {
    tabsEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === (state.view === 'list' ? state.listCtx.backView : state.view)));
    content.scrollTop = 0;
    state.focusEl = null;
    switch (state.view) {
      case 'home': renderHome(); break;
      case 'categories': renderCategories(); break;
      case 'countries': renderCountries(); break;
      case 'favorites': renderFavorites(); break;
      case 'search': renderSearch(); break;
      case 'list': renderList(); break;
    }
    if (state.view !== 'search') requestAnimationFrame(() => { const first = content.querySelector('.hero, .card, .tile'); if (first) setFocus(first, false); });
  }

  // ---------- spatial focus (tvOS-like keyboard navigation) ----------
  function setFocus(elm, scroll) {
    if (state.focusEl) state.focusEl.classList.remove('focused');
    state.focusEl = elm;
    if (!elm) return;
    elm.classList.add('focused');
    if (scroll) {
      const scroller = elm.closest('.row-scroller');
      if (scroller) elm.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      else elm.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function moveFocus(dir) {
    const items = [...content.querySelectorAll('.hero, .card, .tile')];
    if (!items.length) return;
    if (!state.focusEl || !items.includes(state.focusEl)) { setFocus(items[0], true); return; }
    const cur = state.focusEl.getBoundingClientRect();
    const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
    const inRow = state.focusEl.closest('.row-scroller');
    let best = null, bestScore = Infinity;
    for (const it of items) {
      if (it === state.focusEl) continue;
      const r = it.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let primary, secondary;
      if (dir === 'ArrowLeft') { if (dx >= -8) continue; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'ArrowRight') { if (dx <= 8) continue; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'ArrowUp') { if (dy >= -8) continue; primary = -dy; secondary = Math.abs(dx); }
      else { if (dy <= 8) continue; primary = dy; secondary = Math.abs(dx); }
      // horizontal moves stay within the same scroller row
      if ((dir === 'ArrowLeft' || dir === 'ArrowRight') && inRow && it.closest('.row-scroller') !== inRow) continue;
      if ((dir === 'ArrowLeft' || dir === 'ArrowRight') && secondary > cur.height * 0.6) continue;
      const s = primary + secondary * 2.5;
      if (s < bestScore) { bestScore = s; best = it; }
    }
    if (best) setFocus(best, true);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.ctrlKey && (e.key === 'f' || e.key === 'F')) { window.glasstv.toggleFullscreen(); return; }
    if (Player.isOpen()) { if (Player.handleKey(e)) e.preventDefault(); return; }

    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing) return;

    switch (e.key) {
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        e.preventDefault(); moveFocus(e.key); break;
      case 'Enter': if (state.focusEl) state.focusEl.click(); break;
      case 'Escape':
        if (state.view === 'list') switchView(state.listCtx.backView);
        else if (state.view !== 'home') switchView('home');
        break;
      case '/': e.preventDefault(); switchView('search'); break;
      case 'f': case 'F': if (state.focusEl && state.focusEl.classList.contains('card')) { const k = state.focusEl.dataset.key; const ch = state.byId.get(k); if (ch) toast(toggleFavorite(ch) ? 'Added to Favorites' : 'Removed from Favorites'); } break;
      case '1': case '2': case '3': case '4': case '5': {
        const views = ['home', 'categories', 'countries', 'favorites', 'search'];
        switchView(views[Number(e.key) - 1]); break;
      }
      case 'Tab': {
        e.preventDefault();
        const views = ['home', 'categories', 'countries', 'favorites', 'search'];
        const cur = views.indexOf(state.view === 'list' ? state.listCtx.backView : state.view);
        switchView(views[(cur + (e.shiftKey ? -1 : 1) + views.length) % views.length]);
        break;
      }
    }
  });

  tabsEl.addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) switchView(t.dataset.view); });
  $('refresh-btn').addEventListener('click', () => load(true));

  function onPlayerClosed(ch) {
    // Re-render home so Continue Watching reflects the session; keep other views as-is
    if (state.view === 'home') render();
    else if (ch) { const card = content.querySelector(`.card[data-key="${CSS.escape(key(ch))}"]`); if (card) setFocus(card, true); }
  }

  // ---------- boot ----------
  async function load(force) {
    const boot = $('boot'), status = $('boot-status'), refresh = $('refresh-btn');
    if (force) { refresh.classList.add('spinning'); toast('Refreshing playlist…'); }
    try {
      const res = await window.glasstv.loadPlaylist({ force });
      status.textContent = 'Building your guide…';
      await new Promise((r) => setTimeout(r, 20));
      const channels = Playlist.parse(res.text).filter((c) => c.url);
      const { categories, countries } = Playlist.buildIndexes(channels);
      state.channels = channels; state.categories = categories; state.countries = countries;
      state.byId = new Map();
      for (const ch of channels) if (!state.byId.has(key(ch))) state.byId.set(key(ch), ch);
      const when = new Date(res.updatedAt);
      $('topbar-meta').textContent = `${channels.length.toLocaleString()} channels · ${res.stale ? 'offline copy' : 'updated ' + when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      boot.classList.add('hidden');
      $('browse').classList.remove('hidden');
      render();
      if (force) toast(`Loaded ${channels.length.toLocaleString()} channels`);
    } catch (err) {
      status.textContent = `Couldn't load the playlist: ${err.message || err}`;
      $('boot').querySelector('.boot-bar').style.display = 'none';
      console.error(err);
    } finally {
      refresh.classList.remove('spinning');
    }
  }

  window.App = { toast, isFavorite, toggleFavorite, addRecent, onPlayerClosed };
  window.__dbg = state;
  load(false);
})();
