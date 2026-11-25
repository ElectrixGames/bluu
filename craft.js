// Bluucraft server, running inside Bluu.
//  - Multiplayer at /ws/craft: rooms opened from a player's own world (room codes) and 2 always-on public worlds.
//  - Web API at /api/craft/...: who is playing (ping) and Bluucraft stats saved to Bluu accounts.
// The world itself is generated in each browser from the seed. The server only keeps the CHANGES
// (blocks placed/broken, chests, furnaces...) and passes messages between the players.
module.exports = function bluucraft(wss, bluu) {
  if (!bluu) { bluu = wss; wss = null; }
  const MAX = 16;
  const num = (v) => { v = +v; return Number.isFinite(v) ? v : 0; };
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 24);
  const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };

  /* ---------- storage for the public worlds (MongoDB when available) ---------- */
  let db = null;
  if (process.env.MONGODB_URI) {
    (async () => {
      try { const { MongoClient } = require('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); db = c.db('bluucraft'); for (const r of PUBLIC) await loadPublic(r); console.log('Bluucraft worlds database ready'); }
      catch (e) { console.log('Bluucraft: no database (' + e.message + ')'); }
    })();
  }

  /* ---------- rooms ---------- */
  const rooms = new Map();   // code -> room
  function newRoom(o) {
    return {
      code: o.code, name: clean(o.name, 32) || 'World', seed: num(o.seed) | 0, mode: o.mode === 'creative' ? 'creative' : 'survival', diff: Math.max(0, Math.min(3, num(o.diff) | 0)), pvp: !!o.pvp,
      public: !!o.public, host: null, players: new Map(), snap: o.snap || null,
      edits: [new Map(), new Map(), new Map()],      // per dimension: "x,y,z" -> block id
      meta: [new Map(), new Map(), new Map()],       // per dimension: "x,y,z" -> data (chests, furnaces, levers...)
      flags: o.flags || {}, pdata: o.pdata || {}, items: new Map(), nextItem: 1, dirty: new Set(), metaDirty: false, created: Date.now(),
    };
  }
  const PUBLIC = [
    newRoom({ code: 'PUBLIC-SURVIVAL', name: 'Bluu Survival', seed: 1337420, mode: 'survival', diff: 2, public: true }),
    newRoom({ code: 'PUBLIC-CREATIVE', name: 'Bluu Creative', seed: 2026, mode: 'creative', diff: 0, public: true }),
  ];
  for (const r of PUBLIC) rooms.set(r.code, r);
  function code6() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c; do { c = ''; for (let i = 0; i < 4; i++) c += L[(Math.random() * L.length) | 0]; c += '-' + (10 + Math.floor(Math.random() * 90)); } while (rooms.has(c)); return c; }
  const chunkOf = (k) => { const [x, , z] = k.split(',').map(Number); return (x >> 4) + ',' + (z >> 4); };
  async function loadPublic(r) {
    if (!db) return;
    const docs = await db.collection('edits').find({ room: r.code }).toArray();
    for (const d of docs) for (const k in d.cells) r.edits[d.dim].set(k, d.cells[k]);
    const m = await db.collection('rooms').findOne({ _id: r.code });
    if (m) { r.flags = m.flags || {}; r.pdata = m.pdata || {}; for (let d = 0; d < 3; d++) for (const [k, v] of (m.meta && m.meta[d]) || []) r.meta[d].set(k, v); }
  }
  // public worlds are written to the database every 20 seconds (only the chunks that changed)
  setInterval(async () => {
    if (!db) return;
    for (const r of PUBLIC) {
      try {
        for (const key of r.dirty) {
          const [d, ck] = key.split('|'), cells = {};
          for (const [k, v] of r.edits[+d]) if (chunkOf(k) === ck) cells[k] = v;
          await db.collection('edits').updateOne({ _id: r.code + '|' + key }, { $set: { room: r.code, dim: +d, chunk: ck, cells } }, { upsert: true });
        }
        r.dirty.clear();
        if (r.metaDirty) { r.metaDirty = false; await db.collection('rooms').updateOne({ _id: r.code }, { $set: { flags: r.flags, pdata: r.pdata, meta: r.meta.map(m => [...m.entries()]) } }, { upsert: true }); }
      } catch (e) { console.log('Bluucraft save error', e.message); }
    }
  }, 20000);

  /* ---------- who runs what ----------
     For each dimension one player is the "authority": it runs circuits, weather and the boss for everyone.
     That's the host if they are in that dimension, otherwise whoever has been in the room longest. */
  function assignAuth(r) {
    const list = [...r.players.values()].sort((a, b) => a.joined - b.joined);
    for (let d = 0; d < 3; d++) {
      const inDim = list.filter(p => p.dim === d);
      const a = inDim.find(p => p === r.host) || inDim[0] || null;
      r['auth' + d] = a ? a.id : null;
    }
    const world = r.host && r.players.has(r.host.id) ? r.host : list[0];
    r.authWorld = world ? world.id : null;
    for (const p of list) { const dims = [0, 1, 2].filter(d => r['auth' + d] === p.id); const w = r.authWorld === p.id; const key = dims.join(',') + (w ? 'w' : ''); if (p.authKey !== key) { p.authKey = key; send(p, { t: 'auth', dims, world: w }); } }
  }
  function broadcast(r, m, except, dim) { const s = JSON.stringify(m); for (const p of r.players.values()) if (p !== except && (dim == null || p.dim === dim)) send(p, s); }
  function roomInfo(r) { return { code: r.code, name: r.name, seed: r.seed, mode: r.mode, diff: r.diff, pvp: r.pvp, public: r.public, flags: r.flags, host: r.host ? r.host.name : null }; }
  function playerInfo(p) { return { id: p.id, name: p.name, dim: p.dim, s: p.s || null, host: !!p.isHost }; }

  function join(p, r) {
    if (r.players.size >= MAX) return send(p, { t: 'err', m: 'That world is full (16 players).' });
    if ([...r.players.values()].some(o => o.name === p.name)) p.name = p.name.slice(0, 18) + Math.floor(Math.random() * 90 + 10);
    p.room = r; p.joined = Date.now(); p.dim = 0;
    const pd = r.pdata[p.name] || null; if (pd && pd.dim != null) p.dim = pd.dim | 0;
    r.players.set(p.id, p);
    send(p, {
      t: 'welcome', you: p.id, name: p.name, room: roomInfo(r), snap: r.snap, pdata: pd,
      edits: r.edits.map(m => [...m.entries()]), meta: r.meta.map(m => [...m.entries()]),
      players: [...r.players.values()].filter(o => o !== p).map(playerInfo), items: [...r.items.values()],
    });
    broadcast(r, { t: 'pj', p: playerInfo(p) }, p);
    assignAuth(r);
  }
  function leave(p) {
    const r = p.room; if (!r) return;
    r.players.delete(p.id); p.room = null;
    broadcast(r, { t: 'pl', id: p.id, name: p.name });
    if (r.host === p) {   // the host closed their world: everyone has to leave
      broadcast(r, { t: 'closed', m: r.host.name + ' closed their world.' });
      for (const o of r.players.values()) o.room = null;
      rooms.delete(r.code); return;
    }
    if (r.players.size) assignAuth(r);
  }

  /* ---------- message handling ---------- */
  let nextId = 1;
  if (wss) wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const p = { id: nextId++, ws, ip, name: 'Guest' + (1000 + Math.floor(Math.random() * 9000)), room: null, rate: 0, rateT: Date.now() };
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      // simple flood guard
      const now = Date.now(); if (now - p.rateT > 1000) { p.rateT = now; p.rate = 0; } if (++p.rate > 400) return;
      try { await handle(p, m); } catch (e) { console.log('Bluucraft message error', e.message); }
    });
    ws.on('close', () => leave(p));
  });
  async function handle(p, m) {
    const r = p.room;
    switch (m.t) {
      case 'hello': {
        if (m.token && bluu.accounts && bluu.accounts.col) { const a = await bluu.accounts.col.findOne({ tokens: bluu.accounts.hashTok(String(m.token).slice(0, 100)) }); if (a) { p.name = a.username; p.uid = a.uid; } }
        else if (m.name) p.name = clean(m.name, 16).replace(/[^\w]/g, '') || p.name;
        send(p, { t: 'hi', name: p.name, publics: PUBLIC.map(x => ({ code: x.code, name: x.name, mode: x.mode, n: x.players.size, max: MAX })) });
        return;
      }
      case 'list': send(p, { t: 'list', publics: PUBLIC.map(x => ({ code: x.code, name: x.name, mode: x.mode, n: x.players.size, max: MAX })) }); return;
      case 'host': {
        if (r) leave(p);
        const snap = m.snap && typeof m.snap === 'object' ? m.snap : null;
        if (JSON.stringify(snap || {}).length > 3500000) return send(p, { t: 'err', m: 'This world is too big to share right now.' });
        const room = newRoom({ code: code6(), name: m.name, seed: m.seed, mode: m.mode, diff: m.diff, pvp: m.pvp, snap, flags: m.flags || {}, pdata: m.pdata || {} });
        rooms.set(room.code, room); room.host = p; p.isHost = true;
        join(p, room); send(p, { t: 'hosting', code: room.code });
        return;
      }
      case 'join': {
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) return send(p, { t: 'err', m: 'No world with that code. Check the code and try again.' });
        if (r) leave(p); p.isHost = false; join(p, room); return;
      }
      case 'leave': if (r) { if (m.pdata) savePdata(r, p, m.pdata); leave(p); } return;
    }
    if (!r) return;
    switch (m.t) {
      case 's': {   // my position and state, sent 10 times a second
        p.s = [num(m.x), num(m.y), num(m.z), num(m.yaw), num(m.pitch), num(m.held) | 0, num(m.f) | 0, num(m.hp)];
        if ((m.d | 0) !== p.dim && m.d >= 0 && m.d <= 2) { p.dim = m.d | 0; broadcast(r, { t: 'pd', id: p.id, d: p.dim }); assignAuth(r); }
        return;
      }
      case 'set': {   // block changes: [[x,y,z,id], ...]
        const d = m.d | 0; if (d < 0 || d > 2 || !Array.isArray(m.c)) return;
        const out = [];
        for (const c of m.c.slice(0, 600)) {
          const x = c[0] | 0, y = c[1] | 0, z = c[2] | 0, id = c[3] | 0; if (y < 0 || y > 95 || id < 0 || id > 255) continue;
          const k = x + ',' + y + ',' + z; r.edits[d].set(k, id); if (r.public) r.dirty.add(d + '|' + chunkOf(k)); out.push([x, y, z, id]);
        }
        if (out.length) broadcast(r, { t: 'set', d, c: out, by: p.id }, p);
        return;
      }
      case 'meta': {
        const d = m.d | 0, k = String(m.k || ''); if (d < 0 || d > 2 || !/^-?\d+,-?\d+,-?\d+$/.test(k)) return;
        if (m.v == null) r.meta[d].delete(k); else { if (JSON.stringify(m.v).length > 20000) return; r.meta[d].set(k, m.v); }
        if (r.public) r.metaDirty = true;
        broadcast(r, { t: 'meta', d, k, v: m.v == null ? null : m.v }, p);
        return;
      }
      case 'chat': { const t = clean(m.m, 160); if (t) broadcast(r, { t: 'chat', from: p.name, m: t }); return; }
      case 'mobs': broadcast(r, { t: 'mobs', from: p.id, d: p.dim, l: Array.isArray(m.l) ? m.l.slice(0, 80) : [] }, p, p.dim); return;
      case 'hitMob': case 'hurt': case 'gift': case 'hitWyrm': { const to = r.players.get(m.to | 0); if (to) { m.from = p.id; m.fromName = p.name; send(to, m); } return; }
      case 'fx': m.from = p.id; broadcast(r, m, p, p.dim); return;
      case 'wyrm': broadcast(r, { t: 'wyrm', w: m.w }, p, 2); return;
      case 'world': {   // time, weather and world flags from the world authority
        if (r.authWorld !== p.id && !m.flags) return;
        if (m.flags && typeof m.flags === 'object') { r.flags = Object.assign(r.flags, m.flags); r.metaDirty = true; }
        broadcast(r, { t: 'world', time: m.time, rain: m.rain, storm: m.storm, flags: m.flags || null }, p);
        return;
      }
      case 'drop': {   // items on the ground are shared, so only one person can pick each one up
        if (r.items.size > 600) { const first = r.items.keys().next().value; r.items.delete(first); broadcast(r, { t: 'itemGone', iid: first }); }
        const it = { iid: r.nextItem++, d: p.dim, id: num(m.id) | 0, n: Math.max(1, Math.min(64, num(m.n) | 0)), data: m.data && typeof m.data === 'object' ? m.data : null, x: num(m.x), y: num(m.y), z: num(m.z), vx: num(m.vx), vy: num(m.vy), vz: num(m.vz), pick: num(m.pick) || 0.5 };
        r.items.set(it.iid, it); broadcast(r, { t: 'item', it });
        setTimeout(() => { if (r.items.delete(it.iid)) broadcast(r, { t: 'itemGone', iid: it.iid }); }, 300000);
        return;
      }
      case 'pick': { const it = r.items.get(m.iid | 0); if (!it) return; r.items.delete(it.iid); broadcast(r, { t: 'itemGone', iid: it.iid, by: p.id, it }); return; }
      case 'itemPos': { const it = r.items.get(m.iid | 0); if (it) { it.x = num(m.x); it.y = num(m.y); it.z = num(m.z); it.vx = it.vy = it.vz = 0; } return; }
      case 'pdata': savePdata(r, p, m.pdata); return;
      case 'pvp': if (p === r.host) { r.pvp = !!m.on; broadcast(r, { t: 'room', room: roomInfo(r) }); } return;
      case 'kick': if (p === r.host) { const o = r.players.get(m.id | 0); if (o && o !== p) { send(o, { t: 'closed', m: 'The host removed you from the world.' }); leave(o); } } return;
      case 'snap': if (p === r.host && m.snap && JSON.stringify(m.snap).length < 3500000) { r.snap = m.snap; r.edits = [new Map(), new Map(), new Map()]; } return;
    }
  }
  // remember each player's inventory and position in that world (the host also gets a copy to save)
  function savePdata(r, p, pd) {
    if (!pd || typeof pd !== 'object' || JSON.stringify(pd).length > 60000) return;
    r.pdata[p.name] = pd; if (r.public) r.metaDirty = true;
    if (r.host && r.host !== p) send(r.host, { t: 'pdata', name: p.name, pdata: pd });
  }
  // positions of everyone, 10 times a second
  setInterval(() => {
    for (const r of rooms.values()) {
      if (r.players.size < 2) continue;
      const list = [...r.players.values()].filter(p => p.s).map(p => [p.id, p.dim, ...p.s]);
      const msg = JSON.stringify({ t: 'ps', l: list });
      for (const p of r.players.values()) send(p, msg);
    }
  }, 100);

  /* ---------- web API: player count and stats ---------- */
  const active = new Map();
  const n0 = (v) => { v = +v; return Number.isFinite(v) ? Math.max(0, Math.min(1e9, Math.floor(v))) : 0; };
  async function api(route, body, ip) {
    if (route === 'ping') { active.set(ip + ':' + String(body.s || '').slice(0, 12), Date.now()); return { ok: true }; }
    if (route === 'stats') {
      const A = bluu.accounts; if (!A || !A.col || !body.token) return { ok: false, error: 'Log in on Bluu first.' };
      const a = await A.col.findOne({ tokens: A.hashTok(String(body.token).slice(0, 100)) }); if (!a) return { ok: false, error: 'Log in on Bluu first.' };
      const s = body.stats || {}, old = a.craft || {};
      const out = { mined: Math.max(n0(s.mined), old.mined || 0), placed: Math.max(n0(s.placed), old.placed || 0), mobs: Math.max(n0(s.mobs), old.mobs || 0), deaths: Math.max(n0(s.deaths), old.deaths || 0), boss: Math.max(n0(s.boss) ? 1 : 0, old.boss || 0), worlds: Math.max(n0(s.worlds), old.worlds || 0) };
      await A.col.updateOne({ _id: a._id }, { $set: { craft: out } });
      return { ok: true };
    }
    return null;
  }
  const online = () => { const now = Date.now(); let n = 0; for (const [k, t] of active) { if (now - t > 70000) active.delete(k); else n++; } let mp = 0; for (const r of rooms.values()) mp += r.players.size; return Math.max(n, mp); };
  bluu.craft = { api, online };
};
