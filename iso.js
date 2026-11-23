// Iso 3D game server, running inside Bluu. Players connect to /ws/iso.
// The basketball rules live in public/iso-core.js, which the game page uses too.
module.exports = function iso3d(wss, bluu) {
const I = require('./public/iso-core.js');
const TICK = 1 / 30, BOT_WAIT = 10, RESULTS = 9;
const BOT_NAMES = ['Buckets', 'Splash', 'Handles', 'Lockdown', 'Swish', 'Dime', 'Posterboy', 'Glass', 'Cookie', 'Heat Check', 'Ankles', 'Brick', 'Ice', 'Bounce', 'Fadeaway', 'Hooper'];
const players = new Map(), rooms = new Map(), byCode = new Map();
const Q = { 1: [], 2: [], 3: [] };
let nextId = 1;
const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
const clean = (s) => String(s || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 14);
const now = () => Date.now() / 1000;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function cleanBuild(b) {   // ratings 60-99 within the point budget, up to 6 badges
  b = b && typeof b === 'object' ? b : {};
  const attrs = {}; let sum = 0;
  for (const a of I.ATTRS) { const v = Math.max(60, Math.min(99, Math.round(Number(b.attrs && b.attrs[a.id]) || 80))); attrs[a.id] = v; sum += v; }
  if (sum > I.BUDGET + 2) for (const a of I.ATTRS) attrs[a.id] = 84;
  const badges = {}; let n = 0;
  for (const x of I.BADGES) { const lv = Math.max(0, Math.min(4, (b.badges && b.badges[x.id]) | 0)); if (lv && n < 6) { badges[x.id] = lv; n++; } }
  const look = b.look && typeof b.look === 'object' ? JSON.parse(JSON.stringify(b.look, (k, v) => typeof v === 'string' ? v.slice(0, 20) : v)) : {};
  const dunks = Array.isArray(b.dunks) ? b.dunks.filter(d => I.DUNKS.includes(d)) : ['tomahawk'];
  return { attrs, badges, look, dunks: dunks.length ? dunks : ['tomahawk'] };
}
function botBuild() { const a = pick(I.ARCHETYPES), badges = {}; a.badges.slice(0, 4).forEach(x => { badges[x] = 2; }); return { attrs: Object.assign({}, a.attrs), badges, look: { primary: pick(['#e8283c', '#1f86e8', '#19b85a', '#ff9a1a', '#8e5bff', '#222831']), num: Math.floor(Math.random() * 100), skin: Math.floor(Math.random() * 5), hair: Math.floor(Math.random() * 5) }, dunks: ['tomahawk', 'windmill'] }; }

/* ================= leaderboard (saved in MongoDB when MONGODB_URI is set) ================= */
const LB = new Map(); let lbDB = null;
(async () => {
  if (!process.env.MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
    lbDB = c.db('isogame').collection('ladder');
    for (const d of await lbDB.find({}).toArray()) LB.set(d.key, { key: d.key, name: d.name, e1: d.e1 || 1000, e2: d.e2 || 1000, e3: d.e3 || 1000, w: d.w || 0 });
  } catch (e) { console.error('Iso 3D leaderboard DB', e.message); }
})();
function lbMsg() {
  const all = [...LB.values()], top = (k) => all.filter(x => x[k] !== 1000).sort((a, b) => b[k] - a[k]).slice(0, 10).map(x => [x.name, x[k]]);
  return { t: 'lb', e1: top('e1'), e2: top('e2'), e3: top('e3') };
}
function lbUpdate(p, d) {
  const key = p.acctId ? 'a' + String(p.acctId) : p.devId; if (!key) return;
  const s = LB.get(key) || { key, name: p.name, e1: 1000, e2: 1000, e3: 1000, w: 0 };
  s.name = p.name; for (const k of ['e1', 'e2', 'e3']) if (Number.isFinite(+d[k])) s[k] = Math.max(0, Math.min(3500, Math.round(+d[k]))); if (Number.isFinite(+d.w)) s.w = +d.w;
  LB.set(key, s); if (lbDB) lbDB.updateOne({ key }, { $set: s }, { upsert: true }).catch(() => {});
}

/* ================= queues and rooms ================= */
function qRemove(p) { for (const k in Q) { const i = Q[k].indexOf(p); if (i >= 0) Q[k].splice(i, 1); } if (p.q) { p.q = null; send(p, { t: 'q', size: null }); } }
setInterval(() => {
  for (const k in Q) {
    const q = Q[k]; if (!q.length) continue;
    const need = 2 * k, wait = now() - q[0].qSince;
    if (q.length >= need || wait >= BOT_WAIT) {
      const humans = q.splice(0, need); for (const h of humans) h.q = null;
      const r = makeRoom(false); r.cfg = { size: +k, shotClock: 14, bots: true };
      for (const h of humans) joinRoom(h, r, true);
      startRoom(r);
    } else for (const h of q) send(h, { t: 'q', size: +k, n: q.length, need, bots: Math.ceil(BOT_WAIT - wait) });
  }
}, 500);
function code6() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = ''; for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)]; c += '-' + String(10 + Math.floor(Math.random() * 90)); return byCode.has(c) ? code6() : c; }
function makeRoom(priv) { const r = { id: nextId++, priv, code: priv ? code6() : null, host: null, cfg: { size: 1, shotClock: 14, bots: true }, players: new Set(), state: 'lobby', game: null, loop: null }; rooms.set(r.id, r); if (r.code) byCode.set(r.code, r); return r; }
function roomInfo(r) { return { t: 'room', code: r.code, priv: r.priv, host: r.host, cfg: r.cfg, state: r.state, players: [...r.players].map(p => ({ id: p.id, name: p.name, team: p.team, color: p.build.look.primary || '#888' })) }; }
const sendRoom = (r) => { const m = JSON.stringify(roomInfo(r)); for (const p of r.players) send(p, m); };
function joinRoom(p, r, quiet) {
  if (p.room === r) return; leaveRoom(p); qRemove(p);
  r.players.add(p); p.room = r; if (!r.host) r.host = p.id;
  if (!quiet) sendRoom(r);
}
function leaveRoom(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p); p.room = null;
  const g = r.game;
  if (g && g.bodies.has(p.id) && r.state === 'playing') { const b = g.bodies.get(p.id); g.removeBody(p.id); if (r.players.size) addBot(g, b.team, b.slot); }
  if (!r.players.size) return closeRoom(r);
  if (r.host === p.id) r.host = [...r.players][0].id;
  sendRoom(r);
}
function closeRoom(r) { clearInterval(r.loop); rooms.delete(r.id); if (r.code) byCode.delete(r.code); for (const p of r.players) { p.room = null; send(p, { t: 'over' }); } r.players.clear(); }
function addBot(g, team, slot) { const b = botBuild(); g.addBody(Object.assign({ id: 100000 + nextId++, name: pick(BOT_NAMES), team, bot: true, slot, skill: 0.6 + Math.random() * 0.3, elo: 1000 }, b)); }
function startRoom(r) {
  const size = r.cfg.size, g = new I.Game({ size, shotClock: r.cfg.shotClock, redemption: size === 1 });
  const humans = [...r.players].sort(() => Math.random() - 0.5), counts = [0, 0];
  for (const h of humans) {
    const team = r.priv && h.team != null && counts[h.team] < size ? h.team : counts[0] <= counts[1] ? 0 : 1;
    if (counts[team] >= size) continue;
    g.addBody(Object.assign({ id: h.id, name: h.name, team, remote: true, slot: counts[team]++, ballSkin: h.ballSkin, elo: h.elo['e' + size] || 1000 }, h.build));
  }
  if (r.cfg.bots || !r.priv) for (const t of [0, 1]) while (counts[t] < size) addBot(g, t, counts[t]++);
  r.game = g; r.state = 'playing';
  const st = JSON.stringify(g.start());
  for (const h of humans) send(h, st);
  let k = 0, resultsAt = 0;
  clearInterval(r.loop);
  r.loop = setInterval(() => {
    try {
      if (r.state === 'results') { if (now() - resultsAt > RESULTS) { clearInterval(r.loop); r.game = null; if (r.priv) { r.state = 'lobby'; sendRoom(r); } else closeRoom(r); } return; }
      g.step(TICK);
      const ev = g.drain();
      if (ev.length) {
        const shared = [], own = new Map();
        for (const e of ev) {
          if (e.t === 'stun') { const p = players.get(e.id); if (p) { if (!own.has(p)) own.set(p, []); own.get(p).push(e); } }
          else shared.push(e);
          if (e.t === 'end') { r.state = 'results'; resultsAt = now(); recordEnd(e.r); }
        }
        const sm = shared.length ? JSON.stringify({ t: 'ev', l: shared }) : null;
        for (const p of r.players) { if (sm) send(p, sm); const mine = own.get(p); if (mine) send(p, { t: 'ev', l: mine }); }
      }
      if (++k % 2 === 0) { const s = JSON.stringify(g.snap()); for (const p of r.players) send(p, s); }
    } catch (e) { console.error('iso room', e); }
  }, TICK * 1000);
  sendRoom(r);
}
async function recordEnd(res) {
  const A = bluu.accounts; if (!A || !A.col) return;
  for (const pl of res.players) {
    const p = players.get(pl.id); if (!p || !p.acctId) continue;
    const won = res.win === pl.team, s = pl.stats;
    A.col.updateOne({ _id: p.acctId }, { $inc: { 'isostats.games': 1, 'isostats.wins': won ? 1 : 0, 'isostats.losses': won ? 0 : 1, 'isostats.pts': s.pts || 0, 'isostats.dunks': s.dunks || 0, 'isostats.ankles': s.ankles || 0 } }).catch(() => {});
  }
}
async function useAccount(p, tok) {
  const A = bluu.accounts; if (!A || !A.col) return;
  try {
    const a = await A.col.findOne({ tokens: A.hashTok(tok) }); if (!a || p.tok !== tok) return;
    p.acctId = a._id; p.name = a.username;
    send(p, { t: 'acct', name: a.username }); send(p, { t: 'prof', data: a.iso || null, updated: a.isoUpdated || 0 });
  } catch (e) { console.error('iso account', e.message); }
}

/* ================= messages ================= */
wss.on('connection', (ws) => {
  const p = { id: nextId++, ws, name: 'Player', build: cleanBuild({}), ballSkin: 'classic', elo: {}, room: null, q: null, team: null };
  players.set(p.id, p);
  send(p, { t: 'welcome', id: p.id, online: players.size }); send(p, lbMsg());
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const r = p.room, g = r && r.state === 'playing' ? r.game : null;
    try {
      switch (m.t) {
        case 's': if (g) g.report(p.id, m); break;
        case 'fake': if (g) g.fake(p.id); break;
        case 'move': if (g) g.move(p.id, String(m.m)); break;
        case 'rise': if (g) g.shotStart(p.id); break;
        case 'rel': if (g) g.release(p.id, m.q, !!m.sb); break;
        case 'dunk': if (g) g.dunk(p.id); break;
        case 'steal': if (g) g.steal(p.id); break;
        case 'jump': if (g) { const b = g.bodies.get(p.id); if (b) g.jumped(b); } break;
        case 'pass': if (g) g.pass(p.id, m.to | 0, !!m.lob); break;
        case 'oop': if (g) g.oop(p.id); break;
        case 'pick': if (g) g.pick(p.id); break;
        case 'chat': if (g) g.chat(p.id, m.i); else if (r) { const s = JSON.stringify({ t: 'ev', l: [{ t: 'chat', id: p.id, i: m.i | 0 }] }); for (const q of r.players) send(q, s); } break;
        case 'ping': send(p, { t: 'pong', c: m.c }); break;
        case 'hello': {
          if (!p.acctId) p.name = clean(m.name) || 'Player';
          p.build = cleanBuild(m.build); p.ballSkin = String(m.ball || 'classic').slice(0, 20); p.devId = /^[a-z0-9]{8,16}$/i.test(String(m.uid || '')) ? 'd' + m.uid : p.devId;
          p.elo = { e1: +m.elo1 || 1000, e2: +m.elo2 || 1000, e3: +m.elo3 || 1000 };
          const tok = String(m.token || '').slice(0, 100); if (tok && tok !== p.tok) { p.tok = tok; useAccount(p, tok); }
          if (r) sendRoom(r); break;
        }
        case 'save': {   // your Iso 3D progress, kept on your Bluu account
          if (m.lb && typeof m.lb === 'object') { lbUpdate(p, m.lb); }
          const A = bluu.accounts; if (!p.acctId || !A || !A.col || !m.data || typeof m.data !== 'object') break;
          if (JSON.stringify(m.data).length > 120000) break;
          A.col.updateOne({ _id: p.acctId }, { $set: { iso: m.data, isoUpdated: Number(m.updated) || Date.now() } }).catch(() => {});
          break;
        }
        case 'lb': send(p, lbMsg()); break;
        case 'q': { const k = Math.max(1, Math.min(3, m.size | 0)); leaveRoom(p); qRemove(p); p.q = k; p.qSince = now(); Q[k].push(p); send(p, { t: 'q', size: k, n: Q[k].length, need: 2 * k, bots: BOT_WAIT }); break; }
        case 'qleave': qRemove(p); break;
        case 'create': { const room = makeRoom(true); p.team = 0; joinRoom(p, room); break; }
        case 'join': { const room = byCode.get(String(m.code || '').toUpperCase().trim()); if (!room) { send(p, { t: 'err', text: 'No room with that code.' }); break; } if (room.state === 'playing') { send(p, { t: 'err', text: 'That room is in a game. Try again in a minute.' }); break; } p.team = 1; joinRoom(p, room); break; }
        case 'team': if (r && r.priv && r.state === 'lobby') { p.team = m.team ? 1 : 0; sendRoom(r); } break;
        case 'cfg': if (r && r.priv && r.host === p.id && r.state === 'lobby') { const c = m.cfg || {}; r.cfg = { size: Math.max(1, Math.min(3, c.size | 0 || 1)), shotClock: [0, 14, 24].includes(c.shotClock) ? c.shotClock : 14, bots: c.bots !== false }; sendRoom(r); } break;
        case 'start': if (r && r.priv && r.host === p.id && r.state === 'lobby') startRoom(r); break;
        case 'leave': leaveRoom(p); qRemove(p); send(p, { t: 'over' }); break;
      }
    } catch (e) { console.error('iso msg', e); }
  });
  ws.on('close', () => { qRemove(p); leaveRoom(p); players.delete(p.id); });
});
bluu.iso = { online: () => players.size };
console.log('Iso 3D is ready at /iso-3d');
};
