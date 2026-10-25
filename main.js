const { app, BrowserWindow, ipcMain, session, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Playlist sources from iptv-org/iptv (https://github.com/iptv-org/iptv)
const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

let win = null;

// Per-host request headers some IPTV streams require (set when a channel starts playing)
const streamHeaders = new Map(); // hostname -> { userAgent, referrer }

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'GlassTV',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Streams rarely send CORS headers; the renderer only ever loads local files.
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
}

function installHeaderHooks() {
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    try {
      const host = new URL(details.url).hostname;
      const h = streamHeaders.get(host);
      if (h) {
        if (h.userAgent) headers['User-Agent'] = h.userAgent;
        if (h.referrer) { headers['Referer'] = h.referrer; headers['Origin'] = new URL(h.referrer).origin; }
      }
    } catch (_) {}
    // A file:// origin confuses some CDNs
    if (headers['Origin'] && headers['Origin'].startsWith('file')) delete headers['Origin'];
    callback({ requestHeaders: headers });
  });
}

// ---- playlist fetching with on-disk cache ----
function cachePath() {
  return path.join(app.getPath('userData'), 'playlist-cache.m3u');
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    const chunks = [];
    req.on('response', (res) => {
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Loads a playlist URL through an on-disk cache keyed by id.
async function loadCached(id, url, force) {
  const p = id === 'iptv-org' ? cachePath() : path.join(app.getPath('userData'), 'sources', `${id}.m3u`);
  try {
    if (!force && fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
        return { text: fs.readFileSync(p, 'utf8'), fromCache: true, updatedAt: stat.mtimeMs };
      }
    }
  } catch (_) {}
  try {
    const text = await fetchText(url);
    if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 2000))) throw new Error('Not an M3U playlist');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return { text, fromCache: false, updatedAt: Date.now() };
  } catch (err) {
    // Offline: fall back to a stale cache if we have one
    if (fs.existsSync(p)) {
      return { text: fs.readFileSync(p, 'utf8'), fromCache: true, stale: true, updatedAt: fs.statSync(p).mtimeMs, error: String(err) };
    }
    throw err;
  }
}

ipcMain.handle('playlist:load', async (_e, { force } = {}) => loadCached('iptv-org', PLAYLIST_URL, force));

// ---- user sources: plain M3U URLs or Xtream Codes logins ----
function sourcesPath() { return path.join(app.getPath('userData'), 'sources.json'); }
function readSources() { try { return JSON.parse(fs.readFileSync(sourcesPath(), 'utf8')); } catch (_) { return []; } }
function writeSources(list) { fs.mkdirSync(path.dirname(sourcesPath()), { recursive: true }); fs.writeFileSync(sourcesPath(), JSON.stringify(list, null, 2)); }

function sourceUrl(src) {
  if (src.type === 'xtream') {
    const base = src.server.replace(/\/+$/, '');
    return `${base}/get.php?username=${encodeURIComponent(src.username)}&password=${encodeURIComponent(src.password)}&type=m3u_plus&output=m3u8`;
  }
  return src.url;
}

ipcMain.handle('sources:list', () => readSources().map((s) => ({ ...s, password: s.password ? '••••••' : undefined })));

ipcMain.handle('sources:add', async (_e, src) => {
  const list = readSources();
  const id = 'src_' + Date.now().toString(36);
  const entry = { id, type: src.type, name: (src.name || '').trim() };
  if (src.type === 'xtream') {
    let server = (src.server || '').trim();
    if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
    Object.assign(entry, { server, username: (src.username || '').trim(), password: src.password || '' });
    if (!entry.name) { try { entry.name = new URL(server).hostname; } catch (_) { entry.name = 'Xtream'; } }
  } else {
    entry.url = (src.url || '').trim();
    if (!entry.name) { try { entry.name = new URL(entry.url).hostname; } catch (_) { entry.name = 'Playlist'; } }
  }
  // Validate by fetching once; surface a readable error if it fails
  const res = await loadCached(id, sourceUrl(entry), true);
  list.push(entry);
  writeSources(list);
  return { id, name: entry.name, channels: (res.text.match(/#EXTINF/g) || []).length };
});

ipcMain.handle('sources:remove', (_e, id) => {
  writeSources(readSources().filter((s) => s.id !== id));
  try { fs.unlinkSync(path.join(app.getPath('userData'), 'sources', `${id}.m3u`)); } catch (_) {}
  return true;
});

ipcMain.handle('sources:load', async (_e, { force } = {}) => {
  const out = [];
  for (const src of readSources()) {
    try {
      const res = await loadCached(src.id, sourceUrl(src), force);
      out.push({ id: src.id, name: src.name, type: src.type, text: res.text, updatedAt: res.updatedAt, stale: !!res.stale });
    } catch (err) {
      out.push({ id: src.id, name: src.name, type: src.type, text: '', error: String(err.message || err) });
    }
  }
  return out;
});

// ---- stream liveness probing (HEAD-ish GET, abort after headers) ----
const probeCache = new Map(); // url -> { ok, at }
const PROBE_TTL_MS = 30 * 60 * 1000;

function probeOne(url, headers) {
  return new Promise((resolve) => {
    const cached = probeCache.get(url);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) return resolve(cached.ok);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; probeCache.set(url, { ok, at: Date.now() }); resolve(ok); };
    try {
      const req = net.request({ url, redirect: 'follow' });
      if (headers && headers.userAgent) req.setHeader('User-Agent', headers.userAgent);
      if (headers && headers.referrer) req.setHeader('Referer', headers.referrer);
      const timer = setTimeout(() => { try { req.abort(); } catch (_) {} finish(false); }, 6000);
      req.on('response', (res) => {
        clearTimeout(timer);
        const ok = res.statusCode < 400;
        // Guard against responses that never end (live TS streams, stalled CDNs)
        setTimeout(() => { try { req.abort(); } catch (_) {} finish(ok && !/<html/i.test(got)); }, 2500);
        // read a little to make sure it's a manifest/stream and not an HTML error page
        let got = '';
        res.on('data', (c) => { got += c.toString('utf8', 0, 300); if (got.length >= 200) { try { req.abort(); } catch (_) {} } });
        res.on('end', () => finish(ok && !/<html/i.test(got)));
        res.on('error', () => finish(ok && !/<html/i.test(got)));
        res.on('aborted', () => finish(ok && !/<html/i.test(got)));
      });
      req.on('error', () => { clearTimeout(timer); finish(false); });
      req.end();
    } catch (_) { finish(false); }
  });
}

ipcMain.handle('streams:probe', async (_e, items) => {
  const results = {};
  const queue = [...items];
  const t0 = Date.now();
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      results[it.url] = await probeOne(it.url, it);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (process.env.GLASSTV_DEBUG) console.log(`PROBE ${items.length} in ${Date.now() - t0}ms, live=${Object.values(results).filter(Boolean).length}`);
  return results;
});

// ---- Premier League fixtures (TheSportsDB public dataset) ----
const EPL_ID = 4328;
let fixturesCache = { at: 0, data: null };
ipcMain.handle('fixtures:epl', async () => {
  if (fixturesCache.data && Date.now() - fixturesCache.at < 10 * 60 * 1000) return fixturesCache.data;
  const API = 'https://www.thesportsdb.com/api/v1/json/123';
  const get = async (u) => { try { return JSON.parse(await fetchText(u)); } catch (_) { return {}; } };
  // The free key only returns one event from next/past, but a whole matchweek from eventsround —
  // so use "next" to find the current round + season, then pull the surrounding rounds.
  const next = await get(`${API}/eventsnextleague.php?id=${EPL_ID}`);
  const anchor = (next.events || [])[0];
  let events = next.events || [];
  if (anchor && anchor.intRound && anchor.strSeason) {
    const r = Number(anchor.intRound);
    const rounds = await Promise.all([r - 1, r, r + 1].filter((x) => x >= 1 && x <= 38).map((x) => get(`${API}/eventsround.php?id=${EPL_ID}&r=${x}&s=${anchor.strSeason}`)));
    const seen = new Set();
    events = [];
    for (const rr of rounds) for (const e of rr.events || []) if (!seen.has(e.idEvent)) { seen.add(e.idEvent); events.push(e); }
  } else {
    const past = await get(`${API}/eventspastleague.php?id=${EPL_ID}`);
    events = events.concat(past.events || []);
  }
  // strTimestamp is UTC but carries no zone suffix
  const ts = (s) => (s ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z').getTime() : null);
  const norm = (e) => ({
    id: e.idEvent, round: e.intRound, home: e.strHomeTeam, away: e.strAwayTeam,
    homeBadge: e.strHomeTeamBadge, awayBadge: e.strAwayTeamBadge,
    homeScore: e.intHomeScore, awayScore: e.intAwayScore,
    start: ts(e.strTimestamp) || (e.dateEvent ? new Date(`${e.dateEvent}T${e.strTime || '15:00:00'}Z`).getTime() : null),
    venue: e.strVenue, status: e.strStatus, tv: e.strTVStation,
  });
  const all = events.map(norm);
  const now = Date.now();
  const finished = (f) => f.homeScore != null && f.awayScore != null && f.start && now > f.start + 115 * 60 * 1000;
  const data = { fetchedAt: now, upcoming: all.filter((f) => !finished(f)), recent: all.filter(finished) };
  fixturesCache = { at: Date.now(), data };
  return data;
});

ipcMain.handle('stream:headers', (_e, { url, userAgent, referrer }) => {
  try {
    const host = new URL(url).hostname;
    if (userAgent || referrer) streamHeaders.set(host, { userAgent, referrer });
    else streamHeaders.delete(host);
  } catch (_) {}
  return true;
});

ipcMain.handle('window:fullscreen', (_e, flag) => {
  if (!win) return false;
  const target = typeof flag === 'boolean' ? flag : !win.isFullScreen();
  win.setFullScreen(target);
  return target;
});

ipcMain.handle('window:isFullscreen', () => (win ? win.isFullScreen() : false));

// Dev aid: GLASSTV_SHOT=<dir> captures the window to PNGs after running a scripted tour.
async function debugTour(dir) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  const js = (code) => win.webContents.executeJavaScript(code).catch((e) => console.error('tour js', e));
  await sleep(6000); await shot('1-home');
  await js(`document.querySelector('.tab[data-view="categories"]').click()`); await sleep(1500); await shot('2-categories');
  await js(`document.querySelector('.tab[data-view="countries"]').click()`); await sleep(1500); await shot('3-countries');
  await js(`document.querySelector('.tab[data-view="sports"]').click()`); await sleep(12000); await shot('7-sports');
  await js(`document.querySelector('.fixture-watch') && document.querySelector('.fixture-watch').click()`); await sleep(1000); await shot('8-match');
  await js(`document.querySelector('#match-close').click(); document.querySelector('#sources-btn').click()`); await sleep(800); await shot('9-sources');
  await js(`document.querySelector('#src-url').value = 'https://iptv-org.github.io/iptv/categories/sports.m3u'; document.querySelector('#src-name').value = 'Test Provider'; document.querySelector('#src-add').click()`);
  await sleep(6000); await shot('10-source-added');
  await js(`document.querySelector('#sources-close').click(); document.querySelector('.tab[data-view="home"]').click()`); await sleep(1500); await shot('11-home-with-source');
  await js(`(async () => { for (const s of await window.glasstv.listSources()) await window.glasstv.removeSource(s.id); })()`); await sleep(500);
  await js(`document.querySelector('.tab[data-view="home"]').click()`); await sleep(1200);
  await js(`document.querySelector('.row .card').click()`); await sleep(9000); await shot('4-player');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}))`); await sleep(9000); await shot('5-surf');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'l'}))`); await sleep(1200); await shot('6-drawer');
  console.log('TOUR DONE');
}

// Dev aid: GLASSTV_TEST="Name1|Name2" plays each named channel and reports whether frames arrive.
async function debugPlayTest(names, dir) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(6000);
  for (const name of names) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const q = ${JSON.stringify(name.toLowerCase())};
      const App = window.__dbg; const ch = App.channels.find(c => c.name.toLowerCase() === q) || App.channels.find(c => c.name.toLowerCase().includes(q));
      if (!ch) return 'not found: ' + q;
      Player.open([ch], 0, 'test');
      await new Promise(r => setTimeout(r, 10000));
      const v = document.getElementById('video');
      const out = { name: ch.name, url: ch.url, t: v.currentTime.toFixed(1), w: v.videoWidth, h: v.videoHeight, paused: v.paused, err: !document.getElementById('player-error').classList.contains('hidden') };
      return JSON.stringify(out);
    })()`).catch((e) => String(e));
    console.log('PLAYTEST', r);
    if (process.env.GLASSTV_FORCE_AUDIO) {
      await win.webContents.executeJavaScript(`(() => { const ch = window.__dbg.channels.find(c => c.name === ${JSON.stringify(name)}) || window.__dbg.channels[0];
        document.getElementById('player').classList.add('audio-only');
        document.getElementById('audio-logo').innerHTML = '<img src="' + ch.logo + '">';
        document.getElementById('audio-name').textContent = ch.name; })()`).catch(() => {});
      await sleep(800);
    }
    if (dir) { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, `playtest-${name.replace(/\W+/g, '_')}.png`), img.toPNG()); }
    await win.webContents.executeJavaScript('Player.close()').catch(() => {});
  }
  console.log('PLAYTEST DONE');
}

app.whenReady().then(() => {
  installHeaderHooks();
  createWindow();
  if (process.env.GLASSTV_SHOT) win.webContents.once('did-finish-load', () => debugTour(process.env.GLASSTV_SHOT));
  if (process.env.GLASSTV_TEST) win.webContents.once('did-finish-load', () => debugPlayTest(process.env.GLASSTV_TEST.split('|'), process.env.GLASSTV_SHOT_DIR));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
