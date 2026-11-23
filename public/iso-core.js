/* Iso 3D: the basketball engine shared by the Bluu server and the game page.
   Court, players, moves, shooting, the ball, the rules and the CPU players all live here. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.IsoCore = factory(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ================= the court (meters). The rim is at x=0, z=0; the court runs toward +z ================= */
const K = {
  RIM: { x: 0, y: 3.05, z: 0 }, RIM_R: 0.23, BALL_R: 0.12, BOARD_Z: -0.38, BASE_Z: -1.6, HALF_Z: 12.4, SIDE_X: 7.5,
  ARC: 6.75, CORNER_X: 6.6, CORNER_Z: 1.41, KEY_W: 2.45, FT_Z: 4.2, CHECK: { x: 0, z: 7.6 },
  G: 18, R: 0.42, H: 2.0, GATHER: 0.15, CLEAR_ARC: 6.75, SHOT_CLOCK: 14, COMBO: 0.45, PIPS: 3,
};
const rimDist = (x, z) => Math.hypot(x - K.RIM.x, z - K.RIM.z);
const is3 = (x, z) => (Math.abs(x) >= K.CORNER_X && z <= K.CORNER_Z) || (z > K.CORNER_Z && rimDist(x, z) > K.ARC);
const inBounds = (x, z, pad) => Math.abs(x) <= K.SIDE_X + (pad || 0) && z >= K.BASE_Z - (pad || 0) && z <= K.HALF_Z + (pad || 0);
const SPOTS = [[0, 7.6], [-5.2, 5.3], [5.2, 5.3], [-6.9, 0.6], [6.9, 0.6], [-3, 8], [3, 8]];   // top, wings, corners, slots

/* ================= players: ratings, archetypes and badges ================= */
const ATTRS = [
  { id: 'sht', name: '3PT & Midrange', short: 'SHOOT' }, { id: 'fin', name: 'Driving Dunk & Post', short: 'FINISH' }, { id: 'hnd', name: 'Ball Handle', short: 'HANDLE' },
  { id: 'spd', name: 'Speed & Burst', short: 'SPEED' }, { id: 'per', name: 'Perimeter D & Steal', short: 'PERIM D' }, { id: 'int', name: 'Block & Rebound', short: 'INT D' },
];
const BUDGET = 504;
const ARCHETYPES = [
  { id: 'shot', name: 'Playmaking Shot Creator', attrs: { sht: 94, fin: 72, hnd: 95, spd: 92, per: 83, int: 68 }, badges: ['ankle', 'greenMachine', 'quickStep', 'limitless', 'deadeye', 'clutch'] },
  { id: 'lock', name: '2-Way Slashing Lockdown', attrs: { sht: 76, fin: 96, hnd: 78, spd: 84, per: 95, int: 75 }, badges: ['posterizer', 'clamps', 'glove', 'chaseDown', 'quickStep', 'lobCity'] },
  { id: 'big', name: 'Stretch Iso Big', attrs: { sht: 93, fin: 90, hnd: 70, spd: 74, per: 85, int: 92 }, badges: ['limitless', 'posterizer', 'chaseDown', 'deadeye', 'lobCity', 'clutch'] },
  { id: 'all', name: 'All-Around Threat', attrs: { sht: 84, fin: 84, hnd: 84, spd: 84, per: 84, int: 84 }, badges: ['greenMachine', 'ankle', 'clamps', 'dimer', 'clutch', 'glove'] },
];
const BADGES = [
  { id: 'greenMachine', name: 'Green Machine', icon: '🟢', desc: 'Bigger green window after back-to-back green releases.' },
  { id: 'limitless', name: 'Limitless Range', icon: '🎯', desc: 'Deep threes stay green all the way out to 32 feet.' },
  { id: 'ankle', name: 'Ankle Assassin', icon: '🦵', desc: 'Your crossovers break ankles more often, from farther away.' },
  { id: 'posterizer', name: 'Posterizer', icon: '💥', desc: 'Dunk on people. Contact dunks go in and knock defenders down.' },
  { id: 'quickStep', name: 'Quick First Step', icon: '⚡', desc: 'Faster burst out of crossovers, step-backs and drives.' },
  { id: 'deadeye', name: 'Deadeye', icon: '👁️', desc: 'Late contests hurt your shot up to 40% less.' },
  { id: 'clamps', name: 'Clamps', icon: '🔒', desc: 'Faster defensive slides. Bump drivers into picking up the ball.' },
  { id: 'glove', name: 'Glove', icon: '🧤', desc: 'More clean steals on exposed dribbles, quicker recovery when you miss.' },
  { id: 'chaseDown', name: 'Chase Down Artist', icon: '🏃', desc: 'Higher jump and bigger block window when chasing a driver.' },
  { id: 'dimer', name: 'Dimer', icon: '🎁', desc: 'Teammates get a 12% bigger green window off your passes.' },
  { id: 'lobCity', name: 'Lob City Finisher', icon: '🛫', desc: 'Catch alley-oops from farther away and finish them more often.' },
  { id: 'clutch', name: 'Clutch Shooter', icon: '🧊', desc: '20% bigger green window when either team is close to game point.' },
];
const BADGE_LV = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
const BOSSES = [
  { id: 'rookie', name: 'Rookie', rating: 70, skill: 0.42, badges: 0, lv: 0 },
  { id: 'starter', name: 'Starter', rating: 78, skill: 0.58, badges: 2, lv: 1 },
  { id: 'allstar', name: 'All-Star', rating: 85, skill: 0.72, badges: 3, lv: 2 },
  { id: 'mvp', name: 'MVP', rating: 91, skill: 0.84, badges: 4, lv: 3 },
  { id: 'legend', name: 'Iso Legend', rating: 97, skill: 0.95, badges: 6, lv: 4 },
];
const rf = (v) => Math.max(0, Math.min(1, ((v || 75) - 60) / 39));   // 60..99 -> 0..1
const bk = (p, id) => (p.badges && p.badges[id] ? p.badges[id] : 0) / 4;   // badge strength 0..1
const jumpV = (p) => 5.6 + rf(Math.max(p.attrs.int, p.attrs.fin)) * 1.0 + (p.chaseBoost ? 0.6 * bk(p, 'chaseDown') : 0);
const runSpeed = (p) => 4.3 + rf(p.attrs.spd) * 1.7;
const shotT = (p) => K.GATHER + jumpV(p) / K.G;   // when the meter hits the top

/* ================= contests: how covered a shooter is (0 = open, 1 = smothered) ================= */
function contestOf(sh, defenders, mut) {
  let c = 0;
  const fx = K.RIM.x - sh.x, fz = K.RIM.z - sh.z, fl = Math.hypot(fx, fz) || 1;
  for (const d of defenders) {
    const dx = d.x - sh.x, dz = d.z - sh.z, dist = Math.hypot(dx, dz);
    if (dist > 3) continue;
    const front = (dx * fx + dz * fz) / (dist * fl || 1);   // 1 = right between the shooter and the rim
    let ci = Math.max(0, Math.min(1, (2.7 - dist) / 2.1)) * (0.55 + 0.45 * Math.max(0, front));
    if (d.y > 0.25) ci *= 1.25;   // a hand up in the air
    if (d.mode === 'fall' || d.mode === 'stumble') ci *= 0.1;
    c = Math.max(c, ci);
  }
  c = Math.min(1, c);
  return c * (1 - 0.4 * bk(sh, 'deadeye'));
}
const contestLabel = (c) => c < 0.06 ? 'OPEN' : c > 0.8 ? Math.round(c * 100) + '% SMOTHERED' : Math.round(c * 100) + '% CONTESTED';
function greenWindow(p, ctx) {   // how wide the green part of the meter is (in meter units around the top)
  const d = rimDist(p.x, p.z);
  let w = 0.05 + rf(p.attrs.sht) * 0.065;
  if (p.greenStreak >= 2) w *= 1 + 0.15 * bk(p, 'greenMachine');
  if (ctx && ctx.clutch) w *= 1 + 0.2 * bk(p, 'clutch');
  if (ctx && ctx.dimer) w *= 1 + 0.12 * ctx.dimer;
  const limit = 7.6 + 2.15 * bk(p, 'limitless');
  if (d > limit) w *= Math.max(0.2, 1 - (d - limit) * 0.45);
  if (ctx && ctx.sb) w *= 0.88;
  if (d < K.ARC) w *= 1.08;
  return w;
}

/* ================= movement and moves (the page runs this for you, the server runs it for CPU players) ================= */
const MODES = ['idle', 'gather', 'air', 'fake', 'cross', 'step', 'step2', 'drive', 'jab', 'spin', 'euro', 'hesi', 'reach', 'block', 'slide', 'dunk', 'fall', 'stumble', 'pickup', 'bite', 'cele'];
const MODE_ID = {}; MODES.forEach((m, i) => { MODE_ID[m] = i; });
const BURST = { cross: [0.22, 7.4], step: [0.28, 6.4], step2: [0.3, 6.8], spin: [0.45, 5.8], euro: [0.5, 6.2], hesi: [0.5, 6.6], jab: [0.35, 8.6], fake: [0.28, 0] };
const LOCKED = { fall: 1, stumble: 1, pickup: 1, bite: 1, dunk: 1, cele: 1 };
function newPlayer(o) {
  return Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: Math.PI, ground: true, mode: 'idle', mt: 0, md: null, gT: 0, jumped: false, sb: false, pips: K.PIPS,
    last: { m: '', t: -9 }, clock: 0, lock: 0, quickT: 0, hand: 1, greenStreak: 0, attrs: { sht: 80, fin: 80, hnd: 80, spd: 80, per: 80, int: 80 }, badges: {} }, o || {});
}
function startMode(p, m, out) {
  const b = BURST[m];
  p.mode = m; p.mt = b ? b[0] : 0.3;
  const weak = p.pips <= 0 && m !== 'fake' ? 0.6 : 1;
  if (m !== 'fake' && m !== 'drive' && m !== 'reach') { if (p.pips > 0) p.pips--; }
  if (m === 'drive') { if (p.pips > 0) p.pips--; p.mt = 1.2; }
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let dx = fx, dz = fz, sp = b ? b[1] * weak : 0;
  if (m === 'cross' || m === 'hesi') { p.hand = -p.hand; dx = fz * p.hand; dz = -fx * p.hand; }
  if (m === 'step' || m === 'step2') { dx = -fx; dz = -fz; p.vy = 2.6; p.ground = false; if (m === 'step2') sp *= 1.1; }
  if (m === 'euro') { p.md = { fx, fz, side: p.hand }; }
  p.md = Object.assign(p.md || {}, { dx, dz, sp, spin: m === 'spin' ? 1 : 0, y0: p.yaw });
  p.quickT = 0.35;
  p.last = { m: m === 'jab' ? 'drive' : m, t: p.clock };
  if (out) out.move = m;
}
function stepPlayer(p, inp, ctx, dt) {   // ctx: { hasBall, live, needClear, others[], frozen }
  const out = {};
  p.clock += dt;
  p.quickT = Math.max(0, p.quickT - dt);
  const hasBall = !!ctx.hasBall, live = !!ctx.live && !ctx.frozen, rd = rimDist(p.x, p.z);
  if (p.mode === 'dunk') return stepDunk(p, dt, out);
  if (p.mt > 0 && p.mode !== 'gather') { p.mt -= dt; if (p.mt <= 0 && p.mode !== 'block' && p.mode !== 'air') { if (p.mode === 'drive' && inp.turbo && hasBall) p.mt = 0.05; else p.mode = 'idle'; } }
  if (p.lock > 0 && p.ground) { p.lock -= dt; if (p.mode === 'idle' && p.lock > 0) p.mode = 'bite'; if (p.lock <= 0 && p.mode === 'bite') p.mode = 'idle'; }
  const locked = LOCKED[p.mode] || ctx.frozen;
  const recent = (m) => p.last.m === m && p.clock - p.last.t < K.COMBO;
  /* ---- with the ball ---- */
  if (hasBall && live && !locked) {
    if (inp.sP && p.ground && p.mode !== 'gather' && p.mode !== 'air') {
      if (rd < 2.8 && (inp.turbo || ['drive', 'jab', 'spin', 'euro'].includes(p.mode))) out.dunk = true;
      else if (ctx.needClear) out.clear = true;
      else { p.sb = p.mode === 'step' || p.mode === 'step2' || (recent('step') || recent('step2')); p.mode = 'gather'; p.gT = 0; p.jumped = false; p.mt = 9; }
    }
    if (p.mode === 'gather') {
      p.gT += dt;
      if (!p.jumped && (inp.sR || !inp.sD) && p.gT < K.GATHER) { p.mode = 'idle'; startMode(p, 'fake', out); out.fake = true; p.last = { m: 'fake', t: p.clock }; }
      else if (!p.jumped && p.gT >= K.GATHER) { p.jumped = true; p.vy = jumpV(p); p.ground = false; out.shotStart = true; }
      if (p.jumped && (inp.sR || !inp.sD || p.gT > shotT(p) * 1.65)) { out.release = { q: p.gT / shotT(p), sb: p.sb }; p.mode = 'air'; p.mt = 0.3; }
    } else if (p.mode === 'idle' || p.mode === 'drive' || p.mode === 'jab') {
      if (inp.jP) startMode(p, recent('drive') ? (rd < 4.6 ? 'euro' : 'spin') : (recent('step') || recent('step2')) ? 'hesi' : 'cross', out);
      else if (inp.kP) startMode(p, recent('step') ? 'step2' : 'step', out);
      else if (inp.lP && p.mode !== 'drive') startMode(p, recent('fake') ? 'jab' : 'drive', out);
    } else if ((p.mode === 'step' || p.mode === 'step2') && inp.sP) { p.sb = true; p.mode = 'gather'; p.gT = K.GATHER; p.jumped = true; p.vy = jumpV(p) * 0.9; p.ground = false; out.shotStart = true; }
    else if ((p.mode === 'step' || p.mode === 'step2') && inp.jP && p.mt < 0.15) startMode(p, 'hesi', out);
  }
  /* ---- without the ball: defense ---- */
  if (!hasBall && live && !locked) {
    if (inp.jP && p.mode !== 'reach' && p.ground) { p.mode = 'reach'; p.mt = 0.32; out.steal = true; }
    if ((inp.lP || inp.sP) && p.ground && p.mode !== 'block') { p.vy = jumpV(p) * 0.96; p.ground = false; p.mode = 'block'; p.mt = 0.3; out.jump = true; }
    if (inp.kH && p.ground && (p.mode === 'idle' || p.mode === 'slide')) p.mode = 'slide'; else if (p.mode === 'slide' && !inp.kH) p.mode = 'idle';
    if (inp.sP && ctx.oop) out.oop = true;
  }
  /* ---- moving ---- */
  const burst = BURST[p.mode];
  let sp = runSpeed(p) * (hasBall ? 0.94 : 1);
  if (p.mode === 'drive') sp *= 1.35; if (p.mode === 'slide') sp *= 0.95 + 0.25 * bk(p, 'clamps');
  if (p.quickT > 0) sp *= 1 + 0.25 * bk(p, 'quickStep');
  if (p.ground && !locked && p.mode !== 'gather') {
    if (burst && p.md && p.mode !== 'fake') {
      let dx = p.md.dx, dz = p.md.dz;
      if (p.mode === 'euro') { const ph = p.mt > 0.25 ? 1 : -1; dx = p.md.fx * 0.7 + p.md.fz * ph * 0.7 * p.md.side; dz = p.md.fz * 0.7 - p.md.fx * ph * 0.7 * p.md.side; }
      if (p.mode === 'hesi' && p.mt > 0.28) { dx = -Math.sin(p.yaw) * 0.6; dz = -Math.cos(p.yaw) * 0.6; }
      const k = Math.min(1, 30 * dt) * (1 + 0.5 * bk(p, 'quickStep'));
      p.vx += (dx * p.md.sp - p.vx) * Math.min(1, k); p.vz += (dz * p.md.sp - p.vz) * Math.min(1, k);
      if (p.mode === 'spin') p.yaw = p.md.y0 + (1 - p.mt / BURST.spin[0]) * Math.PI * 2;
    } else {
      const acc = (p.quickT > 0 ? 34 : 24) * dt;
      p.vx += ((inp.mx || 0) * sp - p.vx) * Math.min(1, acc); p.vz += ((inp.mz || 0) * sp - p.vz) * Math.min(1, acc);
      if (p.mode === 'slide' && inp.faceT != null) p.yaw = inp.faceT;
      else if (inp.face != null) p.yaw = inp.face;
      else if (Math.hypot(p.vx, p.vz) > 0.6) p.yaw = turnTo(p.yaw, Math.atan2(p.vx, p.vz), dt * 14);
    }
  } else if (p.ground) { const f = Math.min(1, 14 * dt); p.vx -= p.vx * f; p.vz -= p.vz * f; }
  else if (!locked && p.mode !== 'gather' && p.mode !== 'air') { p.vx += ((inp.mx || 0) * sp * 0.6 - p.vx) * Math.min(1, 2 * dt); p.vz += ((inp.mz || 0) * sp * 0.6 - p.vz) * Math.min(1, 2 * dt); }
  if (p.mode === 'gather' || p.mode === 'air') { const f = Math.min(1, (p.ground ? 12 : 3) * dt); p.vx -= p.vx * f; p.vz -= p.vz * f; if (hasBall) p.yaw = turnTo(p.yaw, Math.atan2(K.RIM.x - p.x, K.RIM.z - p.z), dt * 10); }
  if (!p.ground) { p.vy -= K.G * dt; }
  p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
  if (p.y <= 0) { if (!p.ground) out.land = 1; p.y = 0; p.vy = 0; p.ground = true; if (p.mode === 'block' || p.mode === 'air') p.mode = 'idle'; }
  p.x = Math.max(-K.SIDE_X - 0.6, Math.min(K.SIDE_X + 0.6, p.x)); p.z = Math.max(K.BASE_Z - 0.6, Math.min(K.HALF_Z + 1, p.z));
  if (rimDist(p.x, p.z) < 0.5 && p.y < 1) { const d = rimDist(p.x, p.z) || 1; p.x = K.RIM.x + (p.x - K.RIM.x) / d * 0.5; p.z = K.RIM.z + (p.z - K.RIM.z) / d * 0.5; }   // the stanchion
  if (p.z < K.BOARD_Z - 0.2) p.z = K.BOARD_Z - 0.2 + (p.x === 0 ? 0 : 0);
  for (const o of ctx.others || []) {   // bodies bump each other (screens!)
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = K.R * 2;
    if (d < min && d > 1e-4 && Math.abs(p.y - (o.y || 0)) < 1.6) { const push = (min - d) * (o.screen ? 1 : 0.6); p.x += dx / d * push; p.z += dz / d * push; out.bump = o.id; }
  }
  return out;
}
function turnTo(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * Math.min(1, k); }
function startDunk(p, kind, ok) {   // fly to the rim (same path on every screen)
  const d = rimDist(p.x, p.z) || 1, ux = (p.x - K.RIM.x) / d, uz = (p.z - K.RIM.z) / d;
  const front = Math.max(0.42, Math.min(0.6, d));
  p.mode = 'dunk'; p.md = { sx: p.x, sz: p.z, tx: K.RIM.x + ux * front, tz: Math.max(0.15, K.RIM.z + uz * front), t: 0, dur: kind === 'layup' || kind === 'floater' ? 0.5 : 0.6, hang: kind === 'layup' || kind === 'floater' ? 0 : ok ? 0.35 : 0, kind, top: kind === 'floater' ? 0.7 : kind === 'layup' ? 0.85 : 1.25 };
  p.yaw = Math.atan2(K.RIM.x - p.x, K.RIM.z - p.z); p.ground = false; p.vx = p.vz = 0;
}
function stepDunk(p, dt, out) {
  const m = p.md; m.t += dt;
  if (m.t < m.dur) { const s = m.t / m.dur; p.x = m.sx + (m.tx - m.sx) * s; p.z = m.sz + (m.tz - m.sz) * s; p.y = Math.sin(s * Math.PI / 2) * m.top; if (m.kind === 'windmill' || m.kind === 'btl') p.yaw += dt * (m.kind === 'btl' ? 4 : 12); }
  else if (m.t < m.dur + m.hang) { p.y = m.top - 0.1; }
  else { p.mode = 'idle'; p.vy = -1; p.ground = false; p.vx = (m.sx - m.tx) * 0.5; p.vz = (m.sz - m.tz) * 0.5; out.dunkDone = 1; }
  return out;
}

/* ================= a game: the ball, the rules, and everything that happens ================= */
const r2 = (v) => Math.round(v * 100) / 100;
const DUNKS = ['tomahawk', 'windmill', 'btl'];
class Game {
  constructor(cfg) {
    this.cfg = Object.assign({ mode: 'game', size: 1, shotClock: K.SHOT_CLOCK, redemption: true }, cfg || {});
    const s = this.cfg.size; this.toWin = this.cfg.toWin || (s === 1 ? 11 : s === 2 ? 16 : 21);
    this.bodies = new Map(); this.ev = []; this.t = 0; this.phase = 'check'; this.timer = 2; this.score = [0, 0];
    this.poss = this.cfg.firstPoss != null ? this.cfg.firstPoss : Math.random() < 0.5 ? 0 : 1; this.possessed = [false, false];
    this.ball = { st: 'dead', holder: null, x: 0, y: 1, z: 7.6, vx: 0, vy: 0, vz: 0, lastTeam: null };
    this.sclock = this.cfg.shotClock || 0; this.needClear = null; this.redemption = null; this.over = false; this.result = null;
    this.lastFake = null; this.lastPass = null; this.pending = []; this.rand = cfg && cfg.rand || Math.random;
  }
  emit(e) { this.ev.push(e); }
  drain() { const e = this.ev; this.ev = []; return e; }
  info(b) { return { id: b.id, name: b.name, team: b.team, bot: b.bot, slot: b.slot, look: b.look, ballSkin: b.ballSkin, attrs: b.attrs, badges: b.badges, elo: b.elo || 1000, boss: b.boss }; }
  addBody(o) {
    const b = newPlayer({ id: o.id, name: o.name || 'Player', team: o.team || 0, bot: !!o.bot, remote: !!o.remote, slot: o.slot || 0, skill: o.skill || 0.75, look: o.look || {}, ballSkin: o.ballSkin || 'classic',
      attrs: Object.assign({ sht: 80, fin: 80, hnd: 80, spd: 80, per: 80, int: 80 }, o.attrs || {}), badges: o.badges || {}, elo: o.elo || 1000, boss: o.boss || null, dummy: !!o.dummy,
      stats: { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, dunks: 0, ankles: 0, greens: 0, shots: [] }, ai: {} });
    this.bodies.set(b.id, b);
    if (this.started) this.emit({ t: 'add', p: this.info(b) });
    return b;
  }
  removeBody(id) { if (this.bodies.delete(id)) { this.emit({ t: 'rem', id }); if (this.ball.holder === id) this.loose(this.ball.x, 1.2, this.ball.z, 0, 0, 0); } }
  team(t) { return [...this.bodies.values()].filter(b => b.team === t).sort((a, b) => a.slot - b.slot); }
  holder() { return this.ball.holder != null ? this.bodies.get(this.ball.holder) : null; }
  start() {
    this.started = true; this.setupCheck(true);
    return { t: 'start', cfg: this.cfg, toWin: this.toWin, sc: this.score, poss: this.poss, ph: this.phase, tl: r2(this.timer), players: [...this.bodies.values()].map(b => Object.assign(this.info(b), { s: [r2(b.x), r2(b.z), r2(b.yaw)] })) };
  }
  snap() {
    const b = [];
    for (const p of this.bodies.values()) b.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), MODE_ID[p.mode] || 0, (p.ground ? 1 : 0) | (p.screen ? 2 : 0), p.pips]);
    const B = this.ball;
    return { t: 'st', tm: r2(this.t), ph: this.phase, tl: r2(Math.max(0, this.timer)), sc: this.score, poss: this.poss, sclk: r2(this.sclock), nc: this.needClear, red: this.redemption, b, ball: [B.st, r2(B.x), r2(B.y), r2(B.z), B.holder] };
  }
  /* ---------- check ball at the top of the key ---------- */
  setupCheck(quiet) {
    const off = this.team(this.poss), def = this.team(1 - this.poss), spots = {};
    const offSpots = this.cfg.mode === 'practice' ? [[0, 7.6]] : [[0, 7.6], [-5.6, 4.6], [5.6, 4.6], [-6.9, 0.6], [6.9, 0.6]];
    off.forEach((p, i) => { const s = offSpots[i % offSpots.length]; this.place(p, s[0], s[1], Math.atan2(K.RIM.x - s[0], K.RIM.z - s[1])); spots[p.id] = [p.x, p.z, r2(p.yaw)]; });
    def.forEach((p, i) => { const m = off[i % Math.max(1, off.length)] || { x: 0, z: 7.6 }, d = rimDist(m.x, m.z) || 1; const x = m.x + (K.RIM.x - m.x) / d * 1.3, z = m.z + (K.RIM.z - m.z) / d * 1.3; this.place(p, r2(x), r2(z), Math.atan2(m.x - x, m.z - z)); spots[p.id] = [p.x, p.z, r2(p.yaw)]; });
    const h = off[0];
    this.phase = 'check'; this.timer = this.cfg.mode === 'practice' ? 0.4 : 1.4; this.needClear = null;
    this.ball.st = 'held'; this.ball.holder = h ? h.id : null; this.possessed[this.poss] = true;
    for (const p of this.bodies.values()) { p.pips = K.PIPS; p.screen = false; }
    this.sclock = this.cfg.shotClock || 0;
    if (!quiet) this.emit({ t: 'check', poss: this.poss, spots, sc: this.score.slice(), holder: this.ball.holder, red: this.redemption });
  }
  place(p, x, z, yaw) { p.x = x; p.z = z; p.y = 0; p.vx = p.vy = p.vz = 0; p.yaw = yaw; p.ground = true; p.mode = 'idle'; p.mt = 0; p.lock = 0; p.md = null; }
  /* ---------- messages from players ---------- */
  report(id, m) {
    const b = this.bodies.get(id); if (!b || !Array.isArray(m.p)) return;
    const n = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
    const wasGround = b.ground;
    b.x = n(m.p[0], -12, 12); b.y = n(m.p[1], 0, 5); b.z = n(m.p[2], -4, 16); b.yaw = n(m.yaw, -20, 20);
    b.mode = MODES[m.mode | 0] || 'idle'; b.ground = !!((m.f | 0) & 1);
    if (Array.isArray(m.v)) { b.vx = n(m.v[0], -20, 20); b.vz = n(m.v[2], -20, 20); }
    if (wasGround && !b.ground && b.mode === 'block') this.jumped(b);
  }
  jumped(b) {   // a defender jumped: did they bite on a pump fake?
    const f = this.lastFake; if (f && f.team !== b.team && this.t - f.t < 0.45 && Math.hypot(b.x - f.x, b.z - f.z) < 3) this.stun(b, 'bite', 0.65);
  }
  stun(b, k, d) { if (b.remote) this.emit({ t: 'stun', id: b.id, k, d }); else { if (k === 'bite') b.lock = d; else { b.mode = k; b.mt = d; b.vx *= 0.2; b.vz *= 0.2; } } }
  fake(id) { const b = this.bodies.get(id); if (!b || this.ball.holder !== id) return; this.lastFake = { team: b.team, t: this.t, x: b.x, z: b.z }; this.emit({ t: 'fake', id }); }
  move(id, m) {
    const b = this.bodies.get(id); if (!b || this.ball.holder !== id || this.phase !== 'live') return;
    if (b.remote && m !== 'drive') b.pips = Math.max(0, b.pips - 1);
    this.emit({ t: 'move', id, m });
    if (b.pips <= 0 && b.remote) return;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    for (const d of this.team(1 - b.team)) {
      const dx = d.x - b.x, dz = d.z - b.z, dist = Math.hypot(dx, dz);
      const reach = 2.3 + 0.8 * bk(b, 'ankle');
      if (dist > reach || (dx * fx + dz * fz) / (dist || 1) < 0.1 || d.mode === 'fall' || !d.ground) continue;
      let p = 0.04 + rf(b.attrs.hnd) * 0.09 + 0.11 * bk(b, 'ankle') + (m === 'hesi' || m === 'spin' ? 0.07 : 0) + (Math.hypot(d.vx, d.vz) > 2.5 ? 0.06 : 0) - rf(d.attrs.per) * 0.06 - 0.06 * bk(d, 'clamps');
      if (m === 'drive' || m === 'jab') p *= 0.4;
      if (this.rand() < p) { this.stun(d, 'fall', 1.4); b.stats.ankles++; this.emit({ t: 'ankles', id: d.id, by: id }); break; }
    }
  }
  steal(id) {
    const d = this.bodies.get(id), h = this.holder(); if (!d || this.phase !== 'live') return;
    this.emit({ t: 'reach', id });
    if (!h || h.team === d.team || this.ball.st !== 'held') return;
    const dx = h.x - d.x, dz = h.z - d.z, dist = Math.hypot(dx, dz);
    if (dist > 1.8 || (dx * Math.sin(d.yaw) + dz * Math.cos(d.yaw)) / (dist || 1) < 0.15) return this.reachMiss(d);
    const exposed = ['cross', 'hesi', 'spin', 'step', 'step2', 'euro'].includes(h.mode);
    const p = 0.1 + rf(d.attrs.per) * 0.14 + 0.1 * bk(d, 'glove') + (exposed ? 0.2 * (1 + 0.5 * bk(d, 'glove')) : 0) - rf(h.attrs.hnd) * 0.1;
    if (this.rand() < p) {
      d.stats.stl++; h.stats.tov++;
      this.emit({ t: 'steal', id: d.id, from: h.id });
      this.loose(h.x, 1, h.z, (d.x - h.x) * 1.5, 1.5, (d.z - h.z) * 1.5); this.ball.lastTeam = h.team; this.ball.poke = d.team;
    } else this.reachMiss(d);
  }
  reachMiss(d) { if (this.rand() < 0.45 * (1 - 0.6 * bk(d, 'glove'))) this.stun(d, 'stumble', 0.45 * (1 - 0.4 * bk(d, 'glove'))); }
  shotStart(id) { const b = this.bodies.get(id); if (b && this.ball.holder === id) { b.shooting = this.t; this.emit({ t: 'rise', id }); } }
  release(id, q, sb) {
    const b = this.bodies.get(id); if (!b || this.ball.holder !== id || this.phase !== 'live' || this.ball.st !== 'held') return;
    if (this.needClear === b.team) { this.emit({ t: 'clear', id, team: b.team }); return; }
    q = Number(q); if (!Number.isFinite(q)) q = 1;
    const d = rimDist(b.x, b.z), three = is3(b.x, b.z), pts = three ? 3 : 2;
    const defs = this.team(1 - b.team);
    const ctx = { sb, clutch: this.score.some(s => s >= this.toWin - 2), dimer: b.dimerUntil > this.t ? b.dimerK : 0 };
    const win = greenWindow(b, ctx), dq = Math.abs(q - 1), c = contestOf(b, defs);
    const green = dq <= win;
    const base = (d < 2.5 ? 0.62 : d < K.ARC ? 0.44 : 0.34) + rf(b.attrs.sht) * 0.22 - (d > 8.5 ? 0.12 : 0);
    let make = green ? 0.96 * (c > 0.8 ? 0.8 : 1) : dq <= win * 2.3 ? base * (1 - c * 0.7) : base * 0.3 * (1 - c * 0.8);
    let blocker = null;
    for (const df of defs) {
      if (df.y < 0.3 && df.mode !== 'block') continue;
      const dist = Math.hypot(df.x - b.x, df.z - b.z); if (dist > 1.45) continue;
      const chase = (df.x - b.x) * (K.RIM.x - b.x) + (df.z - b.z) * (K.RIM.z - b.z) < 0 ? bk(df, 'chaseDown') * 0.2 : 0;
      if (this.rand() < Math.min(0.55, 0.14 + rf(df.attrs.int) * 0.22 + chase) * (green ? 0.5 : 1) * (d > 5 ? 0.6 : 1)) { blocker = df; break; }
    }
    b.stats.fga++; if (three) b.stats.tpa++;
    const made = !blocker && this.rand() < make;
    if (green) { b.greenStreak++; b.stats.greens++; } else b.greenStreak = 0;
    const from = [r2(b.x), r2(b.y + 2.55), r2(b.z)];
    b.stats.shots.push([r2(b.x), r2(b.z), made ? 1 : 0, green ? 1 : 0]);
    if (blocker) {
      blocker.stats.blk++;
      this.emit({ t: 'block', id: blocker.id, by: blocker.id, shooter: id, x: from[0], y: from[1], z: from[2] });
      this.ball.holder = null; this.loose(from[0], from[1], from[2], (b.x - blocker.x) * 4 + (this.rand() - 0.5) * 3, 1, (b.z - blocker.z) * 4 + 2);
      this.ball.lastTeam = blocker.team; this.ball.shotBy = b.team; return;
    }
    const res = made ? (green || this.rand() < 0.55 ? 'swish' : 'rim') : dq > 0.55 && c < 0.5 ? 'airball' : 'rimout';
    const a = this.rand() * Math.PI * 2, to = made ? [0, K.RIM.y, 0] : res === 'airball' ? [r2(Math.cos(a) * 0.7), 2.4, r2(0.4 + Math.abs(Math.sin(a)) * 0.6)] : [r2(Math.cos(a) * 0.24), K.RIM.y + 0.05, r2(Math.sin(a) * 0.24)];
    const dur = r2(0.62 + d * 0.065), peak = r2(1.1 + d * 0.13);
    this.ball.st = 'shot'; this.ball.holder = null; this.ball.lastTeam = b.team; this.ball.shotBy = b.team;
    this.ball.shot = { by: id, t0: this.t, from, to, dur, peak, res, pts, made, green, three, c, rd: d };
    this.emit({ t: 'shot', id, from, to, dur, peak, res, pts, green: green ? 1 : 0, c: r2(c), q: r2(q), win: r2(win), sb: sb ? 1 : 0 });
  }
  dunk(id, oop) {
    const b = this.bodies.get(id); if (!b || this.phase !== 'live') return;
    if (!oop && (this.ball.holder !== id || this.ball.st !== 'held')) return;
    if (!oop && this.needClear === b.team) { this.emit({ t: 'clear', id, team: b.team }); return; }
    const d = rimDist(b.x, b.z); if (d > (oop ? 2.8 + 0.8 * bk(b, 'lobCity') : 3)) return;
    const defs = this.team(1 - b.team);
    let c = 0, near = null;
    for (const df of defs) { const dist = Math.min(Math.hypot(df.x - b.x, df.z - b.z), rimDist(df.x, df.z) + 0.3); const ci = Math.max(0, (1.9 - dist) / 1.6) * (df.y > 0.2 ? 1.3 : 1); if (ci > c) { c = Math.min(1, ci); near = df; } }
    const fin = rf(b.attrs.fin), post = bk(b, 'posterizer');
    let kind, ok, poster = null;
    if (c > 0.5 && this.rand() > post * 0.7 + fin * 0.2) { kind = c > 0.8 ? 'floater' : 'layup'; ok = this.rand() < 0.5 + fin * 0.25 - c * 0.3; }
    else {
      const pack = b.dunks || ['tomahawk'];
      kind = oop ? 'oop' : near && c > 0.35 ? 'poster' : pack[Math.floor(this.rand() * pack.length)] || 'tomahawk';
      ok = this.rand() < (oop ? 0.84 + 0.12 * bk(b, 'lobCity') : 0.9) + fin * 0.08 - c * 0.35 + post * 0.2;
      if (kind === 'poster' && ok && near) poster = near.id;
    }
    this.ball.st = 'dunk'; this.ball.holder = id; this.ball.lastTeam = b.team; this.ball.shotBy = b.team;
    b.stats.fga++; if (oop && this.lastPass && this.lastPass.to === id) b.oopFrom = this.lastPass.id;
    const tDur = kind === 'layup' || kind === 'floater' ? 0.5 : 0.6;
    this.emit({ t: 'dunk', id, kind, ok: ok ? 1 : 0, poster, dur: tDur });
    if (!b.remote) startDunk(b, kind, ok);
    if (poster) { const v = this.bodies.get(poster); if (v) setTimeout0(this, 0.45, () => this.stun(v, 'fall', 1.4)); }
    this.pending.push({ at: this.t + tDur - 0.05, f: () => {
      if (this.ball.st !== 'dunk' || this.ball.holder !== id) return;
      if (ok) { b.stats.fgm++; if (kind !== 'layup' && kind !== 'floater') b.stats.dunks++; this.ball.holder = null; this.emit({ t: 'rim', f: kind === 'layup' || kind === 'floater' ? 0.2 : 1, swish: 1 }); this.scored(b, 2, kind); }
      else { this.emit({ t: 'miss', id, kind }); this.ball.holder = null; const a = this.rand() * Math.PI; this.loose(0, 3.1, 0.2, Math.cos(a) * 3, 2.5, Math.abs(Math.sin(a)) * 3 + 1); this.ball.rimHit = true; }
    } });
  }
  pass(id, toId, lob) {
    const b = this.bodies.get(id), r = this.bodies.get(toId);
    if (!b || !r || r.team !== b.team || r === b || this.ball.holder !== id || this.ball.st !== 'held' || this.phase !== 'live') return;
    const from = [r2(b.x), 1.3, r2(b.z)];
    let to;
    if (lob) { const d = rimDist(r.x, r.z) || 1; to = [r2(K.RIM.x + (r.x - K.RIM.x) / d * 0.9), 3.35, r2(Math.max(0.3, K.RIM.z + (r.z - K.RIM.z) / d * 0.9))]; }
    else to = [r2(r.x + r.vx * 0.25), 1.3, r2(r.z + r.vz * 0.25)];
    const dist = Math.hypot(to[0] - from[0], to[2] - from[2]), dur = r2(lob ? 0.95 : Math.max(0.22, dist / 15));
    let icpt = null;
    if (!lob) for (const df of this.team(1 - b.team)) {
      const ax = to[0] - from[0], az = to[2] - from[2], L = ax * ax + az * az || 1, s = ((df.x - from[0]) * ax + (df.z - from[2]) * az) / L;
      if (s < 0.15 || s > 0.9) continue;
      const px = from[0] + ax * s, pz = from[2] + az * s;
      if (Math.hypot(df.x - px, df.z - pz) < 0.6 && this.rand() < 0.3 + rf(df.attrs.per) * 0.25) { icpt = { id: df.id, s }; break; }
    }
    this.ball.st = lob ? 'lob' : 'pass'; this.ball.holder = null; this.ball.pass = { by: id, to: toId, t0: this.t, from, to, dur, lob: !!lob, icpt };
    this.lastPass = { id, to: toId, t: this.t, k: bk(b, 'dimer') };
    this.emit({ t: 'pass', id, to: toId, from, dest: to, dur, lob: lob ? 1 : 0, icpt: icpt ? icpt.id : null, s: icpt ? r2(icpt.s) : 1 });
  }
  oop(id) {
    const B = this.ball, P = B.pass; if (B.st !== 'lob' || !P || P.to !== id) return;
    const el = this.t - P.t0; if (el < P.dur - 0.45 || el > P.dur + 0.2) return;
    const b = this.bodies.get(id); if (!b || rimDist(b.x, b.z) > 2.8 + 0.8 * bk(b, 'lobCity')) return;
    this.ball.holder = id; this.dunk(id, true);
  }
  pick(id) {
    const b = this.bodies.get(id); if (!b || this.ball.holder !== id) return;
    const mates = this.team(b.team).filter(m => m !== b); if (!mates.length) return;
    const m = mates.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
    m.ai.pick = { for: id, t: this.t }; this.emit({ t: 'pick', id: m.id, for: id });
  }
  chat(id, i) { this.emit({ t: 'chat', id, i: Math.max(0, Math.min(7, i | 0)) }); }
  /* ---------- the ball ---------- */
  loose(x, y, z, vx, vy, vz) { const B = this.ball; B.st = 'loose'; B.holder = null; B.x = x; B.y = y; B.z = z; B.vx = vx; B.vy = vy; B.vz = vz; B.looseT = this.t; }
  give(b, kind) {
    const B = this.ball, prev = B.lastTeam, wasShot = B.shotBy;
    B.st = 'held'; B.holder = b.id; B.lastTeam = b.team; B.shotBy = null; B.poke = null;
    const changed = this.poss !== b.team;
    if (changed) {
      if (this.redemption != null && this.redemption !== b.team) { this.emit({ t: 'grab', id: b.id, k: kind }); return this.finish(b.team, 'stop'); }
      this.poss = b.team; this.possessed[b.team] = true; this.sclock = this.cfg.shotClock || 0; for (const p of this.bodies.values()) p.pips = K.PIPS;
      if (this.cfg.mode !== 'practice') { this.needClear = rimDist(b.x, b.z) <= K.CLEAR_ARC || !is3(b.x, b.z) ? b.team : null; if (this.needClear != null) this.emit({ t: 'clear', id: b.id, team: b.team }); }
    } else if (kind === 'reb' && B.rimHit) this.sclock = this.cfg.shotClock || 0;
    B.rimHit = false;
    if (kind === 'reb') { b.stats.reb++; if (wasShot === b.team) b.stats.oreb++; }
    this.emit({ t: 'grab', id: b.id, k: kind, poss: this.poss, nc: this.needClear });
  }
  stepBall(dt) {
    const B = this.ball;
    if (B.st === 'held' || B.st === 'dunk') {
      const h = this.holder(); if (!h) { B.st = 'loose'; return; }
      const f = Math.sin(h.yaw), g = Math.cos(h.yaw);
      B.x = h.x + f * 0.35 + g * 0.3 * h.hand; B.z = h.z + g * 0.35 - f * 0.3 * h.hand; B.y = h.y + (B.st === 'dunk' ? 2.6 : 1);
      if (B.st === 'held' && this.needClear === h.team && is3(h.x, h.z)) { this.needClear = null; this.emit({ t: 'cleared', team: h.team }); }
      if (B.st === 'held' && this.phase === 'live' && !inBounds(h.x, h.z, 0.3) && this.cfg.mode !== 'practice') this.violation('oob');
    } else if (B.st === 'shot') {
      const S = B.shot, s = Math.min(1, (this.t - S.t0) / S.dur);
      B.x = S.from[0] + (S.to[0] - S.from[0]) * s; B.z = S.from[2] + (S.to[2] - S.from[2]) * s; B.y = S.from[1] + (S.to[1] - S.from[1]) * s + 4 * S.peak * s * (1 - s);
      if (s >= 1) {
        const sh = this.bodies.get(S.by);
        if (S.made) { if (sh) { sh.stats.fgm++; if (S.three) sh.stats.tpm++; } this.emit({ t: 'rim', f: S.res === 'swish' ? 0.15 : 0.5, swish: S.res === 'swish' ? 1 : 0, green: S.green ? 1 : 0 }); this.scored(sh, S.pts, S.green ? 'green' : S.res); }
        else {
          this.emit({ t: 'miss', id: S.by, res: S.res }); if (S.res !== 'airball') { this.emit({ t: 'rim', f: 0.6, swish: 0 }); B.rimHit = true; }
          const a = Math.atan2(S.from[2], S.from[0]) + (this.rand() - 0.5) * 2.2, sp = 1.8 + this.rand() * 2.6;
          this.loose(B.x, B.y, Math.max(0.1, B.z), Math.cos(a) * sp, 2 + this.rand() * 2, Math.abs(Math.sin(a)) * sp + 0.6);
        }
      }
    } else if (B.st === 'pass' || B.st === 'lob') {
      const P = B.pass, s = Math.min(1, (this.t - P.t0) / P.dur);
      B.x = P.from[0] + (P.to[0] - P.from[0]) * s; B.z = P.from[2] + (P.to[2] - P.from[2]) * s; B.y = P.from[1] + (P.to[1] - P.from[1]) * s + (P.lob ? 2.2 : 0.3) * 4 * s * (1 - s);
      if (P.icpt && s >= P.icpt.s) { const d = this.bodies.get(P.icpt.id); const by = this.bodies.get(P.by); if (d) { d.stats.stl++; if (by) by.stats.tov++; this.emit({ t: 'steal', id: d.id, from: P.by, icpt: 1 }); this.give(d, 'steal'); return; } }
      if (s >= 1) {
        const r = this.bodies.get(P.to);
        if (!P.lob && r && Math.hypot(r.x - P.to[0], r.z - P.to[2]) < 2.2) { r.dimerUntil = this.t + 3; r.dimerK = this.lastPass ? this.lastPass.k : 0; this.give(r, 'catch'); }
        else if (P.lob && this.t - P.t0 < P.dur + 0.2) { /* still catchable for an alley-oop */ }
        else this.loose(B.x, B.y, B.z, (this.rand() - 0.5) * 2, 0, 1.5);
      }
      if (P.lob && this.t - P.t0 >= P.dur + 0.2 && B.st === 'lob') this.loose(B.x, B.y, B.z, (this.rand() - 0.5) * 2, -1, 1.5);
    } else if (B.st === 'loose') {
      B.vy -= 9.8 * dt; B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
      if (B.y < K.BALL_R) { B.y = K.BALL_R; B.vy = Math.abs(B.vy) * 0.62; B.vx *= 0.85; B.vz *= 0.85; if (B.vy < 0.4) B.vy = 0; }
      if (B.z < K.BOARD_Z + 0.1 && B.y > 2.9 && B.y < 4.1 && Math.abs(B.x) < 0.9) { B.z = K.BOARD_Z + 0.1; B.vz = Math.abs(B.vz) * 0.6; }
      if (!inBounds(B.x, B.z, 0.4) && this.cfg.mode !== 'practice') { this.violation('oob', B.lastTeam); return; }
      if (this.cfg.mode === 'practice' && (!inBounds(B.x, B.z, 1) || this.t - B.looseT > 2.5)) { const p = [...this.bodies.values()].find(q => !q.dummy); if (p) this.give(p, 'catch'); return; }
      if (this.t - B.looseT > 0.12) {
        let best = null, bd = 0.85;
        for (const p of this.bodies.values()) {
          if (p.mode === 'fall' || p.mode === 'dunk' || p.dummy) continue;
          const d = Math.hypot(p.x - B.x, p.z - B.z), reach = p.y + 2.45;
          if (d < bd && B.y < reach && B.y > p.y - 0.2) { bd = d; best = p; }
        }
        if (best) this.give(best, B.poke === best.team ? 'steal' : B.shotBy != null ? 'reb' : 'loose');
      }
    }
  }
  /* ---------- scoring and the rules ---------- */
  scored(b, pts, kind) {
    if (!b) return;
    const team = b.team; this.score[team] += pts; b.stats.pts += pts;
    let ast = null; if (this.lastPass && this.lastPass.to === b.id && this.t - this.lastPass.t < 3.5) { const a = this.bodies.get(this.lastPass.id); if (a) { a.stats.ast++; ast = a.id; } }
    this.lastPass = null;
    this.emit({ t: 'score', id: b.id, team, pts, sc: this.score.slice(), kind, ast });
    this.ball.st = 'dead'; this.ball.holder = null; this.ball.x = 0; this.ball.y = 1.2; this.ball.z = 0.4;
    const s = this.score, o = 1 - team;
    if (this.cfg.mode === 'practice') { this.phase = 'scored'; this.timer = 0.7; this.poss = team; return; }
    if (this.redemption === team && s[team] >= s[o]) { this.redemption = null; this.emit({ t: 'redemption', team, done: 1 }); }
    if (s[team] >= this.toWin && s[team] - s[o] >= 2) {
      if (this.cfg.size === 1 && this.cfg.redemption && s[o] === 0 && !this.possessed[o] && this.redemption == null) {   // shutout before they ever touched the ball: Redemption!
        this.redemption = o; this.poss = o; this.phase = 'scored'; this.timer = 2.2; this.emit({ t: 'redemption', team: o }); return;
      }
      if (this.redemption == null) return this.finish(team, kind);
    }
    this.poss = team; this.phase = 'scored'; this.timer = 1.4;
  }
  violation(k, lastTeam) {
    if (this.phase !== 'live') return;
    const lose = k === 'clock' ? this.poss : lastTeam != null ? lastTeam : this.poss;
    const h = this.holder(); if (h) h.stats.tov++;
    this.emit({ t: 'viol', k, team: lose });
    this.ball.st = 'dead'; this.ball.holder = null;
    if (this.redemption != null && this.redemption === lose) return this.finish(1 - lose, 'stop');
    this.poss = 1 - lose; this.phase = 'scored'; this.timer = 1.3;
  }
  finish(win, how) {
    if (this.over) return;
    this.over = true; this.phase = 'end';
    const players = [...this.bodies.values()].filter(b => !b.dummy).map(b => ({ id: b.id, name: b.name, team: b.team, bot: b.bot, look: b.look, elo: b.elo, stats: b.stats }));
    this.result = { win, sc: this.score.slice(), size: this.cfg.size, mode: this.cfg.mode, how, players };
    this.emit({ t: 'end', r: this.result });
  }
  step(dt) {
    this.t += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].at <= this.t) { const p = this.pending.splice(i, 1)[0]; p.f(); }
    if (this.phase === 'end') return;
    if (this.phase === 'check') { this.timer -= dt; if (this.timer <= 0) { this.phase = 'live'; this.emit({ t: 'go' }); } }
    else if (this.phase === 'scored') { this.timer -= dt; if (this.timer <= 0) this.setupCheck(); }
    for (const b of this.bodies.values()) this.stepBody(b, dt);
    this.stepBall(dt);
    if (this.phase === 'live' && this.cfg.shotClock && this.ball.st === 'held') { this.sclock -= dt; if (this.sclock <= 0) { this.sclock = 0; this.violation('clock'); } }
  }
  stepBody(b, dt) {
    if (b.remote) return;
    const hasBall = this.ball.holder === b.id && this.ball.st === 'held';
    const inp = b.bot || b.dummy ? this.think(b, dt, hasBall) : { mx: 0, mz: 0 };
    const others = [...this.bodies.values()].filter(o => o !== b);
    const lob = this.ball.st === 'lob' && this.ball.pass && this.ball.pass.to === b.id;
    const out = stepPlayer(b, inp, { hasBall, live: this.phase === 'live', frozen: this.phase === 'check' || this.phase === 'end', needClear: this.needClear === b.team, others, oop: lob }, dt);
    this.applyOut(b, out, inp);
  }
  applyOut(b, out, inp) {
    if (out.fake) this.fake(b.id);
    if (out.move) this.move(b.id, out.move);
    if (out.shotStart) this.shotStart(b.id);
    if (out.release) this.release(b.id, out.release.q, out.release.sb);
    if (out.dunk) this.dunk(b.id);
    if (out.steal) this.steal(b.id);
    if (out.jump) this.jumped(b);
    if (out.oop) this.oop(b.id);
    if (inp && inp.pass != null) this.pass(b.id, inp.pass, inp.lob);
    if (inp && inp.pick) this.pick(b.id);
  }
}
function setTimeout0(g, d, f) { g.pending.push({ at: g.t + d, f }); }

/* ================= the CPU players ================= */
Object.assign(Game.prototype, {
  think(b, dt, hasBall) {
    const inp = { mx: 0, mz: 0, sP: false, sR: false, sD: false, jP: false, kP: false, kH: false, lP: false, turbo: false, face: null, faceT: null, pass: null, lob: false, pick: false };
    const ai = b.ai, B = this.ball, sk = b.skill;
    ai.dec = (ai.dec || 0) - dt; ai.react = ai.react || 0;
    if (this.phase !== 'live') { ai.dec = 0.2 + this.rand() * 0.3; return inp; }
    const go = (x, z, slow) => { const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz); if (d > 0.25) { const k = slow ? Math.min(1, d / 1.5) : Math.min(1, d / 0.6); inp.mx = dx / d * k; inp.mz = dz / d * k; } return d; };
    const opp = this.team(1 - b.team), mates = this.team(b.team).filter(m => m !== b);
    const man = opp[b.slot % Math.max(1, opp.length)] || opp[0];
    // keep shooting once we've started
    if (b.mode === 'gather') {
      inp.sD = true;
      if (b.jumped) { if (ai.relQ == null) ai.relQ = 1 + (this.rand() - 0.5) * ((1 - sk) * 0.9 + 0.06) + (this.rand() < 0.15 ? (this.rand() - 0.5) * 0.4 : 0); if (b.gT >= shotT(b) * ai.relQ) { inp.sD = false; inp.sR = true; ai.relQ = null; } }
      return inp;
    }
    if (b.dummy) {   // practice dummy: stays in front, lazy hands
      const h = this.holder(); if (h) { const d = rimDist(h.x, h.z) || 1; go(h.x + (K.RIM.x - h.x) / d * 1.3, h.z + (K.RIM.z - h.z) / d * 1.3, true); inp.faceT = Math.atan2(h.x - b.x, h.z - b.z); inp.kH = true; }
      return inp;
    }
    if (hasBall) return this.thinkBall(b, inp, dt, opp, mates, man, go);
    // loose ball, shots and rebounds
    if (B.st === 'loose' || B.st === 'shot' || (B.st === 'lob' && B.pass && B.pass.to !== b.id)) {
      let tx = B.x, tz = B.z;
      if (B.st === 'shot') { const s = B.shot; if (!s.made) { const d = rimDist(s.from[0], s.from[2]) || 1; tx = (s.from[0] / d) * 2; tz = Math.max(0.6, (s.from[2] / d) * 2); } else { tx = b.x; tz = b.z; } }
      const crash = B.st !== 'shot' || this.team(b.team).indexOf(b) === 0 || rf(b.attrs.int) > 0.5 || B.shot.by === b.id;
      if (crash) { go(tx, tz); if (B.st === 'loose' && Math.hypot(B.x - b.x, B.z - b.z) < 1.3 && B.y > 2 && B.y < 3.6 && b.ground) inp.lP = true; }
      else if (man) go(man.x + (K.RIM.x - man.x) * 0.3, man.z + (K.RIM.z - man.z) * 0.3);
      return inp;
    }
    if (B.st === 'lob' && B.pass && B.pass.to === b.id) { go(B.pass.to[0], B.pass.to[2]); inp.turbo = true; if (this.t - B.pass.t0 > B.pass.dur - 0.3) inp.sP = true; this.oopTry = true; return inp; }
    const offense = this.poss === b.team && B.st !== 'dead';
    return offense ? this.thinkOff(b, inp, dt, opp, mates, man, go) : this.thinkDef(b, inp, dt, opp, mates, man, go);
  },
  thinkBall(b, inp, dt, opp, mates, man, go) {
    const ai = b.ai, sk = b.skill, rd = rimDist(b.x, b.z), h = b;
    let def = null, dd = 99; for (const o of opp) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < dd) { dd = d; def = o; } }
    const c = contestOf(b, opp), range = 7.7 + 1.8 * bk(b, 'limitless') + (rf(b.attrs.sht) - 0.5);
    inp.face = Math.atan2(K.RIM.x - b.x, K.RIM.z - b.z);
    if (this.needClear === b.team) { const d = rd || 1; go(K.RIM.x + (b.x - K.RIM.x) / d * 7.4, Math.max(2, K.RIM.z + (b.z - K.RIM.z) / d * 7.4)); inp.face = null; return inp; }
    if (b.mode === 'drive' || b.mode === 'jab' || b.mode === 'spin' || b.mode === 'euro') {
      go(K.RIM.x, K.RIM.z + 0.6); inp.turbo = true; inp.face = null;
      if (rd < 2.5) inp.sP = true;
      else if (b.mode === 'drive' && def && dd < 1.6 && b.pips > 0 && this.rand() < 0.08 * sk) inp.jP = true;
      return inp;
    }
    if (b.mode === 'step' || b.mode === 'step2') { if (b.mt < 0.12 && (c < 0.45 || this.rand() < 0.4)) inp.sP = true, inp.sD = true; else if (b.mt < 0.12 && this.rand() < 0.25 * sk && b.pips > 0) inp.jP = true; return inp; }
    ai.dec -= 0;
    if (ai.dec > 0) { if (ai.hold) go(ai.hold[0], ai.hold[1], true); return inp; }
    ai.dec = 0.22 + this.rand() * 0.35 * (1.2 - sk);
    const clockLow = this.cfg.shotClock && this.sclock < 2.6;
    // pass to an open teammate (2v2 / 3v3)
    if (mates.length && this.rand() < 0.35) {
      let best = null, bc = c - 0.25;
      for (const m of mates) { const mc = contestOf(m, opp); if (mc < bc && m.mode !== 'fall') { bc = mc; best = m; } }
      const cutter = mates.find(m => rimDist(m.x, m.z) < 2.8 && opp.every(o => Math.hypot(o.x - m.x, o.z - m.z) > 1.8));
      if (cutter && this.rand() < 0.5) { inp.pass = cutter.id; inp.lob = true; return inp; }
      if (best && !clockLow) { inp.pass = best.id; return inp; }
      if (def && dd < 1.6 && this.rand() < 0.15) { inp.pick = true; }
    }
    const lane = !opp.some(o => { const ox = o.x - b.x, oz = o.z - b.z, rx = K.RIM.x - b.x, rz = K.RIM.z - b.z, L = Math.hypot(rx, rz) || 1, along = (ox * rx + oz * rz) / L; return along > 0 && along < L && Math.abs(ox * rz - oz * rx) / L < 1.1; });
    if (rd < 2.4) { inp.sP = true; inp.turbo = true; return inp; }
    if ((c < 0.28 && rd < range && this.rand() < 0.55 + rf(b.attrs.sht) * 0.4) || clockLow) { inp.sP = true; inp.sD = true; return inp; }
    if (lane && rf(b.attrs.fin) > 0.3 && this.rand() < 0.45) { inp.lP = true; inp.turbo = true; return inp; }
    if (def && dd < 2.4 && b.pips > 0 && this.rand() < 0.4 + rf(b.attrs.hnd) * 0.3) { const r = this.rand(); if (r < 0.45) inp.jP = true; else if (r < 0.8) inp.kP = true; else { inp.lP = true; inp.turbo = true; } return inp; }
    // jab around the arc
    const a = Math.atan2(b.x, b.z) + (this.rand() - 0.5) * 1.2, rr = Math.max(5.2, Math.min(8, rd + (this.rand() - 0.6) * 2));
    ai.hold = [Math.sin(a) * rr, Math.max(0.8, Math.cos(a) * rr)];
    return inp;
  },
  thinkOff(b, inp, dt, opp, mates, man, go) {
    const ai = b.ai, h = this.holder();
    if (ai.pick && h && this.t - ai.pick.t < 3.2) {   // set a screen on the ball handler's defender, then roll or pop
      const hd = opp.find(o => Math.hypot(o.x - h.x, o.z - h.z) < 2.5) || opp[0];
      const el = this.t - ai.pick.t;
      if (el < 1.9 && hd) { const sx = hd.x + (hd.x - h.x) * 0.15 + (b.x > h.x ? 0.5 : -0.5), sz = hd.z + 0.2; const d = go(sx, sz); b.screen = d < 0.7; if (b.screen) { inp.mx = inp.mz = 0; inp.faceT = Math.atan2(h.x - b.x, h.z - b.z); } return inp; }
      b.screen = false; if (!ai.pickEnd) ai.pickEnd = this.rand() < 0.6 ? 'roll' : 'pop';
      if (ai.pickEnd === 'roll') go(0, 1.6); else go(b.x > 0 ? 5.6 : -5.6, 5.2);
      return inp;
    }
    ai.pick = null; ai.pickEnd = null; b.screen = false;
    const taken = new Set([h ? h.id : -1]);
    const myIdx = this.team(b.team).indexOf(b);
    const spot = [[-6.9, 0.7], [6.9, 0.7], [-5.6, 5], [5.6, 5]][(myIdx + (h ? h.slot : 0)) % 4];
    ai.cutT = (ai.cutT || 0) - dt;
    if (ai.cutT > 0) { go(0, 1.2); return inp; }
    if (man && Math.hypot(man.x - b.x, man.z - b.z) > 2.6 && h && this.rand() < 0.01) ai.cutT = 1.2;   // backdoor cut
    go(spot[0], spot[1], true);
    return inp;
  },
  thinkDef(b, inp, dt, opp, mates, man, go) {
    const ai = b.ai, h = this.holder(), sk = b.skill;
    if (!man) return inp;
    const hasMan = h === man;
    let tx, tz;
    const md = rimDist(man.x, man.z) || 1, ux = (K.RIM.x - man.x) / md, uz = (K.RIM.z - man.z) / md;
    const gap = hasMan ? 1.05 + (1 - rf(b.attrs.per)) * 0.35 : 1.9;
    tx = man.x + ux * gap; tz = man.z + uz * gap;
    if (!hasMan && h && rimDist(h.x, h.z) < 3.6 && md > 4 && this.rand() < 0.9) { tx = (h.x + K.RIM.x) / 2; tz = (h.z + K.RIM.z) / 2 + 0.3; }   // help defense
    const d = go(tx, tz);
    inp.faceT = Math.atan2((hasMan ? man.x : (h || man).x) - b.x, (hasMan ? man.z : (h || man).z) - b.z);
    inp.kH = hasMan && d < 1.4;
    inp.turbo = d > 2;
    ai.cd = (ai.cd || 0) - dt;
    if (h && ai.cd <= 0) {
      const dh = Math.hypot(h.x - b.x, h.z - b.z);
      if ((h.mode === 'gather' || h.mode === 'air' || h.shooting > this.t - 0.25) && dh < 2.8 && b.ground) {
        if (ai.jt == null) ai.jt = 0.05 + (1 - sk) * 0.22 + this.rand() * 0.1; ai.jt -= dt;
        if (ai.jt <= 0) { inp.lP = true; ai.jt = null; ai.cd = 0.6; }
      } else ai.jt = null;
      if (h.mode === 'fake' && dh < 2.6 && b.ground && this.rand() < 0.5 * (1.1 - sk)) { inp.lP = true; ai.cd = 0.8; }
      if (hasMan && dh < 1.6 && ['cross', 'hesi', 'spin', 'step', 'euro'].includes(h.mode) && this.rand() < 0.05 * sk + 0.02) { inp.jP = true; ai.cd = 0.7; }
      if (hasMan && dh < 1.4 && this.rand() < 0.004) { inp.jP = true; ai.cd = 0.9; }
      if (h.mode === 'drive' && dh < 1.0 && b.mode === 'slide' && this.rand() < (0.15 + 0.35 * bk(b, 'clamps')) * dt * 8 && !h.remote) this.stun(h, 'pickup', 0.45);
    }
    return inp;
  },
});

/* ================= Elo and ranks ================= */
const TIERS = [['Bronze', 0, '#b87333'], ['Silver', 1100, '#9aa7bd'], ['Gold', 1250, '#e0a800'], ['Platinum', 1400, '#38d0c8'], ['Diamond', 1600, '#4f8cff'], ['Iso Legend', 1800, '#ff6a3d']];
const tierOf = (e) => { let r = TIERS[0]; for (const t of TIERS) if (e >= t[1]) r = t; return r; };
function eloChange(mine, theirs, won, games) { const k = games < 10 ? 40 : games < 30 ? 28 : 20, exp = 1 / (1 + Math.pow(10, (theirs - mine) / 400)); return Math.round(k * ((won ? 1 : 0) - exp)); }

return { K, rimDist, is3, inBounds, SPOTS, ATTRS, BUDGET, ARCHETYPES, BADGES, BADGE_LV, BOSSES, rf, bk, jumpV, runSpeed, shotT, contestOf, contestLabel, greenWindow,
  MODES, MODE_ID, newPlayer, stepPlayer, startDunk, Game, TIERS, tierOf, eloChange, DUNKS };
});
