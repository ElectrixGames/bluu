// Pulse Dash server: online levels (upload, browse, like), progress saved to Bluu accounts, and a stars leaderboard.
// Pulse Dash runs in the browser, so this is plain web API (no socket). Routes come in through index.js as /api/dash/<route>.
module.exports = function (bluu) {
  let levelsDB = null;
  const mem = [];   // used when there is no database (levels vanish when the server restarts)
  if (process.env.MONGODB_URI) {
    (async () => {
      try {
        const { MongoClient } = require('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
        levelsDB = c.db('pulsedash').collection('levels');
        await levelsDB.createIndex({ id: 1 }, { unique: true }); await levelsDB.createIndex({ created: -1 }); await levelsDB.createIndex({ likes: -1 }); await levelsDB.createIndex({ plays: -1 }); await levelsDB.createIndex({ owner: 1, cid: 1 });
        console.log('Pulse Dash levels database ready');
      } catch (e) { console.log('Pulse Dash: no levels database (' + e.message + ')'); }
    })();
  }
  const DIFFS = ['auto', 'easy', 'normal', 'hard', 'harder', 'insane', 'demon', 'extreme'];
  const TYPES = new Set('b s p g d dl k h w W py pp pr pb oy op or ob og ok dg dp mc ms mb mu mw mr mi mg gd gu zm zn du dn xm xn te tx v0 v1 v2 v3 v4 c sp tc tz tp ts tm tb'.split(' '));
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
  const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
  // check a level code and rebuild it from known parts only
  function checkCode(code) {
    code = String(code || '');
    if (code.length > 600000 || !code.startsWith('PD1')) return null;
    let L; try { L = JSON.parse(Buffer.from(code.slice(3), 'base64').toString('utf8')); } catch (e) { return null; }
    if (!L || !Array.isArray(L.objs) || L.objs.length > 20000) return null;
    const objs = [];
    let coins = 0;
    for (const o of L.objs) {
      if (!Array.isArray(o) || !TYPES.has(o[0])) continue;
      if (o[0] === 'c' && ++coins > 3) continue;
      const out = [o[0], Math.round(num(o[1], -50, 30000)), Math.round(num(o[2], -20, 200)), num(o[3], 0, 3) | 0];
      if (o[4] && typeof o[4] === 'object') {
        const p = {};
        for (const k of Object.keys(o[4]).slice(0, 16)) { const v = o[4][k]; if (typeof v === 'number' && Number.isFinite(v)) p[clean(k, 4)] = Math.max(-9999, Math.min(9999, v)); else if (typeof v === 'string') p[clean(k, 4)] = clean(v, 12); else if (typeof v === 'boolean') p[clean(k, 4)] = v; }
        if (Object.keys(p).length) out.push(p);
      }
      objs.push(out);
    }
    if (!objs.length) return null;
    const col = (c, d) => /^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : d;
    const C = L.colors || {};
    const lv = { v: 1, name: clean(L.name, 28), speed: num(L.speed, 0, 4) | 0, mode: ['cube', 'ship', 'ball', 'ufo', 'wave', 'robot', 'spider', 'swing'].includes(L.mode) ? L.mode : 'cube', song: { style: num(L.song && L.song.style, 0, 5) | 0 }, colors: { bg: col(C.bg, '#1d3fb8'), g: col(C.g, '#1a2f88'), line: col(C.line, '#ffffff'), obj: col(C.obj, '#ffffff') }, objs };
    return { lv, code: 'PD1' + Buffer.from(JSON.stringify(lv), 'utf8').toString('base64'), count: objs.length };
  }
  async function account(token) {
    const A = bluu.accounts; if (!A || !A.col || !token) return null;
    return await A.col.findOne({ tokens: A.hashTok(String(token).slice(0, 100)) });
  }
  const uploads = new Map(), plays = new Map(), active = new Map();   // active: who has the game open (for the Bluu player count)
  setInterval(() => { uploads.clear(); plays.clear(); }, 3600000);
  const pub = (l) => ({ id: l.id, name: l.name, author: l.author, diff: l.diff, likes: l.likes || 0, plays: l.plays || 0, beats: l.beats || 0, objs: l.objs || 0, created: l.created });
  async function find(q, sort, limit) {
    const S = sort === 'top' ? { likes: -1, created: -1 } : sort === 'plays' ? { plays: -1, created: -1 } : { created: -1 };
    if (levelsDB) return await levelsDB.find(q, { projection: { code: 0, likedBy: 0 } }).sort(S).limit(limit).toArray();
    let a = mem.filter(l => !q.$or || q.$or.some(c => Object.entries(c).every(([k, v]) => v.test(l[k]))));
    const key = Object.keys(S)[0]; a.sort((x, y) => (y[key] || 0) - (x[key] || 0)); return a.slice(0, limit);
  }
  const getOne = async (id) => levelsDB ? await levelsDB.findOne({ id }) : mem.find(l => l.id === id);
  const update = async (id, upd) => { if (levelsDB) return levelsDB.updateOne({ id }, upd); const l = mem.find(x => x.id === id); if (!l) return; if (upd.$inc) for (const k in upd.$inc) l[k] = (l[k] || 0) + upd.$inc[k]; if (upd.$set) Object.assign(l, upd.$set); if (upd.$addToSet) for (const k in upd.$addToSet) { l[k] = l[k] || []; if (!l[k].includes(upd.$addToSet[k])) l[k].push(upd.$addToSet[k]); } if (upd.$pull) for (const k in upd.$pull) l[k] = (l[k] || []).filter(v => v !== upd.$pull[k]); };

  async function api(route, body, ip) {
    if (route === 'ping') { active.set(ip + ':' + String(body.s || '').slice(0, 12), Date.now()); return { ok: true }; }
    if (route === 'levels') {
      const q = clean(body.q, 40), query = {};
      if (q) { const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); query.$or = [{ name: re }, { author: re }]; }
      return { ok: true, levels: (await find(query, String(body.sort || 'new'), 40)).map(pub) };
    }
    if (route === 'get') {
      const l = await getOne(clean(body.id, 12)); if (!l) return { ok: false, error: 'That level was not found.' };
      const k = ip + ':' + l.id; if (!plays.has(k)) { plays.set(k, 1); await update(l.id, { $inc: { plays: 1 } }); }
      return { ok: true, level: Object.assign(pub(l), { code: l.code }) };
    }
    if (route === 'top') {
      const A = bluu.accounts; if (!A || !A.col) return { ok: true, top: [] };
      const rows = await A.col.find({ 'dash.stars': { $gt: 0 } }, { projection: { username: 1, dash: 1 } }).sort({ 'dash.stars': -1, 'dash.coins': -1 }).limit(10).toArray();
      return { ok: true, top: rows.map(a => ({ name: a.username, stars: a.dash.stars | 0, coins: a.dash.coins | 0 })) };
    }
    // everything below needs a Bluu account
    const a = await account(body.token);
    if (route === 'beat') { const l = await getOne(clean(body.id, 12)); if (l) await update(l.id, { $inc: { beats: 1 } }); return { ok: true }; }
    if (!a) return { ok: false, error: bluu.accounts && bluu.accounts.col ? 'Log in on Bluu first.' : 'Accounts are offline right now.' };
    if (route === 'load') return { ok: true, data: a.dash || null };
    if (route === 'save') {
      const d = body.data || {}, out = { lv: {}, stats: {}, ach: {}, look: {} };
      const known = ['m0', 'm1', 'm2', 'm3', 'm4'];
      for (const id of Object.keys(d.lv || {}).slice(0, 400)) { if (!/^[mco][a-z0-9]{1,14}$/i.test(id)) continue; const r = d.lv[id] || {}; out.lv[id] = { best: num(r.best, 0, 100) | 0, prac: num(r.prac, 0, 100) | 0, coins: num(r.coins, 0, 7) | 0, done: !!r.done, att: num(r.att, 0, 1e7) | 0 }; }
      for (const k of ['jumps', 'attempts', 'deaths', 'orbs', 'completions', 'onlineBeat', 'created', 'uploaded', 'playTime']) out.stats[k] = num(d.stats && d.stats[k], 0, 1e9);
      for (const k of Object.keys(d.ach || {}).slice(0, 40)) out.ach[clean(k, 12)] = num(d.ach[k], 0, 1e13);
      const L = d.look || {}; out.look = { skin: num(L.skin, 0, 7) | 0, c1: /^#[0-9a-f]{6}$/i.test(L.c1) ? L.c1 : '#3df0ff', c2: /^#[0-9a-f]{6}$/i.test(L.c2) ? L.c2 : '#ff3dc8', glow: !!L.glow, trail: ['standard', 'rainbow', 'fire', 'ghost'].includes(L.trail) ? L.trail : 'standard' };
      // stars and coins are worked out here from the main levels, so nobody can just send a big number
      const STARS = [2, 5, 8, 10, 10]; let stars = 0, coins = 0;
      known.forEach((id, i) => { const r = out.lv[id]; if (!r) return; if (r.done) stars += STARS[i]; for (let b = 0; b < 3; b++) if (r.coins & (1 << b)) coins++; });
      out.stars = stars; out.coins = coins;
      await bluu.accounts.col.updateOne({ _id: a._id }, { $set: { dash: out } });
      return { ok: true };
    }
    if (route === 'upload') {
      const n = uploads.get(a.uid) || 0; if (n >= 10) return { ok: false, error: 'You uploaded a lot this hour. Try again later.' };
      const chk = checkCode(body.code); if (!chk) return { ok: false, error: 'That level could not be uploaded (empty or broken).' };
      const name = clean(body.name, 28) || 'Untitled', diff = DIFFS.includes(body.diff) ? body.diff : 'normal', cid = clean(body.cid, 20);
      uploads.set(a.uid, n + 1);
      // the same editor level uploaded again replaces the old copy
      const prev = levelsDB ? await levelsDB.findOne({ owner: a.uid, cid }) : mem.find(l => l.owner === a.uid && l.cid === cid);
      if (prev) { await update(prev.id, { $set: { name, diff, code: chk.code, objs: chk.count, updated: Date.now() } }); return { ok: true, id: prev.id, updated: true }; }
      let id; do id = Math.random().toString(36).slice(2, 9); while (await getOne(id));
      const doc = { id, name, diff, author: a.username, owner: a.uid, cid, code: chk.code, objs: chk.count, likes: 0, likedBy: [], plays: 0, beats: 0, created: Date.now() };
      if (levelsDB) await levelsDB.insertOne(doc); else { mem.unshift(doc); if (mem.length > 500) mem.pop(); }
      return { ok: true, id };
    }
    if (route === 'like') {
      const l = await getOne(clean(body.id, 12)); if (!l) return { ok: false, error: 'Level not found.' };
      const full = levelsDB ? await levelsDB.findOne({ id: l.id }, { projection: { likedBy: 1 } }) : l;
      const liked = (full.likedBy || []).includes(a.uid);
      if (liked) await update(l.id, { $pull: { likedBy: a.uid }, $inc: { likes: -1 } }); else await update(l.id, { $addToSet: { likedBy: a.uid }, $inc: { likes: 1 } });
      return { ok: true, liked: !liked };
    }
    return null;
  }
  const online = () => { const now = Date.now(); let n = 0; for (const [k, t] of active) { if (now - t > 70000) active.delete(k); else n++; } return n; };
  bluu.dash = { api, checkCode, online };
};
