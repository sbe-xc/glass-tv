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
    sources: [],          // user-added sources: { id, name, type, count, error }
    live: new Map(),      // url -> true/false from probing
    probing: false,
    hideOffline: localStorage.getItem('hideOffline') === '1',
    fixtures: null,
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
    card.tabIndex = -1; card.dataset.key = key(ch); card.dataset.url = ch.url;
    if (state.live.has(ch.url)) card.classList.add(state.live.get(ch.url) ? 'is-live' : 'is-dead');
    card.appendChild(h('div', 'live-dot-sm'));
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
    text.append(h('div', 'card-name', ch.name), h('div', 'card-meta', [ch.source ? ch.source.name : ch.countryName, ch.categories.filter((c) => c !== 'Other')[0]].filter(Boolean).join(' · ')));
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

    // One row per user-added source
    for (const src of state.sources) {
      const chans = state.channels.filter((c) => c.source && c.source.id === src.id);
      if (!chans.length) continue;
      const sorted = [...chans].sort((a, b) => score(b) - score(a));
      frag.appendChild(cardRow(src.name, sorted, { seeAll: () => openList(src.name, chans, 'home') }));
    }

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

  // ---------- Sports hub ----------
  const SPORTS = [
    { name: 'Football', glyph: '⚽', re: /\b(football|soccer|futbol|fútbol|futebol|calcio|fussball|premier league|premier sports|bundesliga|la ?liga|serie ?a|ligue ?1|uefa|fifa|champions league|libertadores|mls|efl|eredivisie|super ?lig)\b/i, not: /\b(american|nfl|college|afl|gaelic)\b/i },
    { name: 'Basketball', glyph: '🏀', re: /\b(basket|nba|euroleague|wnba|acb)\b/i },
    { name: 'American Football', glyph: '🏈', re: /\b(nfl|american football|college football|redzone)\b/i },
    { name: 'Tennis', glyph: '🎾', re: /\b(tennis|atp|wta|wimbledon|roland)\b/i },
    { name: 'Motorsport', glyph: '🏎️', re: /\b(motor|f1|formula|racing|nascar|motogp|moto gp|rally|indycar|dakar)\b/i, not: /\bhorse\b/i },
    { name: 'Combat', glyph: '🥊', re: /\b(fight|mma|ufc|boxing|boxeo|wrestl|wwe|aew|combat|kickbox|muay|bellator|judo|karate)\b/i },
    { name: 'Cricket', glyph: '🏏', re: /\b(cricket|willow|ipl|bcci|icc)\b/i },
    { name: 'Golf', glyph: '⛳', re: /\b(golf|pga|lpga)\b/i },
    { name: 'Rugby', glyph: '🏉', re: /\b(rugby|nrl|super league)\b/i },
    { name: 'Baseball & Hockey', glyph: '⚾', re: /\b(baseball|mlb|hockey|nhl|khl)\b/i },
    { name: 'Cycling & Outdoor', glyph: '🚴', re: /\b(cycling|velo|ski|surf|sail|climb|extreme|red ?bull|equestr|horse|polo|marathon)\b/i },
    { name: 'Esports', glyph: '🎮', re: /\b(esport|e-sport|gaming|gamer|ginx)\b/i },
    { name: 'Fitness & Wellness', glyph: '🧘', re: /\b(fitness|yoga|gym|workout)\b/i },
  ];
  // Only these keywords pull a non-Sports-category channel into the hub (the rest just sub-group Sports channels)
  const STRONG_SPORT = /\b(sports?|football|soccer|futbol|fútbol|calcio|basketball|nba|nfl|nhl|mlb|tennis|motorsport|motogp|formula|nascar|ufc|mma|boxing|wrestling|wwe|cricket|golf|rugby|esports?|fight)\b/i;

  function sportOf(ch) {
    const hay = ch.name + ' ' + ch.categories.join(' ');
    for (const s of SPORTS) if (s.re.test(hay) && !(s.not && s.not.test(hay))) return s.name;
    return 'Multi-sport';
  }
  function isSportsChannel(ch) {
    return ch.categories.some((c) => /sport/i.test(c)) || STRONG_SPORT.test(ch.name);
  }
  function sportsChannels() {
    return state.channels.filter(isSportsChannel);
  }

  // Probe a list of channels for liveness in batches, updating cards as results arrive.
  async function probeChannels(channels) {
    if (state.probing) return;
    state.probing = true;
    const todo = channels.filter((c) => !state.live.has(c.url));
    const statusEl = () => document.getElementById('sports-status');
    let done = channels.length - todo.length;
    const update = () => {
      const el = statusEl(); if (!el) return;
      const liveCount = channels.filter((c) => state.live.get(c.url)).length;
      el.replaceChildren();
      if (todo.length && done < channels.length) { el.appendChild(h('div', 'spinner')); el.appendChild(h('span', null, `Checking streams… ${done}/${channels.length} · ${liveCount} live so far`)); }
      else el.appendChild(h('span', null, `${liveCount} of ${channels.length} streams live · checked in the last 30 min`));
    };
    update();
    try {
      for (let i = 0; i < todo.length; i += 16) {
        if (state.view !== 'sports') break; // stop if the user navigates away
        const batch = todo.slice(i, i + 16);
        const res = await window.glasstv.probeStreams(batch.map((c) => ({ url: c.url, userAgent: c.userAgent, referrer: c.referrer })));
        for (const [url, ok] of Object.entries(res)) {
          state.live.set(url, ok);
          content.querySelectorAll(`.card[data-url="${CSS.escape(url)}"]`).forEach((card) => {
            card.classList.toggle('is-live', ok); card.classList.toggle('is-dead', !ok);
            if (!ok && state.hideOffline) card.style.display = 'none';
          });
        }
        done += batch.length;
        update();
      }
    } finally { state.probing = false; }
  }

  function fixtureCard(f, now) {
    const live = f.start && now >= f.start && now < f.start + 115 * 60 * 1000 && !/finished|ft/i.test(f.status || '');
    const finished = f.homeScore != null && f.awayScore != null && !live;
    const card = h('div', 'fixture' + (live ? ' live' : ''));
    const when = h('div', 'fixture-when');
    const d = f.start ? new Date(f.start) : null;
    const whenText = !d ? 'TBC' : (d.toDateString() === new Date(now).toDateString() ? 'Today ' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ') + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    when.appendChild(h('span', null, finished ? 'Full time · ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : whenText));
    if (live) { const lp = h('div', 'live-pill'); lp.append(h('span', 'live-dot'), document.createTextNode('LIVE')); when.appendChild(lp); }
    else if (f.round) when.appendChild(h('span', null, `MW ${f.round}`));
    card.appendChild(when);
    const teams = h('div', 'fixture-teams');
    for (const side of ['home', 'away']) {
      const t = h('div', 'fixture-team');
      if (f[side + 'Badge']) { const img = document.createElement('img'); img.src = f[side + 'Badge'] + '/tiny'; img.alt = ''; img.onerror = () => img.remove(); t.appendChild(img); }
      t.appendChild(h('span', null, f[side]));
      if (finished || live) t.appendChild(h('span', 'score', f[side + 'Score'] ?? '–'));
      teams.appendChild(t);
    }
    card.appendChild(teams);
    const foot = h('div', 'fixture-foot');
    foot.appendChild(h('div', 'fixture-tv', f.tv || f.venue || ''));
    if (!finished) { const w = h('button', 'pill-btn primary fixture-watch', live ? 'Watch' : 'Find channel'); w.addEventListener('click', () => openMatchFinder(f)); foot.appendChild(w); }
    card.appendChild(foot);
    return card;
  }

  // Channels likely to carry Premier League football, ranked: user sources first, then by name match strength.
  const EPL_CARRIERS = /premier league|sky sports (premier|main event|football)|sky sport(s)?\b|tnt sports?|bt sport|bein ?sports?|supersport|optus sport|dazn|peacock|nbc ?sports|usa network|espn|fubo|sportsnet|canal\+ ?sport|viaplay|movistar|v sport|setanta|astro|star sports|premier sports|now sports|match ?tv|arena sport|sport ?tv|eleven sports|stan sport|hub premier|ssc|abu dhabi sports|alkass|onefootball|football/i;
  function matchCarriers() {
    const scored = [];
    for (const ch of state.channels) {
      if (!EPL_CARRIERS.test(ch.name)) continue;
      let s = 0;
      if (ch.source) s += 100;
      if (/premier league|main event|sky sports|tnt sport|bein sport|supersport|peacock|optus|dazn/i.test(ch.name)) s += 20;
      if (/premier/i.test(ch.name)) s += 10;
      if (state.live.get(ch.url) === true) s += 15;
      if (state.live.get(ch.url) === false) s -= 50;
      s += score(ch);
      scored.push({ ch, s });
    }
    return scored.sort((a, b) => b.s - a.s).map((x) => x.ch);
  }

  function openMatchFinder(f) {
    const modal = $('match-modal'), body = $('match-body');
    $('match-title').textContent = `${f.home} v ${f.away}`;
    const d = f.start ? new Date(f.start) : null;
    $('match-sub').textContent = (d ? d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + (f.tv ? ' · ' + f.tv : '');
    body.replaceChildren();
    const carriers = matchCarriers().slice(0, 40);
    const own = carriers.filter((c) => c.source);
    if (!own.length) {
      const e = h('div', 'match-empty');
      e.innerHTML = '<b>None of your sources carry Premier League football.</b><br>Live EPL matches are only available from licensed broadcasters (Sky, TNT, Peacock, beIN, SuperSport, Optus…). If you subscribe to a provider that gives you an M3U or Xtream login, add it under <b>Sources</b> and matches will show up here.';
      body.appendChild(e);
      const b = h('button', 'pill-btn primary', 'Open Sources'); b.style.marginTop = '14px';
      b.addEventListener('click', () => { closeModal(modal); openSources(); });
      body.appendChild(b);
      if (carriers.length) body.appendChild(h('div', 'match-empty', ' ')).style.marginTop = '12px';
    }
    if (carriers.length) {
      const list = h('div', 'match-list');
      if (!own.length) list.appendChild(h('div', 'section-count', 'Free sports channels with a football name — unlikely to carry this match, but worth a look:'));
      carriers.forEach((ch, i) => {
        const item = h('div', 'drawer-item');
        const logo = h('div', 'drawer-logo'); if (ch.logo) { const img = document.createElement('img'); img.src = ch.logo; img.alt = ''; img.onerror = () => img.remove(); logo.appendChild(img); }
        const text = h('div'); text.style.minWidth = '0';
        const name = h('div', 'drawer-name'); name.textContent = ch.name;
        if (ch.source) { const tag = h('span', 'src-tag', ch.source.name); tag.style.marginLeft = '8px'; name.appendChild(tag); }
        const meta = h('div', 'drawer-meta', [ch.countryName, ch.quality, state.live.get(ch.url) === true ? 'live' : state.live.get(ch.url) === false ? 'offline' : ''].filter(Boolean).join(' · '));
        text.append(name, meta);
        item.append(logo, text);
        item.addEventListener('click', () => { closeModal(modal); Player.open(carriers, i, `${f.home} v ${f.away}`); });
        list.appendChild(item);
      });
      body.appendChild(list);
    }
    openModal(modal);
  }

  async function renderSports() {
    const frag = document.createDocumentFragment();
    const head = h('div', 'section-head');
    head.append(h('div', 'section-title', 'Sports'), h('div', 'section-count', `${sportsChannels().length} channels`));
    const toggle = h('label', 'toggle'); toggle.style.marginLeft = 'auto';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.hideOffline;
    cb.addEventListener('change', () => { state.hideOffline = cb.checked; localStorage.setItem('hideOffline', cb.checked ? '1' : '0'); content.querySelectorAll('.card.is-dead').forEach((c) => { c.style.display = cb.checked ? 'none' : ''; }); });
    toggle.append(cb, document.createTextNode('Hide offline'));
    head.appendChild(toggle);
    frag.appendChild(head);

    // Fixtures strip
    const fx = h('section', 'fixtures');
    const fxHead = h('div', 'fixtures-head');
    const ft = h('div', 'fixtures-title'); ft.append(h('span', 'epl', 'EPL'), document.createTextNode('Premier League'));
    fxHead.append(ft, h('div', 'fixtures-note', 'Loading fixtures…'));
    const fxScroller = h('div', 'fixtures-scroller');
    fx.append(fxHead, fxScroller);
    frag.appendChild(fx);

    frag.appendChild(h('div', 'sports-status')).id = 'sports-status';

    // Sport groups
    const chans = sportsChannels();
    const groups = new Map();
    for (const ch of chans) { const s = sportOf(ch); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(ch); }
    const order = [...SPORTS.map((s) => s.name), 'Multi-sport'];
    const toProbe = [];
    for (const name of order) {
      const list = groups.get(name); if (!list) continue;
      const sorted = list.sort((a, b) => (b.source ? 1 : 0) - (a.source ? 1 : 0) || (state.live.get(b.url) === true) - (state.live.get(a.url) === true) || score(b) - score(a));
      const glyph = (SPORTS.find((s) => s.name === name) || { glyph: '🏟️' }).glyph;
      frag.appendChild(cardRow(`${glyph}  ${name}`, sorted, { limit: 30, seeAll: () => openList(name, sorted, 'sports') }));
      toProbe.push(...sorted.slice(0, 30));
    }
    content.replaceChildren(frag);
    if (state.hideOffline) content.querySelectorAll('.card.is-dead').forEach((c) => { c.style.display = 'none'; });

    probeChannels(toProbe);

    try {
      const data = state.fixtures && Date.now() - state.fixtures.fetchedAt < 10 * 60 * 1000 ? state.fixtures : await window.glasstv.eplFixtures();
      state.fixtures = data;
      if (state.view !== 'sports') return;
      const now = Date.now();
      const upcoming = data.upcoming.filter((f) => f.start).sort((a, b) => a.start - b.start);
      const recent = data.recent.filter((f) => f.start).sort((a, b) => b.start - a.start).slice(0, 4);
      const liveOnes = upcoming.filter((f) => now >= f.start && now < f.start + 115 * 60 * 1000);
      const shown = [...liveOnes, ...upcoming.filter((f) => !liveOnes.includes(f)).slice(0, 10), ...recent];
      fxScroller.replaceChildren(...shown.map((f) => fixtureCard(f, now)));
      fxHead.lastChild.textContent = liveOnes.length ? `${liveOnes.length} match${liveOnes.length > 1 ? 'es' : ''} live now` : upcoming.length ? `Next: ${new Date(upcoming[0].start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'No fixtures listed';
      if (!shown.length) fxScroller.appendChild(h('div', 'match-empty', 'Fixture data is unavailable right now.'));
    } catch (err) {
      fxHead.lastChild.textContent = 'Fixtures unavailable';
    }
  }

  // ---------- Sources panel ----------
  function openModal(m) { m.classList.remove('hidden'); }
  function closeModal(m) { m.classList.add('hidden'); }

  async function renderSourceList() {
    const list = $('source-list');
    list.replaceChildren();
    const builtin = h('div', 'source-item source-builtin');
    builtin.append(h('div', 'source-icon', '🌐'));
    const bt = h('div', 'source-text'); bt.append(h('div', 'source-name', 'iptv-org'), h('div', 'source-meta', `${state.channels.filter((c) => !c.source).length.toLocaleString()} free-to-air channels · built in`));
    builtin.append(bt, h('button', 'source-remove', 'Remove'));
    list.appendChild(builtin);
    for (const src of state.sources) {
      const item = h('div', 'source-item');
      item.append(h('div', 'source-icon', src.type === 'xtream' ? '🔑' : '📄'));
      const t = h('div', 'source-text');
      t.append(h('div', 'source-name', src.name), h('div', 'source-meta' + (src.error ? ' err' : ''), src.error ? `Couldn't load: ${src.error}` : `${src.count.toLocaleString()} channels · ${src.type === 'xtream' ? 'Xtream Codes' : 'M3U'}`));
      const rm = h('button', 'source-remove', 'Remove');
      rm.addEventListener('click', async () => { await window.glasstv.removeSource(src.id); await reloadSources(); toast(`Removed ${src.name}`); });
      item.append(t, rm);
      list.appendChild(item);
    }
  }

  function openSources() { renderSourceList(); $('src-error').textContent = ''; openModal($('sources-modal')); const f = $('sources-modal').querySelector('.form-fields:not(.hidden) .field'); if (f) f.focus(); }

  async function addSourceFromForm() {
    const type = $('source-type').querySelector('.seg-btn.active').dataset.type;
    const btn = $('src-add'), err = $('src-error');
    const payload = type === 'xtream'
      ? { type, server: $('xt-server').value, username: $('xt-user').value, password: $('xt-pass').value, name: $('xt-name').value }
      : { type, url: $('src-url').value, name: $('src-name').value };
    if (type === 'm3u' && !/^https?:\/\//i.test(payload.url.trim())) { err.textContent = 'Enter a full http(s) URL to an .m3u / .m3u8 playlist.'; return; }
    if (type === 'xtream' && (!payload.server.trim() || !payload.username.trim() || !payload.password)) { err.textContent = 'Server, username and password are all required.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
    try {
      const res = await window.glasstv.addSource(payload);
      ['src-url', 'src-name', 'xt-server', 'xt-user', 'xt-pass', 'xt-name'].forEach((id) => { $(id).value = ''; });
      await reloadSources();
      toast(`Added ${res.name} · ${res.channels.toLocaleString()} channels`);
    } catch (e) {
      err.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '');
    } finally { btn.disabled = false; btn.textContent = 'Add source'; }
  }

  $('sources-btn').addEventListener('click', openSources);
  $('sources-close').addEventListener('click', () => closeModal($('sources-modal')));
  $('match-close').addEventListener('click', () => closeModal($('match-modal')));
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));
  $('source-type').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    $('source-type').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.form-fields').forEach((f) => f.classList.toggle('hidden', f.dataset.for !== b.dataset.type));
    const f = document.querySelector('.form-fields:not(.hidden) .field'); if (f) f.focus();
  });
  $('src-add').addEventListener('click', addSourceFromForm);
  $('sources-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('field')) addSourceFromForm(); });

  function renderList() {
    const { title, channels, backView } = state.listCtx;
    const frag = document.createDocumentFragment();
    const backLabel = { countries: 'Countries', categories: 'Categories', sports: 'Sports', home: 'Watch Now' }[backView] || 'Back';
    const back = h('button', 'back-link', `‹ ${backLabel}`);
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
      case 'sports': renderSports(); break;
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
    const items = [...content.querySelectorAll('.hero, .card, .tile')].filter((it) => it.offsetParent !== null);
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
    const openModalEl = document.querySelector('.modal-backdrop:not(.hidden)');
    if (openModalEl) { if (e.key === 'Escape') closeModal(openModalEl); return; }
    if (Player.isOpen()) { if (Player.handleKey(e)) e.preventDefault(); return; }
    if (e.metaKey && e.key === ',') { e.preventDefault(); openSources(); return; }

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
      case '1': case '2': case '3': case '4': case '5': case '6': {
        const views = ['home', 'sports', 'categories', 'countries', 'favorites', 'search'];
        switchView(views[Number(e.key) - 1]); break;
      }
      case 'Tab': {
        e.preventDefault();
        const views = ['home', 'sports', 'categories', 'countries', 'favorites', 'search'];
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
  let baseChannels = [];
  function rebuild() {
    const userChannels = [];
    for (const src of state.sources) userChannels.push(...(src.channels || []));
    const channels = baseChannels.concat(userChannels);
    const { categories, countries } = Playlist.buildIndexes(channels);
    state.channels = channels; state.categories = categories; state.countries = countries;
    state.byId = new Map();
    for (const ch of channels) if (!state.byId.has(key(ch))) state.byId.set(key(ch), ch);
    const meta = $('topbar-meta');
    const base = meta.dataset.base || '';
    meta.textContent = `${channels.length.toLocaleString()} channels · ${base}`;
  }

  async function reloadSources(force) {
    const loaded = await window.glasstv.loadSources({ force });
    state.sources = loaded.map((s) => {
      const src = { id: s.id, name: s.name, type: s.type, error: s.error || null, channels: [] };
      if (s.text) {
        src.channels = Playlist.parse(s.text, { id: s.id, name: s.name }).filter((c) => c.url);
        // user playlists rarely carry country codes; make categories useful instead
        for (const ch of src.channels) if (!ch.country) ch.countryName = s.name;
      }
      src.count = src.channels.length;
      return src;
    });
    rebuild();
    if (!$('sources-modal').classList.contains('hidden')) renderSourceList();
    if (!Player.isOpen()) render();
  }

  async function load(force) {
    const boot = $('boot'), status = $('boot-status'), refresh = $('refresh-btn');
    if (force) { refresh.classList.add('spinning'); toast('Refreshing playlists…'); }
    try {
      const res = await window.glasstv.loadPlaylist({ force });
      status.textContent = 'Building your guide…';
      await new Promise((r) => setTimeout(r, 20));
      baseChannels = Playlist.parse(res.text).filter((c) => c.url);
      const when = new Date(res.updatedAt);
      $('topbar-meta').dataset.base = res.stale ? 'offline copy' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      state.sources = [];
      rebuild();
      boot.classList.add('hidden');
      $('browse').classList.remove('hidden');
      render();
      await reloadSources(force);
      if (force) toast(`Loaded ${state.channels.length.toLocaleString()} channels`);
    } catch (err) {
      status.textContent = `Couldn't load the playlist: ${err.message || err}`;
      $('boot').querySelector('.boot-bar').style.display = 'none';
      console.error(err);
    } finally {
      refresh.classList.remove('spinning');
    }
  }

  window.App = { toast, isFavorite, toggleFavorite, addRecent, onPlayerClosed, openSources };
  window.__dbg = state;
  load(false);
})();
