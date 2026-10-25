// Parses the iptv-org index.m3u into channel objects and builds category/country indexes.
(function () {
  const regionNames = (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) { return null; }
  })();

  const ATTR_RE = /([\w-]+)="([^"]*)"/g;
  const QUALITY_RE = /\s*\((\d{3,4}p|SD|HD|FHD|UHD|4K)\)\s*$/i;
  const TAG_RE = /\s*\[(Geo-blocked|Not 24\/7)\]/gi;

  function countryName(code) {
    if (!code) return 'International';
    const upper = code.toUpperCase();
    if (upper === 'INT' || upper === 'UNDEFINED') return 'International';
    try { const n = regionNames && regionNames.of(upper); if (n && n !== upper) return n; } catch (_) {}
    return upper;
  }

  function flagEmoji(code) {
    if (!code || code.length !== 2) return '🌐';
    const base = 127397;
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => base + c.charCodeAt(0)));
  }

  function parse(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let current = null;
    let idx = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const comma = line.lastIndexOf(',');
        const attrPart = line.slice(0, comma);
        let rawName = line.slice(comma + 1).trim();
        const attrs = {};
        let m;
        ATTR_RE.lastIndex = 0;
        while ((m = ATTR_RE.exec(attrPart))) attrs[m[1]] = m[2];

        let quality = '';
        const q = rawName.match(QUALITY_RE);
        if (q) { quality = q[1]; rawName = rawName.replace(QUALITY_RE, ''); }
        const tags = [];
        rawName = rawName.replace(TAG_RE, (_, t) => { tags.push(t); return ''; }).trim();

        const tvgId = attrs['tvg-id'] || '';
        const idCore = tvgId.split('@')[0];
        const dot = idCore.lastIndexOf('.');
        const cc = dot > -1 ? idCore.slice(dot + 1).toLowerCase() : '';
        const groups = (attrs['group-title'] || 'Undefined')
          .split(';').map((s) => s.trim()).filter(Boolean)
          .map((g) => (g === 'Undefined' ? 'Other' : g));

        current = {
          id: idx++,
          tvgId,
          name: rawName,
          logo: attrs['tvg-logo'] || '',
          categories: groups.length ? groups : ['Other'],
          country: cc.length === 2 ? cc : '',
          countryName: countryName(cc.length === 2 ? cc : ''),
          quality,
          tags,
          userAgent: attrs['http-user-agent'] || '',
          referrer: attrs['http-referrer'] || '',
          url: '',
        };
      } else if (line.startsWith('#EXTVLCOPT')) {
        if (!current) continue;
        const eq = line.indexOf('=');
        const key = line.slice(line.indexOf(':') + 1, eq);
        const val = line.slice(eq + 1);
        if (key === 'http-user-agent') current.userAgent = val;
        if (key === 'http-referrer') current.referrer = val;
      } else if (line.startsWith('#')) {
        continue;
      } else if (current) {
        current.url = line;
        current.search = (current.name + ' ' + current.countryName + ' ' + current.categories.join(' ')).toLowerCase();
        channels.push(current);
        current = null;
      }
    }
    return channels;
  }

  function buildIndexes(channels) {
    const categories = new Map();
    const countries = new Map();
    for (const ch of channels) {
      for (const c of ch.categories) {
        if (!categories.has(c)) categories.set(c, []);
        categories.get(c).push(ch);
      }
      const key = ch.country || 'int';
      if (!countries.has(key)) countries.set(key, { code: ch.country, name: ch.countryName, flag: flagEmoji(ch.country), channels: [] });
      countries.get(key).channels.push(ch);
    }
    const categoryList = [...categories.entries()]
      .map(([name, list]) => ({ name, channels: list }))
      .sort((a, b) => (a.name === 'Other' ? 1 : b.name === 'Other' ? -1 : b.channels.length - a.channels.length));
    const countryList = [...countries.values()].sort((a, b) => b.channels.length - a.channels.length);
    return { categories: categoryList, countries: countryList };
  }

  window.Playlist = { parse, buildIndexes, flagEmoji, countryName };
})();
