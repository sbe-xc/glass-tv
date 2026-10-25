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

ipcMain.handle('playlist:load', async (_e, { force } = {}) => {
  const p = cachePath();
  try {
    if (!force && fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
        return { text: fs.readFileSync(p, 'utf8'), fromCache: true, updatedAt: stat.mtimeMs };
      }
    }
  } catch (_) {}
  try {
    const text = await fetchText(PLAYLIST_URL);
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
      Player.close();
      return JSON.stringify(out);
    })()`).catch((e) => String(e));
    console.log('PLAYTEST', r);
  }
  if (dir) { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, 'playtest.png'), img.toPNG()); }
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
