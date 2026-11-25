// Bluu: one website with all of Electrix Games' games, sharing one account system.
//   /                 the Bluu home page (games, your profile, log in)
//   /arena-clash      Arena Clash            (game server: arena.js, socket /ws/arena)
//   /lightning-duels  Lightning Duels        (game server: duels.js, socket /ws/duels)
//   /iso-3d           Iso 3D                 (game server: iso.js, socket /ws/iso, rules shared in public/iso-core.js)
//   /slap-brawl       Slap Brawl             (game server: slap.js, socket /ws/slap, rules shared in public/slap-core.js)
//   /pulse-dash       Pulse Dash             (online levels and saves: dash.js, web API /api/dash/...)
// Environment variables on Render: MONGODB_URI (accounts and leaderboards), DEV_KEY (developer powers).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const bluu = {};   // the games put their player counts and the shared accounts in here

/* ================= the games ================= */
const GAMES = [
  { id: 'arena', path: '/ws/arena', file: './arena', opts: { maxPayload: 16384 } },
  { id: 'duels', path: '/ws/duels', file: './duels', opts: { maxPayload: 16384 } },
  { id: 'slap', path: '/ws/slap', file: './slap', opts: { maxPayload: 80000 } },
  { id: 'iso', path: '/ws/iso', file: './iso', opts: { maxPayload: 150000 } },
];
const sockets = {};
for (const g of GAMES) {
  const wss = new WebSocketServer({ noServer: true, ...g.opts });
  require(g.file)(wss, bluu);
  sockets[g.path] = wss;
}
require('./dash')(bluu);   // Pulse Dash has no socket, only web API routes

/* ================= pages ================= */
const PAGES = {   // web address -> file in the public folder
  '/': 'index.html',
  '/arena-clash': 'arena-clash.html',
  '/lightning-duels': 'lightning-duels.html',
  '/slap-brawl': 'slap-brawl.html',
  '/slap-core.js': 'slap-core.js',
  '/iso-3d': 'iso-3d.html',
  '/iso-core.js': 'iso-core.js',
  '/pulse-dash': 'pulse-dash.html',
  '/ads.txt': 'ads.txt',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const files = {};
for (const [url, name] of Object.entries(PAGES)) {   // loaded once at startup, zipped so pages load faster
  const full = path.join(__dirname, 'public', name);
  if (!fs.existsSync(full)) { console.log('Missing file: public/' + name); continue; }
  const body = fs.readFileSync(full);
  files[url] = { body, gz: zlib.gzipSync(body), type: TYPES[path.extname(name)] || 'application/octet-stream' };
}
function servePage(req, res, url) {
  const f = files[url];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<h1>Not found</h1><p><a href="/">Back to Bluu</a></p>'); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  res.end(gz ? f.gz : f.body);
}

/* ================= accounts (the same accounts Arena Clash already uses) ================= */
const tries = new Map();   // ip -> recent login attempts
const tooMany = (ip) => { const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 60000); t.push(now); tries.set(ip, t); return t.length > 8; };
setInterval(() => { const now = Date.now(); for (const [ip, t] of tries) if (!t.some(x => now - x < 60000)) tries.delete(ip); }, 60000);
function profileOf(a) {
  const A = bluu.accounts, lb = a.lb || {}, d = bluu.duels && bluu.duels.stats(a.uid);
  return {
    username: a.username, uid: a.uid, dev: !!a.dev, created: a.created || 0,
    arena: { wins: lb.wins || 0, kills: lb.kills || 0, matches: lb.matches || 0, rp: a.rp || 0, rank: A.rankName(a.rp || 0), crystals: (a.wallet && a.wallet.crystals) || 0 },
    slap: { wins: (a.slapstats && a.slapstats.wins) || 0, losses: (a.slapstats && a.slapstats.losses) || 0, goals: (a.slapstats && a.slapstats.goals) || 0, kos: (a.slapstats && a.slapstats.kos) || 0, matches: (a.slapstats && a.slapstats.matches) || 0, elo: (a.slap && a.slap.elo) || 1000 },
    iso: { wins: (a.isostats && a.isostats.wins) || 0, losses: (a.isostats && a.isostats.losses) || 0, pts: (a.isostats && a.isostats.pts) || 0, dunks: (a.isostats && a.isostats.dunks) || 0, elo: (a.iso && a.iso.elo && a.iso.elo.e1) || 1000 },
    dash: { stars: (a.dash && a.dash.stars) || 0, coins: (a.dash && a.dash.coins) || 0, beaten: a.dash && a.dash.lv ? Object.values(a.dash.lv).filter(r => r.done).length : 0 },
    duels: { wins: (d && d.wins) || 0, losses: (d && d.losses) || 0, streak: (d && d.streak) || 0, bestStreak: (d && d.bestStreak) || 0, matches: (d && d.matches) || 0 },
  };
}
async function api(route, body, ip) {
  if (route === 'status') return { ok: true, accounts: !!(bluu.accounts && bluu.accounts.col), online: { arena: bluu.arena ? bluu.arena.online() : 0, duels: bluu.duels ? bluu.duels.online() : 0, slap: bluu.slap ? bluu.slap.online() : 0, iso: bluu.iso ? bluu.iso.online() : 0, dash: bluu.dash ? bluu.dash.online() : 0 } };
  if (route.startsWith('dash/')) return bluu.dash.api(route.slice(5), body, ip);
  const A = bluu.accounts, col = A && A.col;
  if (!col) return { ok: false, error: process.env.MONGODB_URI ? 'Accounts are still starting up. Try again in a few seconds.' : 'Accounts are offline right now. You can still play as a guest.' };
  const username = String(body.username || '').trim(), password = String(body.password || '');
  if (route === 'signup') {
    if (tooMany(ip)) return { ok: false, error: 'Too many tries. Wait a minute and try again.' };
    if (!A.okName(username)) return { ok: false, error: 'Usernames are 3 to 14 letters, numbers or _.' };
    if (password.length < 6 || password.length > 100) return { ok: false, error: 'Passwords need at least 6 characters.' };
    const lower = username.toLowerCase();
    if (lower === A.DEV_NAME) return { ok: false, error: 'That name is reserved.' };
    const now = Date.now(), salt = crypto.randomBytes(16).toString('hex');
    let uid; do uid = crypto.randomBytes(6).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(8, 'X').slice(0, 8); while (await col.findOne({ uid }));
    const a = { username, lower, salt, hash: A.hashPw(password, salt), uid, dev: false, created: now, updated: now, tokens: [], wallet: A.cleanWallet({}), profile: {}, lb: { kills: 0, wins: 0, matches: 0 }, earn: { hour: now, amount: 0 } };
    try { const r = await col.insertOne(a); a._id = r.insertedId; }
    catch (e) { return { ok: false, error: e.code === 11000 ? 'That username is taken.' : 'Could not create the account. Try again.' }; }
    return { ok: true, token: await A.newToken(a), profile: profileOf(a) };
  }
  if (route === 'login') {
    if (tooMany(ip)) return { ok: false, error: 'Too many tries. Wait a minute and try again.' };
    const a = await col.findOne({ lower: username.toLowerCase() });
    if (!a || A.hashPw(password, a.salt) !== a.hash) return { ok: false, error: 'Wrong username or password.' };
    return { ok: true, token: await A.newToken(a), profile: profileOf(a) };
  }
  const token = String(body.token || '').slice(0, 100);
  if (route === 'me') {
    const a = token && await col.findOne({ tokens: A.hashTok(token) });
    return a ? { ok: true, profile: profileOf(a) } : { ok: false, expired: true, error: 'Your login expired. Please log in again.' };
  }
  if (route === 'logout') { if (token) await col.updateOne({ tokens: A.hashTok(token) }, { $pull: { tokens: A.hashTok(token) } }); return { ok: true }; }
  return null;
}

/* ================= the web server ================= */
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (url.startsWith('/api/')) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    let raw = '';
    const limit = url.startsWith('/api/dash/') ? 700000 : 4096;   // Pulse Dash uploads whole levels
    req.on('data', c => { raw += c; if (raw.length > limit) req.destroy(); });
    req.on('end', async () => {
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}
      let out;
      try { out = await api(url.slice(5), body && typeof body === 'object' ? body : {}, ip); } catch (e) { console.error('api', e); out = { ok: false, error: 'Something went wrong. Try again.' }; }
      res.writeHead(out ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out || { ok: false, error: 'Not found' }));
    });
    return;
  }
  servePage(req, res, url);
});
server.on('upgrade', (req, socket, head) => {   // each game has its own socket address
  const wss = sockets[(req.url || '').split('?')[0]];
  if (!wss) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
server.listen(PORT, () => console.log('Bluu is running on port ' + PORT));
