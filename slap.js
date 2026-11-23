// Slap Brawl game server, running inside Bluu. Players connect to /ws/slap.
// The game rules live in public/slap-core.js, which the game page uses too.
module.exports = function slapBrawl(wss, bluu) {
const S = require('./public/slap-core.js');
const TICK = 1 / 30, BOT_WAIT = 10, RESULTS = 8;
const BOT_NAMES = ['Smacky', 'Glovey', 'Whapper', 'Thwack', 'Palmer', 'Knuckles', 'Bonk', 'Swatter', 'Clapton', 'Mittens', 'Pow', 'Wallop', 'Sir Slaps', 'Biff', 'Zonk', 'Bop'];
const BOT_SLAPPERS = ['default', 'gold', 'ruby', 'ice', 'magma', 'cyber', 'void', 'rgb'];
const players = new Map(), rooms = new Map(), byCode = new Map();
const Q = { bridge1: [], bridge2: [], bridge3: [], bridge4: [], koth: [] };
let nextId = 1;
const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
const clean = (s) => String(s || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 14);
const now = () => Date.now() / 1000;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function cleanLook(l) {
  l = l && typeof l === 'object' ? l : {};
  const w = (v) => String(v || '').replace(/[^a-z0-9_]/gi, '').slice(0, 20);
  return { slapper: w(l.slapper) || 'default', trail: w(l.trail) || 'none', ko: w(l.ko) || 'classic' };
}
function cleanMut(m) { const o = {}; if (m && typeof m === 'object') for (const x of S.MUTATORS) if (m[x.id]) o[x.id] = true; return o; }

/* ================= queues: quick bridge duels (1v1 to 4v4) and King of the Hill ================= */
const needFor = (key) => key === 'koth' ? 6 : 2 * +key.slice(6);
function qRemove(p) { for (const k in Q) { const i = Q[k].indexOf(p); if (i >= 0) Q[k].splice(i, 1); } if (p.q) { p.q = null; send(p, { t: 'q', key: null }); } }
setInterval(() => {
  for (const key in Q) {
    const q = Q[key]; if (!q.length) continue;
    const need = needFor(key), wait = now() - q[0].qSince;
    if (q.length >= need || wait >= BOT_WAIT) {
      const humans = q.splice(0, need);
      for (const h of humans) h.q = null;
      const room = makeRoom(false);
      room.cfg = { mode: key === 'koth' ? 'koth' : 'bridge', size: key === 'koth' ? 6 : +key.slice(6), arena: 'random', mut: {}, bots: true };
      for (const h of humans) joinRoom(h, room, true);
      startRoom(room);
    } else for (const h of q) send(h, { t: 'q', key, n: q.length, need, bots: Math.ceil(BOT_WAIT - wait) });
  }
}, 500);

/* ================= rooms ================= */
function code5() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)]; return byCode.has(c) ? code5() : c; }
function makeRoom(priv) {
  const r = { id: nextId++, priv, code: priv ? code5() : null, host: null, cfg: { mode: 'bridge', size: 1, arena: 'random', mut: {}, bots: true }, players: new Set(), state: 'lobby', match: null, loop: null, resultsAt: 0 };
  rooms.set(r.id, r); if (r.code) byCode.set(r.code, r); return r;
}
function roomInfo(r) { return { t: 'room', code: r.code, priv: r.priv, host: r.host, cfg: r.cfg, state: r.state, players: [...r.players].map(p => ({ id: p.id, name: p.name, color: p.color, title: p.title })) }; }
const sendRoom = (r) => { const m = JSON.stringify(roomInfo(r)); for (const p of r.players) send(p, m); };
function joinRoom(p, r, quiet) {
  if (p.room === r) return;
  leaveRoom(p); qRemove(p);
  r.players.add(p); p.room = r; if (!r.host) r.host = p.id;
  if (r.state === 'playing' && r.match) addToMatch(r, p);
  if (!quiet) sendRoom(r);
}
function leaveRoom(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p); p.room = null;
  if (r.match && r.match.bodies.has(p.id)) {
    const b = r.match.bodies.get(p.id), team = b.team, slot = b.slot;
    r.match.removeBody(p.id);
    if (r.state === 'playing' && r.cfg.mode !== 'koth' && r.players.size) addBot(r, team, slot);   // a bot takes their place
  }
  if (!r.players.size) return closeRoom(r);
  if (r.host === p.id) r.host = [...r.players][0].id;
  sendRoom(r);
}
function closeRoom(r) { clearInterval(r.loop); rooms.delete(r.id); if (r.code) byCode.delete(r.code); for (const p of r.players) { p.room = null; send(p, { t: 'over' }); } r.players.clear(); }
function addBot(r, team, slot) {
  const m = r.match, id = 100000 + nextId++;
  m.addBody({ id, name: pick(BOT_NAMES), team, bot: true, slot, color: Math.floor(Math.random() * 8), skill: 0.65 + Math.random() * 0.3,
    ability: pick(S.ABILITIES).id, look: { slapper: pick(BOT_SLAPPERS), trail: 'none', ko: 'classic' } });
}
function addToMatch(r, p) {   // someone joins a private room mid-match: take a bot's spot, or watch
  const m = r.match; if (!m || m.phase === 'end') return;
  const bot = [...m.bodies.values()].find(b => b.bot && !b.minion && !b.boss);
  let team = -1, slot = 0;
  if (bot) { team = bot.team; slot = bot.slot; m.removeBody(bot.id); }
  else if (r.cfg.mode === 'koth' ? m.bodies.size >= 8 : true) { send(p, m.start()); send(p, { t: 'you', id: p.id, watch: 1 }); return; }
  m.addBody({ id: p.id, name: p.name, team, remote: true, slot, color: p.color, look: p.look, ability: p.ability, title: p.title });
  send(p, m.start()); send(p, { t: 'you', id: p.id });
}
function startRoom(r) {
  const c = r.cfg, arena = c.arena === 'random' || !S.ARENAS.some(a => a.id === c.arena) ? pick(S.ARENAS).id : c.arena;
  const m = new S.Match({ mode: c.mode, arena, mut: c.mut });
  const humans = [...r.players];
  if (c.mode === 'koth') humans.forEach((h, i) => m.addBody({ id: h.id, name: h.name, team: -1, remote: true, slot: i, color: h.color, look: h.look, ability: h.ability, title: h.title }));
  else {
    const counts = [0, 0];
    humans.sort(() => Math.random() - 0.5).forEach(h => { const team = counts[0] <= counts[1] ? 0 : 1; m.addBody({ id: h.id, name: h.name, team, remote: true, slot: counts[team]++, color: h.color, look: h.look, ability: h.ability, title: h.title }); });
    if (c.bots || !r.priv) for (const t of [0, 1]) while (counts[t] < c.size) addBot({ match: m }, t, counts[t]++);
  }
  if (c.mode === 'koth' && (c.bots || !r.priv)) { let n = m.bodies.size; while (n < 6) { addBot({ match: m }, -1, n++); } }
  r.match = m; r.state = 'playing';
  const start = JSON.stringify(m.start());
  for (const h of humans) { send(h, start); send(h, { t: 'you', id: h.id }); }
  let k = 0;
  clearInterval(r.loop);
  r.loop = setInterval(() => {
    try {
      if (r.state === 'results') { if (now() - r.resultsAt > RESULTS) afterResults(r); return; }
      m.step(TICK);
      const ev = m.drain();
      if (ev.length) {
        const shared = [], own = new Map();
        for (const e of ev) {
          if (e.t === 'kb') { const p = players.get(e.id); if (p) { if (!own.has(p)) own.set(p, []); own.get(p).push(e); } }
          else shared.push(e);
          if (e.t === 'end') { r.state = 'results'; r.resultsAt = now(); recordEnd(r, e.r); }
        }
        const sm = shared.length ? JSON.stringify({ t: 'ev', l: shared }) : null;
        for (const p of r.players) { if (sm) send(p, sm); const mine = own.get(p); if (mine) send(p, { t: 'ev', l: mine }); }
      }
      if (++k % 2 === 0) { const st = JSON.stringify(m.snap()); for (const p of r.players) send(p, st); }
    } catch (e) { console.error('slap room', e); }
  }, TICK * 1000);
  sendRoom(r);
}
function afterResults(r) {
  clearInterval(r.loop); r.loop = null; r.match = null;
  if (!r.priv) return closeRoom(r);
  r.state = 'lobby'; sendRoom(r);
}

/* ================= saving to Bluu accounts ================= */
async function recordEnd(r, res) {
  const A = bluu.accounts; if (!A || !A.col) return;
  for (const pl of res.players) {
    const p = players.get(pl.id); if (!p || !p.acctId) continue;
    const won = res.mode === 'koth' ? res.win === pl.id : res.win === pl.team;
    A.col.updateOne({ _id: p.acctId }, { $inc: { 'slapstats.matches': 1, 'slapstats.wins': won ? 1 : 0, 'slapstats.losses': won ? 0 : 1, 'slapstats.goals': pl.stats.goals || 0, 'slapstats.kos': pl.stats.kos || 0, 'slapstats.slaps': pl.stats.hits || 0 } }).catch(() => {});
  }
}
async function useAccount(p, tok) {
  const A = bluu.accounts; if (!A || !A.col) return;
  try {
    const a = await A.col.findOne({ tokens: A.hashTok(tok) });
    if (!a || p.tok !== tok) return;
    p.acctId = a._id; p.name = a.username;
    send(p, { t: 'acct', name: a.username, dev: !!a.dev });
    send(p, { t: 'prof', data: a.slap || null, updated: a.slapUpdated || 0 });
  } catch (e) { console.error('slap account', e.message); }
}

/* ================= messages ================= */
wss.on('connection', (ws) => {
  const p = { id: nextId++, ws, name: 'Player', color: 0, look: cleanLook({}), ability: 'dash', title: '', room: null, q: null };
  players.set(p.id, p);
  send(p, { t: 'welcome', id: p.id, online: players.size });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const r = p.room, M = r && r.state === 'playing' ? r.match : null;
    try {
      switch (m.t) {
        case 's': if (M) M.report(p.id, m); break;
        case 'slap': if (M) M.slap(p.id, m.y, m.p); break;
        case 'parry': if (M) M.parry(p.id); break;
        case 'ab': if (M) M.useAbility(p.id, m.y, m.p); break;
        case 'slam': if (M && Array.isArray(m.p)) M.slamLand(p.id, +m.p[0] || 0, +m.p[1] || 0, +m.p[2] || 0); break;
        case 'dead': if (M) M.dead(p.id); break;
        case 'emote': if (M) M.emote(p.id, m.e); break;
        case 'hello': {
          if (!p.acctId) p.name = clean(m.name) || 'Player';
          p.color = Math.max(0, Math.min(7, m.color | 0)); p.look = cleanLook(m.look); p.ability = S.AB[m.ability] ? m.ability : 'dash';
          p.title = String(m.title || '').replace(/[<>]/g, '').slice(0, 24);
          const tok = String(m.token || '').slice(0, 100);
          if (tok && tok !== p.tok) { p.tok = tok; useAccount(p, tok); }
          if (M && M.bodies.has(p.id)) { const b = M.bodies.get(p.id); if (M.phase === 'pre' && M.t < 1) { b.ability = p.ability; b.look = p.look; } }
          if (r) sendRoom(r);
          break;
        }
        case 'save': {   // your Slap Brawl progress, kept on your Bluu account
          const A = bluu.accounts; if (!p.acctId || !A || !A.col || !m.data || typeof m.data !== 'object') break;
          const json = JSON.stringify(m.data); if (json.length > 60000) break;
          A.col.updateOne({ _id: p.acctId }, { $set: { slap: m.data, slapUpdated: Number(m.updated) || Date.now() } }).catch(() => {});
          break;
        }
        case 'q': {
          const key = m.kind === 'koth' ? 'koth' : 'bridge' + Math.max(1, Math.min(4, m.size | 0));
          leaveRoom(p); qRemove(p); p.q = key; p.qSince = now(); Q[key].push(p);
          send(p, { t: 'q', key, n: Q[key].length, need: needFor(key), bots: BOT_WAIT }); break;
        }
        case 'qleave': qRemove(p); break;
        case 'create': { const room = makeRoom(true); joinRoom(p, room); break; }
        case 'join': { const room = byCode.get(String(m.code || '').toUpperCase().trim()); if (!room) { send(p, { t: 'err', text: 'No room with that code.' }); break; } joinRoom(p, room); break; }
        case 'cfg': {
          if (!r || !r.priv || r.host !== p.id || r.state !== 'lobby') break;
          const c = m.cfg || {};
          r.cfg = { mode: c.mode === 'koth' ? 'koth' : 'bridge', size: Math.max(1, Math.min(4, c.size | 0 || 1)), arena: c.arena === 'random' || S.ARENAS.some(a => a.id === c.arena) ? c.arena : 'random', mut: cleanMut(c.mut), bots: c.bots !== false };
          sendRoom(r); break;
        }
        case 'start': if (r && r.priv && r.host === p.id && r.state === 'lobby') startRoom(r); break;
        case 'leave': leaveRoom(p); qRemove(p); send(p, { t: 'over' }); break;
      }
    } catch (e) { console.error('slap msg', e); }
  });
  ws.on('close', () => { qRemove(p); leaveRoom(p); players.delete(p.id); });
});

bluu.slap = { online: () => players.size };
console.log('Slap Brawl is ready at /slap-brawl');
};
