/* Slap Brawl: the game engine shared by the Bluu server and the game page.
   Arenas, physics, abilities, match rules and the bots all live here, so the server and the page always agree. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SlapCore = factory(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ================= tuning ================= */
const C = {
  G: 32, JUMP: 11.5, SPEED: 9, GROUND_ACCEL: 40, AIR_ACCEL: 7, ICE_ACCEL: 2.2,
  R: 0.5, H: 2.3, SLIDE_H: 1.0, SLIDE_TIME: 0.55, SLIDE_SPEED: 15, SLIDE_CD: 1.1, COYOTE: 0.12, BUFFER: 0.13,
  SLAP_CD: 0.42, SLAP_RANGE: 3.9, SLAP_CONE: 0.42, PARRY_TIME: 0.45, PARRY_CD: 2.5,
  KB_H: 17, KB_V: 7.5, STUN: 0.38, VOID_Y: -28, RESPAWN: 2.2, GOAL_PAUSE: 3, PRE: 3, WIN_GOALS: 5,
  KOTH_WIN: 100, KOTH_RATE: 10, ZONE_R: 4, CRUMBLE_EVERY: 3, BOSS_LIVES: 12,
};
const TEAM_NAMES = ['RED', 'BLUE'];
const ABILITIES = [
  { id: 'dash', name: 'Dash', icon: '💨', cd: 4, desc: 'Burst forward through the air. Great for saving yourself from the void.' },
  { id: 'berserk', name: 'Berserk', icon: '🔥', cd: 12, dur: 4, desc: 'Flaming glove for 4s. Your next slap hits 2.3x harder.' },
  { id: 'tank', name: 'Knockback Tank', icon: '🛡️', cd: 12, dur: 4, desc: 'Heavy shield for 4s. Take 80% less knockback.' },
  { id: 'invis', name: 'Invisibility', icon: '👻', cd: 12, dur: 4, desc: 'Almost invisible for 4s. Bots lose track of you. Breaks when you slap.' },
  { id: 'grapple', name: 'Grapple Hook', icon: '🪝', cd: 6, desc: 'Pull yourself to a platform, or yank an enemy toward you.' },
  { id: 'slam', name: 'Shockwave Slam', icon: '💥', cd: 9, desc: 'Jump up and slam down, blasting everyone nearby away.' },
  { id: 'swap', name: 'Switcheroo', icon: '🔄', cd: 10, desc: 'Fire an orb. Swap places with the enemy it hits.' },
  { id: 'bridge', name: 'Platform Bridge', icon: '🟦', cd: 10, desc: 'A glowing platform appears under your feet for 5s.' },
  { id: 'freeze', name: 'Time Freeze', icon: '⏳', cd: 14, desc: 'A bubble that slows enemies inside by 70% for 2.5s.' },
  { id: 'decoy', name: 'Decoy Clone', icon: '👥', cd: 12, desc: 'A fake you runs at the enemy goal to bait their slaps.' },
];
const AB = {}; for (const a of ABILITIES) AB[a.id] = a;
const MUTATORS = [
  { id: 'lowgrav', name: 'Low Gravity', icon: '🌙' }, { id: 'mega', name: '2x Mega Knockback', icon: '💥' }, { id: 'nocd', name: 'Zero Cooldowns', icon: '♾️' },
  { id: 'ice', name: 'Slippery Ice', icon: '🧊' }, { id: 'tiny', name: 'Tiny Hitboxes', icon: '🐜' },
];

/* ================= arenas: boxes (b), cylinders (c) and rings (r). y is the bottom, top is the standing height ================= */
const ARENAS = [
  { id: 'classic', name: 'Classic Sky Bridge', desc: 'A narrow bridge with parkour stones on both sides.', theme: { top: 0x63d35c, side: 0x9b6b43, sky: ['#3f9dff', '#cfeaff'], accent: 0xffffff, fog: 0xcfeaff } },
  { id: 'tiles', name: 'Dissolving Tiles', desc: 'Hex tiles flash yellow and fall away after you step on them.', theme: { top: 0xeaf2ff, side: 0x7aa2d6, sky: ['#6aa6ff', '#e6f1ff'], accent: 0xffd23f, fog: 0xe6f1ff } },
  { id: 'rails', name: 'Dual Rails', desc: 'Two thin balance beams and a center island with a launch pad.', theme: { top: 0xd9dee8, side: 0x6c7891, sky: ['#ff9f6b', '#ffe2c2'], accent: 0x3fe0ff, fog: 0xffe2c2 } },
  { id: 'conveyor', name: 'Conveyor Chaos', desc: 'Belts push you sideways and spinning arms sweep the lanes.', theme: { top: 0x9aa3b5, side: 0x4a5266, sky: ['#5c7cff', '#d8e0ff'], accent: 0xffc21a, fog: 0xd8e0ff } },
  { id: 'colosseum', name: 'Colosseum Void', desc: 'A ring around a hole, with pillars you can smash.', theme: { top: 0xf3ead8, side: 0xc9b48f, sky: ['#2f8fd6', '#d9f0ff'], accent: 0xd4a72c, fog: 0xd9f0ff } },
  { id: 'laser', name: 'Laser Citadel', desc: 'Laser sweepers cross the bridge. Jump over or slide under.', theme: { top: 0x3a4157, side: 0x22283a, sky: ['#2a1f5c', '#8c7bd6'], accent: 0xff3b6b, fog: 0x8c7bd6 } },
];
const EXTRA = {
  island: { id: 'island', name: 'Crown Island', desc: 'Hold the crown zone to score.', theme: { top: 0x6fd36a, side: 0x8a6243, sky: ['#3f9dff', '#d6f0ff'], accent: 0xffd23f, fog: 0xd6f0ff } },
  boss: { id: 'boss', name: "Overlord's Throne", desc: 'Defeat THE SLAP OVERLORD.', theme: { top: 0x4a3a5c, side: 0x2a2036, sky: ['#3a0a14', '#a83a2a'], accent: 0xff4d2e, fog: 0x6a2420 } },
};

function makeArena(id) {
  const info = ARENAS.find(a => a.id === id) || EXTRA[id] || ARENAS[0];
  const shapes = [];
  const add = (s) => { s.i = shapes.length; s.alive = true; s.top = s.y + s.h; shapes.push(s); return s; };
  const box = (x, z, w, d, top, th, o) => add(Object.assign({ t: 'b', x, z, w, d, y: top - (th || 1.2), h: th || 1.2 }, o || {}));
  const cyl = (x, z, r, top, th, o) => add(Object.assign({ t: 'c', x, z, r, y: top - (th || 1.2), h: th || 1.2 }, o || {}));
  const ring = (x, z, r0, r1, top, th, o) => add(Object.assign({ t: 'r', x, z, r0, r1, y: top - (th || 2), h: th || 2 }, o || {}));
  const A = { id: info.id, name: info.name, desc: info.desc, theme: info.theme, shapes, spawns: [[], []], ffa: [], portals: [], lanes: [], pads: [], lasers: [], arms: [], zone: null, decor: [], crumble: [] };
  const bases = () => {
    for (const [team, s] of [[0, -1], [1, 1]]) {
      box(0, s * 32, 10, 10, 0, 2.5, { base: team });
      box(-6.5, s * 32, 3, 10, 0, 1.6, { crumble: 1, base: team });
      box(6.5, s * 32, 3, 10, 0, 1.6, { crumble: 1, base: team });
      box(0, s * 38.5, 16, 3, 0, 1.6, { crumble: 1, base: team });
      box(-3.4, s * 28.4, 1.6, 1.6, 1, 1, { base: team }); box(3.4, s * 28.4, 1.6, 1.6, 1, 1, { base: team });   // cover blocks
      A.portals.push({ team, x: 0, y: 0, z: s * 35.6 });
      A.spawns[team] = [[-1.2, s * 31.5], [1.2, s * 31.5], [-3.6, s * 32.5], [3.6, s * 32.5]];
    }
  };
  if (info.id === 'classic') {
    bases();
    for (let k = 0; k < 9; k++) box(0, -24 + k * 6, 3, 6.02, 0, 1.4, { bridge: 1 });
    const H = [0, 0.7, 1.3, 0.7];
    for (const sx of [-1, 1]) for (let k = 0; k < 11; k++) box(sx * 7, -24.5 + k * 4.9, 2.2, 2.2, H[k % 4], 1, { crumble: 1 });
    A.lanes.push([[0, -27], [0, 27]]);
    for (const sx of [-1, 1]) { const l = [[sx * 6.5, -27]]; for (let k = 0; k < 11; k++) l.push([sx * 7, -24.5 + k * 4.9]); l.push([sx * 6.5, 27]); A.lanes.push(l); }
    A.decor.push({ k: 'clouds' });
  } else if (info.id === 'tiles') {
    bases();
    let row = 0;
    for (let z = -26; z <= 26.01; z += 1.9, row++) { const off = row % 2 ? 1.05 : 0; for (let x = -4.2 + off; x <= 4.21; x += 2.1) cyl(+x.toFixed(2), +z.toFixed(2), 1.15, 0, 0.8, { tile: 1 }); }
    A.lanes.push([[-2.1, -27], [-2.1, 27]], [[0, -27], [0, 27]], [[2.1, -27], [2.1, 27]]);
  } else if (info.id === 'rails') {
    bases();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 3.5, sz * 16.35, 1.1, 21.5, 0, 0.7, { rail: 1 });
    cyl(0, 0, 6, 0, 2.5, { island: 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 7, sz * 12, 3, 3, 0.4, 1, { crumble: 1 });
    A.pads.push({ x: 0, z: 0, y: 0, r: 1.3, vy: 24 });
    for (const sx of [-1, 1]) A.lanes.push([[sx * 3.5, -27], [sx * 3.5, -5.5], [sx * 3.5, 0], [sx * 3.5, 5.5], [sx * 3.5, 27]]);
  } else if (info.id === 'conveyor') {
    bases();
    [-5, 0, 5].forEach((lx, li) => { for (let k = 0; k < 4; k++) { const belt = (k === 1 || k === 2) ? ((li + k) % 2 ? 3.5 : -3.5) : 0; box(lx, -27 + 6.75 + k * 13.5, 3, 13.52, 0, 1.2, { belt, crumble: lx ? 1 : 0 }); } });
    for (const sx of [-1, 1]) for (const z of [-13.5, 0, 13.5]) { cyl(sx * 2.5, z, 0.55, 2.4, 3.4, { bumper: 1 }); A.arms.push({ x: sx * 2.5, z, len: 3.4, y: 0.15, h: 0.6, w: (z === 0 ? 1.3 : 1.0) * sx, ph: z * 0.2 }); }
    for (const lx of [-5, 0, 5]) A.lanes.push([[lx, -27], [lx, 27]]);
  } else if (info.id === 'colosseum') {
    bases();
    ring(0, 0, 7, 13, 0, 2.5, {});
    for (const s of [-1, 1]) box(0, s * 20, 2.2, 15.2, 0, 0.8, { catwalk: 1 });
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; cyl(+(Math.cos(a) * 10).toFixed(2), +(Math.sin(a) * 10).toFixed(2), 0.9, 3.5, 3.5, { pillar: 1, hp: 4 }); }
    for (const sx of [-1, 1]) A.lanes.push([[0, -27], [0, -12.5], [sx * 7, -7.4], [sx * 10, 0], [sx * 7, 7.4], [0, 12.5], [0, 27]]);
  } else if (info.id === 'laser') {
    bases();
    for (let k = 0; k < 6; k++) box(0, -22.5 + k * 9, 6, 9.02, 0, 1.6, {});
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) box(sx * 4.6, -18 + k * 12, 1.6, 6, 0.5, 0.9, { crumble: 1 });
    A.lasers.push({ z0: -15, amp: 7, w: 0.9, ph: 0, y: 0.2, h: 0.55, x1: 3.2 }, { z0: 0, amp: 9, w: 0.65, ph: 1.7, y: 1.3, h: 0.45, x1: 3.2 }, { z0: 15, amp: 7, w: 1.05, ph: 3.1, y: 0.2, h: 0.55, x1: 3.2 });
    A.lanes.push([[0, -27], [0, 27]], [[-1.6, -27], [-1.6, 27]], [[1.6, -27], [1.6, 27]]);
    A.decor.push({ k: 'towers' });
  } else if (info.id === 'island') {
    cyl(0, 0, 17, 0, 3, {});
    cyl(0, 0, 4, 0.35, 0.5, { zone: 1 });
    box(7.5, 0, 1.5, 4, 1.2, 1.2); box(-7.5, 0, 1.5, 4, 1.2, 1.2); box(0, 7.5, 4, 1.5, 1.2, 1.2); box(0, -7.5, 4, 1.5, 1.2, 1.2);
    A.zone = { x: 0, z: 0, r: C.ZONE_R };
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; A.ffa.push([+(Math.cos(a) * 12.5).toFixed(2), +(Math.sin(a) * 12.5).toFixed(2)]); }
  } else if (info.id === 'boss') {
    cyl(0, 0, 19, 0, 3, {});
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; cyl(+(Math.cos(a) * 13).toFixed(2), +(Math.sin(a) * 13).toFixed(2), 1.6, 1.6, 1.6, {}); }
    A.spawns[0] = [[-3, 13], [3, 13], [-6, 11], [6, 11]];
    A.spawns[1] = [[0, -4], [-5, -6], [5, -6], [0, -9]];
  }
  // overtime: the outer pieces crumble first, two at a time
  const cr = shapes.filter(s => s.crumble).sort((a, b) => (Math.abs(b.x) - Math.abs(a.x)) || (Math.abs(b.z) - Math.abs(a.z)));
  for (let i = 0; i < cr.length; i += 2) A.crumble.push(cr.slice(i, i + 2).map(s => s.i));
  return A;
}
const laserZ = (L, t) => L.z0 + L.amp * Math.sin(L.w * t + L.ph);
const armAngle = (R, t) => R.w * t + R.ph;

/* ================= the world: shapes, platforms and bubbles ================= */
class World {
  constructor(A, mut) { this.A = A; this.mut = mut || {}; this.shapes = A.shapes.map(s => Object.assign({}, s)); this.dyn = []; this.bubbles = []; this.t = 0; }
  all() { return this.dyn.length ? this.shapes.concat(this.dyn) : this.shapes; }
  topAt(x, z, below) {   // the highest standing height under (x, z), at or below "below"
    let best = -Infinity;
    for (const s of this.all()) if (s.alive && s.top <= (below == null ? 1e9 : below) && s.top > best && covers(s, x, z, 0)) best = s.top;
    return best;
  }
  supportAt(x, y, z, r) {   // the shape you're standing on (for bodies the server doesn't simulate)
    let best = null;
    for (const s of this.all()) if (s.alive && Math.abs(s.top - y) < 0.2 && covers(s, x, z, (r || C.R) * 0.45) && (!best || s.top > best.top)) best = s;
    return best;
  }
  inside(x, y, z) { for (const s of this.all()) if (s.alive && y >= s.y && y <= s.top && covers(s, x, z, 0)) return s; return null; }
}
function covers(s, x, z, pad) {
  if (s.t === 'b') return Math.abs(x - s.x) <= s.w / 2 + pad && Math.abs(z - s.z) <= s.d / 2 + pad;
  const d = Math.hypot(x - s.x, z - s.z);
  if (s.t === 'c') return d <= s.r + pad;
  return d >= s.r0 - pad && d <= s.r1 + pad;
}
function pushOut(b, s) {
  const r = b.r;
  if (s.t === 'b') {
    const hx = s.w / 2, hz = s.d / 2, cx = Math.max(s.x - hx, Math.min(b.x, s.x + hx)), cz = Math.max(s.z - hz, Math.min(b.z, s.z + hz));
    const dx = b.x - cx, dz = b.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return null;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); return { nx: dx / d, nz: dz / d, pen: r - d }; }
    const e = [[s.x + hx - b.x, 1, 0], [b.x - (s.x - hx), -1, 0], [s.z + hz - b.z, 0, 1], [b.z - (s.z - hz), 0, -1]].sort((a, c) => a[0] - c[0])[0];
    return { nx: e[1], nz: e[2], pen: e[0] + r };
  }
  const dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz), nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  if (s.t === 'c') return d < s.r + r ? { nx, nz, pen: s.r + r - d } : null;
  if (d + r <= s.r0 || d - r >= s.r1) return null;
  return d < (s.r0 + s.r1) / 2 ? { nx: -nx, nz: -nz, pen: d - (s.r0 - r) } : { nx, nz, pen: s.r1 + r - d };
}
const overlapV = (b, s) => b.y < s.top - 0.02 && b.y + b.h > s.y + 0.02;
function bubbleSlow(b, W) {
  for (const q of W.bubbles) if (q.until > W.t && (b.team < 0 || q.team < 0 ? q.owner !== b.id : q.team !== b.team) && Math.hypot(b.x - q.x, b.y + 1 - q.y, b.z - q.z) < q.r) return 0.3;
  return 1;
}

/* ================= movement physics (the page runs this for you, the server runs it for bots) ================= */
const NOIN = { mx: 0, mz: 0, jump: false, slide: false, face: null };
function stepBody(b, inp, W, dt) {
  const mut = W.mut, out = {};
  const slow = bubbleSlow(b, W), sdt = dt * slow;
  b.slowed = slow < 1;
  b.stun = Math.max(0, b.stun - dt); b.slideCd = Math.max(0, b.slideCd - dt);
  if (b.slideT > 0) b.slideT -= sdt;
  const scale = (b.scale || 1) * (mut.tiny ? 0.62 : 1);
  b.r = C.R * scale;
  const wasSliding = b.slideT > 0;
  if (inp.face != null && !wasSliding) b.yaw = inp.face;
  if (inp.slide && !wasSliding && b.slideCd <= 0 && b.ground && b.stun <= 0) {
    b.slideT = C.SLIDE_TIME; b.slideCd = mut.nocd ? 0.3 : C.SLIDE_CD;
    b.vx = Math.sin(b.yaw) * C.SLIDE_SPEED; b.vz = Math.cos(b.yaw) * C.SLIDE_SPEED; out.slide = 1;
  }
  b.h = (b.slideT > 0 ? C.SLIDE_H : C.H) * scale;
  const sp = C.SPEED * (b.speed || 1);
  let acc = b.ground ? (mut.ice ? C.ICE_ACCEL : C.GROUND_ACCEL) : C.AIR_ACCEL;
  if (b.stun > 0) acc *= 0.1;
  if (b.slideT > 0) acc = b.ground ? 1.2 : 0.6;
  const k = Math.min(1, acc * sdt);
  b.vx += ((inp.mx || 0) * sp - b.vx) * k; b.vz += ((inp.mz || 0) * sp - b.vz) * k;
  if (inp.jump) b.jumpBuf = C.BUFFER; else b.jumpBuf = Math.max(0, b.jumpBuf - dt);
  b.coyote = b.ground ? C.COYOTE : Math.max(0, b.coyote - dt);
  if (b.jumpBuf > 0 && b.coyote > 0 && b.stun < 0.12) {
    b.vy = C.JUMP * (mut.lowgrav ? 0.85 : 1); b.ground = false; b.coyote = 0; b.jumpBuf = 0; b.slideT = Math.min(b.slideT, 0); b.h = C.H * scale; out.jump = 1;
  }
  if (b.slamming && b.vy < 4) b.vy = -34;
  b.vy = Math.max(-55, b.vy - C.G * (mut.lowgrav ? 0.42 : 1) * sdt);
  if (b.ground && b.gs && b.gs.belt) b.x += b.gs.belt * sdt;   // conveyor belts
  const dx = b.vx * sdt, dz = b.vz * sdt, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (b.r * 0.8)));
  for (let i = 0; i < n; i++) { b.x += dx / n; b.z += dz / n; collideSides(b, W, out); }
  const py = b.y; b.y += b.vy * sdt;
  let best = null;
  if (b.vy <= 0) for (const s of W.all()) if (s.alive && s.top <= py + 0.06 && b.y <= s.top && covers(s, b.x, b.z, b.r * 0.45) && (!best || s.top > best.top)) best = s;
  if (best) { if (!b.ground) out.land = -b.vy; b.y = best.top; b.vy = 0; b.ground = true; b.gs = best; }
  else { b.ground = false; b.gs = null; }
  if (b.vy > 0) for (const s of W.all()) if (s.alive && s.y >= py + b.h - 0.05 && s.y <= b.y + b.h && covers(s, b.x, b.z, 0)) { b.y = s.y - b.h; b.vy = 0; }
  if (b.slamming && b.ground) { b.slamming = false; out.slamLand = 1; }
  return out;
}
function collideSides(b, W, out) {
  for (const s of W.all()) {
    if (!s.alive || !overlapV(b, s)) continue;
    const p = pushOut(b, s); if (!p) continue;
    const step = s.top - b.y;
    if (step > 0 && step <= 0.5 && b.vy <= 2) { b.y = s.top; continue; }   // walk up small steps
    const vn = b.vx * p.nx + b.vz * p.nz;
    b.x += p.nx * p.pen; b.z += p.nz * p.pen;
    if (vn < 0) { b.vx -= vn * p.nx; b.vz -= vn * p.nz; }
    if (step > 0 && step <= 1.35 && vn < -1 && b.vy > -8 && b.stun <= 0 && !b.slamming) { b.vy = Math.max(b.vy, 8.5); out.vault = 1; }   // ledge vault
  }
}
function knock(b, vx, vy, vz, stun) { b.vx = vx; b.vy = vy; b.vz = vz; b.stun = stun || 0; b.ground = false; b.gs = null; b.slideT = 0; }
function hazards(b, W, dt) {   // jump pads, lasers, spinning arms and bumpers. Whoever moves the body checks these.
  const A = W.A, t = W.t;
  b.hzCd = Math.max(0, (b.hzCd || 0) - dt);
  for (const p of A.pads) if (b.ground && Math.abs(b.y - p.y) < 0.2 && Math.hypot(b.x - p.x, b.z - p.z) < p.r) {
    b.vy = p.vy; b.ground = false; b.gs = null; b.vx += Math.sin(b.yaw) * 4; b.vz += Math.cos(b.yaw) * 4; return 'pad';
  }
  if (b.hzCd > 0) return null;
  for (const L of A.lasers) {
    const lz = laserZ(L, t);
    if (Math.abs(b.z - lz) < b.r + 0.18 && Math.abs(b.x) < L.x1 + b.r && b.y < L.y + L.h && b.y + b.h > L.y) {
      const s = b.x >= 0 ? 1 : -1, dzs = b.z >= lz ? 1 : -1; knock(b, s * 6, 8.5, dzs * 10, 0.45); b.hzCd = 0.8; return 'laser';
    }
  }
  for (const R of A.arms) {
    const a = armAngle(R, t), ex = Math.cos(a), ez = Math.sin(a);
    const px = b.x - R.x, pz = b.z - R.z, along = Math.max(0, Math.min(R.len, px * ex + pz * ez));
    if (Math.hypot(px - ex * along, pz - ez * along) < b.r + 0.22 && b.y < R.y + R.h && b.y + b.h > R.y && along > 0.4) {
      const s = Math.sign(R.w); knock(b, -ez * s * 11, 7.5, ex * s * 11, 0.45); b.hzCd = 0.8; return 'arm';
    }
  }
  for (const s of W.shapes) if (s.bumper && s.alive && overlapV(b, s) && Math.hypot(b.x - s.x, b.z - s.z) < s.r + b.r + 0.1) {
    const dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz) || 1; knock(b, dx / d * 14, 6, dz / d * 14, 0.35); b.hzCd = 0.5; return 'bump';
  }
  return null;
}
function rayShapes(W, ox, oy, oz, dx, dy, dz, max) {
  for (let t = 0.6; t <= max; t += 0.35) { const s = W.inside(ox + dx * t, oy + dy * t, oz + dz * t); if (s) return { t, s }; }
  return null;
}

/* ================= a match: rules, slaps, abilities, bots. Runs on the server (online) or in the page (offline) ================= */
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const enemies = (a, b) => a !== b && !b.dead && (a.team < 0 || b.team < 0 ? (a.owner !== b.id && b.owner !== a.id && (a.owner == null || a.owner !== b.owner)) : a.team !== b.team);
const r2 = (v) => Math.round(v * 100) / 100;
class Match {
  constructor(cfg) {
    this.mode = cfg.mode || 'bridge';
    this.arenaId = this.mode === 'koth' ? 'island' : this.mode === 'boss' ? 'boss' : (cfg.arena || 'classic');
    this.A = makeArena(this.arenaId); this.mut = cfg.mut || {}; this.W = new World(this.A, this.mut);
    this.bodies = new Map(); this.ev = []; this.t = 0; this.phase = 'pre'; this.timer = C.PRE; this.score = [0, 0];
    this.toWin = C.WIN_GOALS; this.ot = false; this.otPending = false; this.crumbleT = 0; this.crumbleI = 0; this.endAfter = null;
    this.orbs = []; this.tele = []; this.tiles = {}; this.pillarT = {}; this.nid = 50000; this.lives = C.BOSS_LIVES; this.over = false; this.result = null;
    this.rand = cfg.rand || Math.random;
  }
  emit(e) { this.ev.push(e); }
  drain() { const e = this.ev; this.ev = []; return e; }
  info(b) { return { id: b.id, name: b.name, team: b.team, bot: b.bot, decoy: b.decoy, minion: b.minion, boss: b.boss, owner: b.owner, color: b.color, look: b.look, ability: b.ability, scale: b.scale, title: b.title }; }
  addBody(o) {
    const b = {
      id: o.id, name: o.name || 'Player', team: o.team == null ? -1 : o.team, bot: !!o.bot, remote: !!o.remote, decoy: !!o.decoy, minion: !!o.minion, boss: !!o.boss, owner: o.owner,
      color: o.color || 0, look: o.look || {}, title: o.title || '', ability: AB[o.ability] ? o.ability : 'dash', skill: o.skill || 0.8, scale: o.scale || 1, speed: o.speed || 1,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, gs: null, r: C.R, h: C.H, stun: 0, slideT: 0, slideCd: 0, jumpBuf: 0, coyote: 0,
      dead: false, respawnT: 0, slapCd: 0, parryT: 0, parryCd: 0, abCd: 0, buffs: {}, slamming: false, lastHit: null, combo: { n: 0, t: -9 }, launch: null,
      kp: 0, hp: o.boss ? 100 : 0, life: o.life || 0, emote: 0, slot: o.slot || 0, abUsed: {},
      stats: { slaps: 0, hits: 0, kos: 0, goals: 0, parries: 0, launch: 0, deaths: 0, abs: 0, combo: 0 }, ai: {},
    };
    this.bodies.set(b.id, b);
    this.place(b, this.spawnFor(b), true);
    if (this.started) this.emit({ t: 'add', p: this.info(b), s: [r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)] });
    return b;
  }
  removeBody(id) { if (this.bodies.delete(id)) this.emit({ t: 'rem', id }); }
  spawnFor(b) {
    const A = this.A;
    if (b.boss) return [0, -6, 0];
    if (b.minion || b.decoy) return [b.x, b.z, b.yaw];
    if (this.mode === 'koth') { const pts = A.ffa, i = Math.floor(this.rand() * pts.length); return [pts[i][0], pts[i][1], Math.atan2(-pts[i][0], -pts[i][1])]; }
    const list = A.spawns[b.team === 1 ? 1 : 0], p = list[b.slot % list.length];
    return [p[0], p[1], this.mode === 'boss' ? Math.PI : (b.team === 1 ? Math.PI : 0)];
  }
  place(b, s, quiet) {
    const y = Math.max(0, this.W.topAt(s[0], s[1], 50)) + 0.05;
    b.x = s[0]; b.z = s[1]; b.y = y; b.vx = b.vy = b.vz = 0; b.yaw = s[2] || 0; b.stun = 0; b.slamming = false; b.ground = true;
    if (b.remote && !quiet) this.emit({ t: 'tp', id: b.id, p: [r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)], v0: 1 });
  }
  impulse(b, vx, vy, vz, stun, flag) {   // knock a body: directly if we move it, or tell its player's page
    if (b.boss) return;
    if (b.remote) this.emit({ t: 'kb', id: b.id, v: [r2(vx), r2(vy), r2(vz)], s: stun || 0, f: flag || 0 });
    else { knock(b, vx, vy, vz, stun); if (flag === 1) b.slamming = true; }
  }
  teleport(b, x, y, z) { b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0; if (b.remote) this.emit({ t: 'tp', id: b.id, p: [r2(x), r2(y), r2(z), r2(b.yaw)], v0: 1 }); }
  start() {   // everything the page needs to draw the match
    this.started = true;
    return { t: 'start', mode: this.mode, arena: this.arenaId, mut: this.mut, toWin: this.toWin, sc: this.score, ph: this.phase, tl: r2(this.timer), tm: r2(this.t), ot: this.ot, lives: this.lives,
      players: [...this.bodies.values()].map(b => Object.assign(this.info(b), { s: [r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)], dead: b.dead })),
      gone: this.W.shapes.filter(s => !s.alive).map(s => s.i), tiles: this.tiles, plats: this.W.dyn.map(p => ({ pid: p.pid, x: p.x, z: p.z, top: p.top, d: r2(p.until - this.t) })) };
  }
  snap() {
    const b = [];
    for (const p of this.bodies.values()) {
      const f = (p.ground ? 1 : 0) | (p.slideT > 0 ? 2 : 0) | (p.dead ? 4 : 0) | (p.parryT > 0 ? 8 : 0) | (p.buffs.berserk > this.t ? 16 : 0) | (p.buffs.tank > this.t ? 32 : 0) |
        (p.buffs.invis > this.t ? 64 : 0) | (Math.hypot(p.vx, p.vz) > 1 ? 128 : 0) | (p.slamming ? 256 : 0) | (p.stun > 0 ? 512 : 0) | (p.slowed ? 1024 : 0);
      b.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), f, p.boss ? Math.round(p.hp * 10) / 10 : Math.floor(p.kp)]);
    }
    return { t: 'st', tm: r2(this.t), ph: this.phase, tl: r2(Math.max(0, this.timer)), sc: this.score, lives: this.lives, b };
  }
  /* ---------- messages from players ---------- */
  report(id, m) {   // a player's page tells us where they are
    const b = this.bodies.get(id); if (!b || b.dead || !Array.isArray(m.p)) return;
    const n = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
    b.x = n(m.p[0], -90, 90); b.y = n(m.p[1], -60, 60); b.z = n(m.p[2], -90, 90);
    if (Array.isArray(m.v)) { b.vx = n(m.v[0], -80, 80); b.vy = n(m.v[1], -80, 80); b.vz = n(m.v[2], -80, 80); }
    b.yaw = n(m.yaw, -20, 20); b.pitch = n(m.pitch, -2, 2);
    const f = m.f | 0; b.ground = !!(f & 1); b.slideT = f & 2 ? 0.1 : 0; b.slamming = !!(f & 256); b.stun = f & 512 ? 0.1 : 0;
    const scale = (b.scale || 1) * (this.mut.tiny ? 0.62 : 1); b.r = C.R * scale; b.h = (f & 2 ? C.SLIDE_H : C.H) * scale;
  }
  dead(id) { const b = this.bodies.get(id); if (b && !b.dead) this.kill(b); }
  emote(id, e) { const b = this.bodies.get(id); if (b && !b.dead) this.emit({ t: 'emote', id, e: Math.max(0, Math.min(7, e | 0)) }); }
  parry(id) {
    const b = this.bodies.get(id); if (!b || b.dead || b.parryCd > 0 || this.phase === 'end') return;
    b.parryT = C.PARRY_TIME; b.parryCd = this.mut.nocd ? 0.3 : C.PARRY_CD; this.emit({ t: 'guard', id });
  }
  slap(id, yaw, pitch) {
    const a = this.bodies.get(id); if (!a || a.dead || a.slapCd > 0 || this.phase === 'end') return;
    a.slapCd = this.mut.nocd ? 0.18 : C.SLAP_CD; a.yaw = Number(yaw) || 0; pitch = Math.max(-1, Math.min(1, Number(pitch) || 0));
    if (a.buffs.invis > this.t) { a.buffs.invis = 0; this.emit({ t: 'buff', id, b: 'invis', d: 0 }); }
    this.emit({ t: 'swing', id });
    if (this.phase === 'pre') return;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), tiny = this.mut.tiny ? 0.65 : 1;
    let best = null, bd = 1e9;
    for (const e of this.bodies.values()) {
      if (!enemies(a, e)) continue;
      const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz), dy = (e.y + e.h / 2) - (a.y + 1.1);
      const reach = C.SLAP_RANGE * tiny * (a.boss ? 1.6 : 1) + (e.boss ? e.r : 0);
      if (d > reach || Math.abs(dy) > (e.boss ? 6 : 2.6)) continue;
      if (d > 1.3 && (dx * fx + dz * fz) / d < C.SLAP_CONE) continue;
      if (e.slideT > 0 && a.slideT <= 0 && pitch > -0.25 && !a.boss) continue;   // ducked under a high slap
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) {   // smash pillars in the Colosseum
      for (const s of this.W.shapes) if (s.pillar && s.alive) {
        const dx = s.x - a.x, dz = s.z - a.z, d = Math.hypot(dx, dz);
        if (d < s.r + 2.6 && (d < 0.5 || (dx * fx + dz * fz) / d > 0.3) && a.y < s.top && a.y + 2 > s.y) {
          s.hp = (s.hp || 4) - 1;
          if (s.hp <= 0) { s.alive = false; this.pillarT[s.i] = 15; }
          this.emit({ t: 'pillar', i: s.i, hp: Math.max(0, s.hp) }); break;
        }
      }
      return;
    }
    const e = best;
    a.stats.slaps++;
    if (e.parryT > 0 && !a.boss) {   // parried: the slap bounces back 130%
      e.stats.parries++; e.parryT = 0;
      const dx = a.x - e.x, dz = a.z - e.z, d = Math.hypot(dx, dz) || 1;
      this.impulse(a, dx / d * C.KB_H * 1.3, C.KB_V * 1.2, dz / d * C.KB_H * 1.3, C.STUN + 0.1);
      a.lastHit = { by: e.id, t: this.t };
      this.emit({ t: 'parry', id: e.id, by: a.id, x: r2(e.x), y: r2(e.y + 1.2), z: r2(e.z) });
      return;
    }
    a.stats.hits++;
    if (e.decoy) { this.emit({ t: 'hit', a: a.id, v: e.id, kb: 0, combo: 1, x: r2(e.x), y: r2(e.y + 1.2), z: r2(e.z) }); this.kill(e); return; }
    let mult = 1;
    const ber = a.buffs.berserk > this.t;
    if (ber) { mult *= 2.3; a.buffs.berserk = 0; this.emit({ t: 'buff', id: a.id, b: 'berserk', d: 0 }); }
    if (e.boss) {
      const dmg = 0.75 * (ber ? 3 : 1) * (this.mut.mega ? 1.5 : 1);
      e.hp = Math.max(0, e.hp - dmg);
      this.emit({ t: 'hit', a: a.id, v: e.id, kb: 0, dmg: r2(dmg), combo: 1, x: r2(a.x + fx * 2), y: r2(a.y + 1.6), z: r2(a.z + fz * 2), ber: ber ? 1 : 0 });
      if (e.hp <= 0) this.finish(0);
      return;
    }
    const n = !e.ground && this.t - e.combo.t < 1.6 ? Math.min(4, e.combo.n + 1) : 1;
    e.combo = { n, t: this.t }; a.stats.combo = Math.max(a.stats.combo, n);
    mult *= 1 + (n - 1) * 0.25;
    if (e.buffs.tank > this.t) mult *= 0.2;
    if (this.mut.mega) mult *= 2;
    if (a.minion) mult *= 0.75;
    if (a.boss) mult *= 1.35;
    const tx = e.x - a.x, tz = e.z - a.z, tl = Math.hypot(tx, tz) || 1;
    let dx = fx * 0.65 + tx / tl * 0.35, dz = fz * 0.65 + tz / tl * 0.35; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const h = C.KB_H * mult, v = Math.max(4, C.KB_V + pitch * 12) * (1 + (Math.min(mult, 3) - 1) * 0.4);
    this.impulse(e, dx * h, v, dz * h, C.STUN);
    e.lastHit = { by: a.id, t: this.t }; e.launch = { x: e.x, z: e.z, t: this.t, max: 0 };
    this.emit({ t: 'hit', a: a.id, v: e.id, kb: Math.round(Math.hypot(h, v) * 5), combo: n, x: r2(e.x), y: r2(e.y + 1.2), z: r2(e.z), ber: ber ? 1 : 0 });
  }
  useAbility(id, yaw, pitch) {
    const b = this.bodies.get(id); if (!b || b.dead || b.abCd > 0 || this.phase !== 'live') return;
    const ab = b.ability, def = AB[ab]; if (!def) return;
    b.abCd = this.mut.nocd ? 0.5 : def.cd; b.stats.abs++; b.abUsed[ab] = 1;
    yaw = Number(yaw); if (!Number.isFinite(yaw)) yaw = b.yaw; pitch = Math.max(-1.2, Math.min(1.2, Number(pitch) || 0));
    const fx = Math.sin(yaw), fz = Math.cos(yaw), t = this.t;
    this.emit({ t: 'ab', id, ab });
    if (ab === 'dash') this.impulse(b, fx * 26, Math.max(4, b.vy * 0.3 + 4), fz * 26, 0.22);
    else if (ab === 'berserk' || ab === 'tank' || ab === 'invis') { b.buffs[ab] = t + def.dur; this.emit({ t: 'buff', id, b: ab, d: def.dur }); }
    else if (ab === 'grapple') {
      const cp = Math.cos(pitch), dx = fx * cp, dy = Math.sin(pitch), dz = fz * cp, ox = b.x, oy = b.y + 1.4, oz = b.z;
      let tgt = null, tt = 24;
      for (const e of this.bodies.values()) {
        if (!enemies(b, e) || e.boss) continue;
        const px = e.x - ox, py = e.y + 1.1 - oy, pz = e.z - oz, along = px * dx + py * dy + pz * dz;
        if (along < 0 || along > tt) continue;
        if (Math.hypot(px - dx * along, py - dy * along, pz - dz * along) < 1.5) { tt = along; tgt = e; }
      }
      const hit = rayShapes(this.W, ox, oy, oz, dx, dy, dz, tgt ? tt : 24);
      if (tgt && (!hit || hit.t > tt)) {
        const d = Math.hypot(b.x - tgt.x, b.z - tgt.z) || 1;
        this.impulse(tgt, (b.x - tgt.x) / d * 19, 7, (b.z - tgt.z) / d * 19, 0.4); tgt.lastHit = { by: b.id, t };
        this.emit({ t: 'grap', id, to: [r2(tgt.x), r2(tgt.y + 1.1), r2(tgt.z)], who: tgt.id });
      } else if (hit) {
        const px = ox + dx * hit.t, py = oy + dy * hit.t, pz = oz + dz * hit.t, l = Math.hypot(px - b.x, py - b.y, pz - b.z) || 1;
        this.impulse(b, (px - b.x) / l * 25, Math.max(6, (py - b.y) / l * 25 + 5), (pz - b.z) / l * 25, 0.3);
        this.emit({ t: 'grap', id, to: [r2(px), r2(py), r2(pz)] });
      } else this.emit({ t: 'grap', id, to: [r2(ox + dx * 24), r2(oy + dy * 24), r2(oz + dz * 24)], miss: 1 });
    } else if (ab === 'slam') this.impulse(b, b.vx * 0.3, 13, b.vz * 0.3, 0.05, 1);
    else if (ab === 'swap') {
      const oid = this.nid++, cp = Math.cos(pitch);
      const o = { oid, owner: id, x: b.x + fx, y: b.y + 1.3, z: b.z + fz, vx: fx * cp * 32, vy: Math.sin(pitch) * 32, vz: fz * cp * 32, life: 1.1 };
      this.orbs.push(o); this.emit({ t: 'orb', oid, p: [r2(o.x), r2(o.y), r2(o.z)], v: [r2(o.vx), r2(o.vy), r2(o.vz)] });
    } else if (ab === 'bridge') {
      const y = b.remote ? b.y + b.vy * 0.12 : b.y, top = r2(b.ground ? b.y : y - 0.25), pid = this.nid++;
      const x = r2(b.remote ? b.x + b.vx * 0.12 : b.x), z = r2(b.remote ? b.z + b.vz * 0.12 : b.z);
      this.W.dyn.push({ t: 'b', i: -pid, pid, x, z, w: 3.2, d: 3.2, y: top - 0.4, h: 0.4, top, alive: true, until: t + 5, plat: 1 });
      this.emit({ t: 'plat', pid, x, z, top, d: 5 });
    } else if (ab === 'freeze') {
      const q = { x: r2(b.x), y: r2(b.y + 1), z: r2(b.z), r: 6, team: b.team, owner: b.id, until: t + 2.5 };
      this.W.bubbles.push(q); this.emit({ t: 'bubble', x: q.x, y: q.y, z: q.z, r: q.r, team: q.team, owner: q.owner, d: 2.5 });
    } else if (ab === 'decoy') {
      const d = this.addBody({ id: this.nid++, name: b.name, team: b.team, decoy: true, owner: b.id, color: b.color, look: b.look, title: b.title, life: 6, skill: 1 });
      d.x = b.x + fx; d.z = b.z + fz; d.y = b.y; d.yaw = yaw; d.ground = b.ground; d.life = 6; d.ai = { wp: null };
      this.emit({ t: 'tp', id: d.id, p: [r2(d.x), r2(d.y), r2(d.z), r2(d.yaw)] });
    }
  }
  slamLand(id, x, y, z) {
    const b = this.bodies.get(id); if (!b || b.dead) return;
    this.emit({ t: 'shock', id, x: r2(x), y: r2(y), z: r2(z) });
    for (const e of this.bodies.values()) {
      if (!enemies(b, e) || e.boss) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < 6.5 && Math.abs(e.y - y) < 3) {
        if (e.decoy) { this.kill(e); continue; }
        const k = (1 - d / 8) * (e.buffs.tank > this.t ? 0.2 : 1) * (this.mut.mega ? 2 : 1), dd = d || 1;
        this.impulse(e, (e.x - x) / dd * 20 * k, 11 * Math.max(0.5, k), (e.z - z) / dd * 20 * k, C.STUN); e.lastHit = { by: id, t: this.t };
      }
    }
  }
  /* ---------- the match clock ---------- */
  step(dt) {
    this.t += dt; this.W.t = this.t;
    if (this.phase === 'pre') { this.timer -= dt; if (this.timer <= 0) { this.phase = 'live'; this.timer = 0; this.emit({ t: 'go' }); } }
    else if (this.phase === 'goal') { this.timer -= dt; if (this.timer <= 0) { if (this.endAfter != null) this.finish(this.endAfter); else this.resetRound(); } }
    if (this.phase === 'end') return;
    if (this.ot && this.phase === 'live') {
      this.crumbleT -= dt;
      if (this.crumbleT <= 0) { this.crumbleT = C.CRUMBLE_EVERY; const g = this.A.crumble[this.crumbleI++]; if (g) { for (const i of g) this.W.shapes[i].alive = false; this.emit({ t: 'crumble', ids: g }); } }
    }
    if (this.W.dyn.length) this.W.dyn = this.W.dyn.filter(p => p.until > this.t);
    if (this.W.bubbles.length) this.W.bubbles = this.W.bubbles.filter(q => q.until > this.t);
    for (const k in this.tiles) {
      const s = this.tiles[k]; s.t -= dt;
      if (s.t > 0) continue;
      const sh = this.W.shapes[k];
      if (s.s === 1) { sh.alive = false; s.s = 2; s.t = 4; this.emit({ t: 'tile', i: +k, s: 2 }); }
      else { sh.alive = true; delete this.tiles[k]; this.emit({ t: 'tile', i: +k, s: 0 }); }
    }
    for (const k in this.pillarT) { this.pillarT[k] -= dt; if (this.pillarT[k] <= 0) { delete this.pillarT[k]; const s = this.W.shapes[k]; s.alive = true; s.hp = 4; this.emit({ t: 'pillar', i: +k, hp: 4 }); } }
    for (const b of [...this.bodies.values()]) this.stepBodyM(b, dt);
    this.stepOrbs(dt);
    if (this.mode === 'koth' && this.phase === 'live') {
      const Z = this.A.zone, inZone = [...this.bodies.values()].filter(b => !b.dead && !b.decoy && Math.hypot(b.x - Z.x, b.z - Z.z) < Z.r && b.y > -0.5 && b.y < 3);
      this.contested = inZone.length > 1;
      if (inZone.length === 1) { const p = inZone[0]; p.kp += C.KOTH_RATE * dt; if (p.kp >= C.KOTH_WIN) { p.kp = C.KOTH_WIN; this.finish(p.id); } }
    }
    if (this.tele.length) this.tele = this.tele.filter(q => q.until > this.t);
  }
  stepBodyM(b, dt) {
    b.slapCd = Math.max(0, b.slapCd - dt); b.parryT = Math.max(0, b.parryT - dt); b.parryCd = Math.max(0, b.parryCd - dt); b.abCd = Math.max(0, b.abCd - dt);
    if (b.dead) { b.respawnT -= dt; if (b.respawnT <= 0 && this.phase !== 'end' && !b.decoy && !b.minion) this.respawn(b); return; }
    if (b.decoy) { b.life -= dt; if (b.life <= 0) { this.emit({ t: 'poof', id: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z) }); this.removeBody(b.id); return; } }
    if (!b.remote) {
      let inp = this.think(b, dt);
      if (this.phase !== 'live' && this.phase !== 'goal') inp = NOIN;
      const out = stepBody(b, inp, this.W, dt);
      const hz = hazards(b, this.W, dt); if (hz) this.emit({ t: 'hz', id: b.id, k: hz });
      if (out.slamLand) this.slamLand(b.id, b.x, b.y, b.z);
      if (inp.slap) this.slap(b.id, b.yaw, inp.pitch || 0);
      if (inp.parry) this.parry(b.id);
      if (inp.ab) this.useAbility(b.id, inp.abYaw != null ? inp.abYaw : b.yaw, inp.pitch || 0);
      if (b.y < C.VOID_Y) { this.kill(b); return; }
    }
    if (b.launch) { b.launch.max = Math.max(b.launch.max, Math.hypot(b.x - b.launch.x, b.z - b.launch.z)); if (b.ground && this.t - b.launch.t > 0.3) { b.stats.launch = Math.max(b.stats.launch, b.launch.max); b.launch = null; } }
    if (this.mode === 'bridge' && this.phase === 'live' && !b.decoy) {
      for (const p of this.A.portals) if (p.team !== b.team && Math.hypot(b.x - p.x, b.z - p.z) < 1.7 && b.y > p.y - 0.5 && b.y < p.y + 3) { this.goal(b); break; }
    }
    if (this.arenaId === 'tiles' && this.phase === 'live') {
      const s = b.remote ? this.W.supportAt(b.x, b.y, b.z, b.r) : (b.ground ? b.gs : null);
      if (s && s.tile && !this.tiles[s.i]) { this.tiles[s.i] = { s: 1, t: 1.1 }; this.emit({ t: 'tile', i: s.i, s: 1 }); }
    }
  }
  stepOrbs(dt) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.life -= dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      const owner = this.bodies.get(o.owner);
      let hit = null;
      if (owner) for (const e of this.bodies.values()) if (enemies(owner, e) && !e.boss && Math.hypot(e.x - o.x, e.y + 1.1 - o.y, e.z - o.z) < 1.4) { hit = e; break; }
      if (hit && owner && !owner.dead) {
        const ax = owner.x, ay = owner.y, az = owner.z;
        this.teleport(owner, hit.x, hit.y + 0.05, hit.z); this.teleport(hit, ax, ay + 0.05, az);
        if (hit.decoy) this.kill(hit);
        this.emit({ t: 'orbx', oid: o.oid, swap: [owner.id, hit.id] }); this.orbs.splice(i, 1); continue;
      }
      if (o.life <= 0 || this.W.inside(o.x, o.y, o.z)) { this.emit({ t: 'orbx', oid: o.oid }); this.orbs.splice(i, 1); }
    }
  }
  kill(b) {
    if (b.dead) return;
    b.dead = true; b.respawnT = this.mode === 'boss' ? 3 : C.RESPAWN; b.stats.deaths++; b.slamming = false;
    if (b.launch) { b.stats.launch = Math.max(b.stats.launch, b.launch.max); b.launch = null; }
    const k = b.lastHit && this.t - b.lastHit.t < 7 ? this.bodies.get(b.lastHit.by) : null;
    if (k && !b.decoy) k.stats.kos++;
    this.emit({ t: 'ko', id: b.id, by: k ? k.id : null, x: r2(b.x), y: r2(Math.max(b.y, C.VOID_Y)), z: r2(b.z), decoy: b.decoy ? 1 : 0 });
    b.lastHit = null; b.kp = this.mode === 'koth' ? b.kp : b.kp;
    if (b.decoy || b.minion) { this.removeBody(b.id); return; }
    if (this.mode === 'boss' && b.team === 0) { this.lives--; if (this.lives <= 0) this.finish(1); }
  }
  respawn(b) {
    b.dead = false; b.buffs = {}; b.ai = { lane: this.rand() < 0.5 ? 0 : null }; b.combo = { n: 0, t: -9 }; b.slideT = 0;
    const s = this.spawnFor(b); this.place(b, s, true);
    this.emit({ t: 'spawn', id: b.id, p: [r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)] });
  }
  goal(b) {
    this.score[b.team]++; b.stats.goals++;
    this.emit({ t: 'goal', id: b.id, team: b.team, sc: this.score.slice() });
    this.phase = 'goal'; this.timer = C.GOAL_PAUSE;
    if (this.score[b.team] >= this.toWin) { this.endAfter = b.team; this.timer = 2.5; }
    else if (this.score[0] === this.toWin - 1 && this.score[1] === this.toWin - 1 && !this.ot) this.otPending = true;
  }
  resetRound() {
    for (const b of [...this.bodies.values()]) if (b.decoy || b.minion) this.removeBody(b.id);
    this.W.dyn = []; this.W.bubbles = []; this.orbs = [];
    for (const k in this.tiles) this.W.shapes[k].alive = true;
    this.tiles = {};
    const spawns = {};
    for (const b of this.bodies.values()) {
      b.dead = false; b.buffs = {}; b.ai = { lane: this.rand() < 0.5 ? 0 : null }; b.slapCd = 0; b.parryT = 0; b.abCd = Math.min(b.abCd, 1); b.combo = { n: 0, t: -9 }; b.lastHit = null;
      this.place(b, this.spawnFor(b), true); spawns[b.id] = [r2(b.x), r2(b.y), r2(b.z), r2(b.yaw)];
    }
    this.phase = 'pre'; this.timer = C.PRE;
    if (this.otPending) { this.ot = true; this.otPending = false; this.crumbleT = C.CRUMBLE_EVERY; }
    this.emit({ t: 'reset', sc: this.score.slice(), spawns, ot: this.ot, tl: C.PRE });
  }
  finish(win) {
    if (this.phase === 'end') return;
    this.phase = 'end'; this.over = true;
    const players = [...this.bodies.values()].filter(b => !b.decoy && !b.minion && !b.boss).map(b => ({ id: b.id, name: b.name, team: b.team, bot: b.bot, color: b.color, look: b.look, title: b.title, kp: Math.floor(b.kp), stats: b.stats, abUsed: Object.keys(b.abUsed) }));
    for (const p of players) p.score = p.stats.goals * 30 + p.stats.kos * 12 + p.stats.hits * 2 + p.stats.parries * 6 + Math.floor(p.kp / 5) + Math.round(p.stats.launch);
    this.result = { mode: this.mode, arena: this.arenaId, win, sc: this.score.slice(), lives: this.lives, players };
    this.emit({ t: 'end', r: this.result });
  }
}

/* ================= the bots ================= */
Object.assign(Match.prototype, {
  pathFor(b) {
    const A = this.A, ai = b.ai;
    if (ai.lane == null) ai.lane = this.rand() < 0.45 ? 0 : Math.floor(this.rand() * A.lanes.length);
    const L = A.lanes[ai.lane % A.lanes.length] || [[0, -27], [0, 27]];
    const s = b.team === 1 ? -1 : 1, foe = A.portals.find(p => p.team !== b.team) || { x: 0, z: s * 35 };
    const pts = (s > 0 ? L : L.slice().reverse()).map(p => [p[0], p[1]]);
    return [[0, -s * 29.5], [pts[0][0] * 0.6, -s * 27.6]].concat(pts, [[pts[pts.length - 1][0] * 0.6, s * 27.6], [0, s * 30], [foe.x, foe.z]]);
  },
  steer(b, inp, x, z, safe) {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    let mx = dx / d, mz = dz / d;
    if (safe && b.ground && this.W.topAt(b.x + mx * 1.1, b.z + mz * 1.1, b.y + 0.6) < b.y - 2) {   // don't walk off the edge
      const sx = mz, sz = -mx;   // try sliding along the edge instead
      if (this.W.topAt(b.x + sx * 1.1, b.z + sz * 1.1, b.y + 0.6) >= b.y - 2) { mx = sx * 0.6; mz = sz * 0.6; }
      else if (this.W.topAt(b.x - sx * 1.1, b.z - sz * 1.1, b.y + 0.6) >= b.y - 2) { mx = -sx * 0.6; mz = -sz * 0.6; }
      else { mx = 0; mz = 0; }
    }
    inp.mx = mx; inp.mz = mz; inp.face = Math.atan2(dx, dz);
    return d;
  },
  nav(b, inp, path) {
    const ai = b.ai;
    if (ai.wp != null && ai.wp < path.length) {
      const cur = path[ai.wp], prev = path[Math.max(0, ai.wp - 1)];
      const segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]), off = Math.hypot(cur[0] - b.x, cur[1] - b.z) + Math.hypot(prev[0] - b.x, prev[1] - b.z) - segLen;
      if (off > 2.5) ai.wp = null;   // knocked off the path: find it again
    }
    if (ai.wp == null || ai.wp >= path.length || ai.pathKey !== path.length) {
      let bi = 0, bd = 1e9; path.forEach((p, i) => { const d = Math.hypot(p[0] - b.x, p[1] - b.z); if (d < bd) { bd = d; bi = i; } });
      ai.wp = Math.min(path.length - 1, bi + (bd < 3 ? 1 : 0)); ai.pathKey = path.length;
    }
    let p = path[ai.wp];
    if (Math.hypot(p[0] - b.x, p[1] - b.z) < 1.2 && ai.wp < path.length - 1) { ai.wp++; p = path[ai.wp]; }
    const d = this.steer(b, inp, p[0], p[1], false);
    if (b.ground && d > 0.3) {
      const mx = inp.mx, mz = inp.mz;
      const ahead = this.W.topAt(b.x + mx * 0.85, b.z + mz * 0.85, b.y + 1.5);
      const tp = this.W.topAt(p[0], p[1], b.y + 2.2);
      const vAlong = b.vx * mx + b.vz * mz, edge = this.W.topAt(b.x + mx * 0.3, b.z + mz * 0.3, b.y + 1.5) < b.y - 1.5;
      if (ahead < b.y - 1.5 && tp > -50 && (vAlong > 5.5 || edge)) inp.jump = true;   // a gap: jump it
      if (tp > b.y + 0.45 && d < 3.4) inp.jump = true;     // a step up
    }
    return d;
  },
  nearestEnemy(b, maxD, filter) {
    let best = null, bd = maxD;
    for (const e of this.bodies.values()) {
      if (!enemies(b, e) || e.dead) continue;
      if (filter && !filter(e)) continue;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (e.buffs.invis > this.t && d > 2.2) continue;   // can't see invisible players
      if (Math.abs(e.y - b.y) > 4.5 && !e.boss) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },
  fight(b, inp, e, dt) {
    const ai = b.ai, d = Math.hypot(e.x - b.x, e.z - b.z), reach = C.SLAP_RANGE * (this.mut.tiny ? 0.65 : 1) + (e.boss ? e.r : 0);
    if (d > reach * 0.72) this.steer(b, inp, e.x, e.z, true);
    else {
      inp.face = Math.atan2(e.x - b.x, e.z - b.z); const side = (ai.strafe || 1) * 0.35, sx = Math.cos(inp.face) * side, sz = -Math.sin(inp.face) * side;
      if (!b.ground || this.W.topAt(b.x + sx * 2.5, b.z + sz * 2.5, b.y + 0.6) >= b.y - 2) { inp.mx = sx; inp.mz = sz; }
    }
    inp.face = Math.atan2(e.x - b.x, e.z - b.z);
    if (d < reach * 0.95 && b.slapCd <= 0) {
      if (ai.react == null) ai.react = 0.06 + (1 - b.skill) * 0.35 + this.rand() * 0.12;
      ai.react -= dt;
      if (ai.react <= 0) { inp.slap = true; ai.react = null; inp.pitch = 0.1 + this.rand() * 0.25; }
    }
    if (!e.ground && e.y > b.y + 1 && d < 3 && b.ground && this.rand() < 0.05) inp.jump = true;   // jump to juggle
  },
  think(b, dt) {
    const inp = { mx: 0, mz: 0, jump: false, slide: false, face: null, slap: false, parry: false, ab: false, pitch: 0.12 };
    if (b.boss) return this.bossAI(b, dt, inp);
    const ai = b.ai, W = this.W;
    if (b.ground) { ai.lastGround = b.y; ai.lastGX = b.x; ai.lastGZ = b.z; }
    // falling into the void: steer back and use an ability to save yourself
    const below = W.topAt(b.x, b.z, b.y + 0.1);
    if (!b.ground && b.vy < -1 && below < b.y - 6 && ai.lastGround != null) {
      const path = this.mode === 'bridge' && !b.minion ? this.pathFor(b) : null;
      let tx = ai.lastGX, tz = ai.lastGZ;
      if (path) { let bd = 1e9; for (const p of path) { const d = Math.hypot(p[0] - b.x, p[1] - b.z); if (d < bd) { bd = d; tx = p[0]; tz = p[1]; } } }
      else if (this.mode !== 'bridge') { const k = Math.hypot(b.x, b.z) || 1; tx = b.x / k * Math.max(0, k - 6); tz = b.z / k * Math.max(0, k - 6); }
      this.steer(b, inp, tx, tz, false);
      if (b.abCd <= 0 && !b.decoy && !b.minion && b.y < ai.lastGround - 1) {
        const ab = b.ability;
        if (ab === 'dash' || ab === 'bridge') { inp.ab = true; inp.abYaw = Math.atan2(tx - b.x, tz - b.z); }
        else if (ab === 'grapple') { inp.ab = true; inp.abYaw = Math.atan2(tx - b.x, tz - b.z); inp.pitch = Math.atan2((ai.lastGround + 0.5) - (b.y + 1.4), Math.hypot(tx - b.x, tz - b.z) || 1); }
        else if (ab === 'swap') { const e = this.nearestEnemy(b, 28); if (e && e.ground) { inp.ab = true; inp.abYaw = Math.atan2(e.x - b.x, e.z - b.z); inp.pitch = Math.atan2(e.y + 1.1 - (b.y + 1.3), Math.hypot(e.x - b.x, e.z - b.z) || 1); } }
      }
      return inp;
    }
    if (b.decoy) {
      if (this.mode === 'bridge') this.nav(b, inp, this.pathFor(b)); else if (this.A.zone) this.steer(b, inp, 0, 0, true);
      return inp;
    }
    if (b.minion) { const e = this.nearestEnemy(b, 40); if (e) this.fight(b, inp, e, dt); return inp; }
    ai.strafeT = (ai.strafeT || 0) - dt; if (ai.strafeT <= 0) { ai.strafeT = 0.6 + this.rand(); ai.strafe = this.rand() < 0.5 ? -1 : 1; }
    // stuck? hop
    ai.stuckT = (ai.stuckT || 0) + dt;
    if (ai.stuckT > 0.7) { const moved = Math.hypot(b.x - (ai.sx || 0), b.z - (ai.sz || 0)); if (moved < 0.35 && ai.wanted) inp.jump = true; ai.stuckT = 0; ai.sx = b.x; ai.sz = b.z; }
    let target = null;
    if (this.mode === 'bridge') {
      const team = [...this.bodies.values()].filter(q => q.team === b.team && !q.decoy && !q.minion), idx = team.indexOf(b);
      const role = team.length <= 2 ? 'all' : idx === 0 ? 'def' : 'att';
      const own = this.A.portals.find(p => p.team === b.team), foe = this.A.portals.find(p => p.team !== b.team);
      if (role === 'def') {
        target = this.nearestEnemy(b, 30, e => Math.hypot(e.x - own.x, e.z - own.z) < 15);
        if (target) this.fight(b, inp, target, dt);
        else { const s = own.z > 0 ? 1 : -1; this.steer(b, inp, own.x + Math.sin(this.t * 0.7) * 2, own.z - s * 6.5, true); if (Math.hypot(b.x - own.x, b.z - (own.z - s * 6.5)) < 1.2) { inp.mx = inp.mz = 0; inp.face = s > 0 ? Math.PI : 0; } }
      } else {
        const nearFoeGoal = Math.hypot(b.x - foe.x, b.z - foe.z) < 9;
        target = nearFoeGoal ? null : this.nearestEnemy(b, role === 'all' ? 7 : 5.5);
        const threat = this.nearestEnemy(b, 30, e => Math.hypot(e.x - own.x, e.z - own.z) < 10);
        if (role === 'all' && threat && Math.hypot(b.x - own.x, b.z - own.z) < 16) target = threat;
        if (target) this.fight(b, inp, target, dt); else this.nav(b, inp, this.pathFor(b));
      }
      this.useAbilitySmart(b, inp, target, foe, own);
    } else if (this.mode === 'koth') {
      const Z = this.A.zone;
      target = this.nearestEnemy(b, 5) || this.nearestEnemy(b, 30, e => Math.hypot(e.x - Z.x, e.z - Z.z) < Z.r + 0.5 && Math.hypot(b.x - Z.x, b.z - Z.z) < Z.r + 4);
      if (target) this.fight(b, inp, target, dt);
      else { const d = this.steer(b, inp, Z.x + Math.cos(this.t + b.id) * 1.2, Z.z + Math.sin(this.t + b.id) * 1.2, true); if (d < 0.6) inp.mx = inp.mz = 0; }
      this.useAbilitySmart(b, inp, target, null, null);
    } else if (this.mode === 'boss') {
      const boss = [...this.bodies.values()].find(q => q.boss && !q.dead);
      for (const q of this.tele) {   // get out of the red zones
        const dx = b.x - q.x, dz = b.z - q.z, d = Math.hypot(dx, dz) || 1;
        let inside = d < q.r + 1;
        if (inside && q.k === 'sector') { let a = Math.atan2(dx, dz) - q.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; inside = Math.abs(a) < q.arc / 2 + 0.2; }
        if (inside) {
          let ox = dx / d, oz = dz / d;
          if (q.k === 'sector') { const ra = q.yaw + Math.PI; ox = Math.sin(ra); oz = Math.cos(ra); }
          const k = Math.hypot(b.x, b.z); if (k > 14) { ox = -b.x / k; oz = -b.z / k; }
          inp.mx = ox; inp.mz = oz; inp.face = Math.atan2(ox, oz); if (q.k === 'sector' && b.ground && this.rand() < 0.2) inp.jump = true;
          return inp;
        }
      }
      target = this.nearestEnemy(b, 8, e => e.minion) || boss;
      if (target) this.fight(b, inp, target, dt);
      this.useAbilitySmart(b, inp, target, null, null);
    }
    this.dodgeHazards(b, inp);
    ai.wanted = inp.mx || inp.mz;
    if (target && !target.boss && this.rand() < 0.06 * b.skill && Math.hypot(target.x - b.x, target.z - b.z) < 3.4 && b.parryCd <= 0) {
      const fx = Math.sin(target.yaw), fz = Math.cos(target.yaw), dx = b.x - target.x, dz = b.z - target.z, d = Math.hypot(dx, dz) || 1;
      if ((fx * dx + fz * dz) / d > 0.6) inp.parry = true;   // they're facing me: raise the guard
    }
    if (inp.mx && b.ground && this.rand() < 0.002) inp.slide = true;
    return inp;
  },
  dodgeHazards(b, inp) {   // jump over low lasers and arms, slide under high lasers
    if (!b.ground) return;
    const t = this.t;
    for (const L of this.A.lasers) {
      const lz = laserZ(L, t), lz2 = laserZ(L, t + 0.18), d = Math.abs(b.z - lz2);
      if (Math.abs(b.x) > L.x1 + 0.6 || Math.abs(b.z - lz) > 3.5) continue;
      if (L.y < 0.9 && d < 1.2) inp.jump = true;
      else if (L.y >= 0.9 && d < 1.6) { if (b.slideCd <= 0) inp.slide = true; else inp.jump = d < 0.8 && false; }
    }
    for (const R of this.A.arms) {
      const px = b.x - R.x, pz = b.z - R.z, dist = Math.hypot(px, pz);
      if (dist > R.len + 0.8 || dist < 0.3) continue;
      let diff = Math.atan2(pz, px) - armAngle(R, t); diff = ((diff % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (R.w < 0) diff = 2 * Math.PI - diff;
      if (diff / Math.abs(R.w) < 0.34) inp.jump = true;
    }
  },
  useAbilitySmart(b, inp, target, foe, own) {
    if (b.abCd > 0 || inp.ab || b.decoy) return;
    const d = target ? Math.hypot(target.x - b.x, target.z - b.z) : 99, ab = b.ability, r = this.rand();
    const toFoe = foe ? Math.hypot(foe.x - b.x, foe.z - b.z) : 99;
    let use = false, yaw = null, pitch = 0;
    if (ab === 'dash') { if (foe && toFoe < 11 && !target && b.ground) { use = true; yaw = Math.atan2(foe.x - b.x, foe.z - b.z); } else if (target && d > 5 && d < 9 && r < 0.02) { use = true; yaw = Math.atan2(target.x - b.x, target.z - b.z); } }
    else if (ab === 'berserk') use = target && d < 5 && !target.boss ? true : !!(target && target.boss && d < 6);
    else if (ab === 'tank') use = !!(target && d < 4 && r < 0.3);
    else if (ab === 'invis') use = foe ? toFoe < 18 && toFoe > 8 : !!(target && d < 8 && r < 0.05);
    else if (ab === 'grapple') { if (target && !target.boss && d > 7 && d < 20 && r < 0.05) { use = true; yaw = Math.atan2(target.x - b.x, target.z - b.z); pitch = Math.atan2(target.y + 1.1 - (b.y + 1.4), d); } }
    else if (ab === 'slam') { const near = [...this.bodies.values()].filter(e => enemies(b, e) && !e.boss && Math.hypot(e.x - b.x, e.z - b.z) < 4.5).length; use = near >= 2 || (near === 1 && r < 0.08); }
    else if (ab === 'swap') { if (own) { const t2 = this.nearestEnemy(b, 30, e => Math.hypot(e.x - own.x, e.z - own.z) < 9); if (t2 && Math.hypot(b.x - own.x, b.z - own.z) > 16 && Math.hypot(t2.x - b.x, t2.z - b.z) < 28) { use = true; yaw = Math.atan2(t2.x - b.x, t2.z - b.z); pitch = Math.atan2(t2.y + 1.1 - (b.y + 1.3), Math.hypot(t2.x - b.x, t2.z - b.z)); } } }
    else if (ab === 'bridge') use = false;   // saved for falling
    else if (ab === 'freeze') use = !!(target && d < 5 && !target.boss);
    else if (ab === 'decoy') use = foe ? toFoe < 26 && toFoe > 12 && r < 0.03 : !!(target && r < 0.01);
    if (use) { inp.ab = true; inp.abYaw = yaw != null ? yaw : (inp.face != null ? inp.face : b.yaw); inp.pitch = pitch; }
  },
  /* ---------- THE SLAP OVERLORD ---------- */
  bossAI(b, dt, inp) {
    const ai = b.ai;
    if (ai.cool == null) { ai.cool = 3; ai.melee = 1; }
    ai.cool -= dt; ai.melee -= dt;
    const players = [...this.bodies.values()].filter(q => q.team === 0 && !q.dead && !q.decoy);
    let near = null, nd = 1e9; for (const p of players) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < nd) { nd = d; near = p; } }
    const rage = b.hp <= 50;
    if (rage && !ai.rage) { ai.rage = true; b.speed = 0.6; this.emit({ t: 'rage', id: b.id }); }
    if (ai.atk) {
      inp.face = b.yaw;
      ai.atk.t -= dt;
      if (ai.atk.t <= 0) { this.bossHit(b, ai.atk); ai.atk = ai.atk.next || null; if (ai.atk) { this.tele.push(Object.assign({ until: this.t + ai.atk.t }, ai.atk)); this.emit(Object.assign({ t: 'tele', d: ai.atk.t }, this.teleMsg(ai.atk))); } }
      return inp;
    }
    if (near) {
      if (Math.hypot(b.x, b.z) < 12 || Math.hypot(near.x, near.z) < Math.hypot(b.x, b.z)) this.steer(b, inp, near.x, near.z, true);
      inp.face = Math.atan2(near.x - b.x, near.z - b.z);
      if (nd < 6 && ai.melee <= 0) { ai.melee = rage ? 0.9 : 1.3; inp.slap = true; inp.pitch = 0.25; }
      if (nd < 3.5) { inp.mx = inp.mz = 0; }
    }
    b.speed = rage ? 0.6 : 0.45;
    if (ai.cool <= 0 && players.length) {
      ai.cool = rage ? 1.8 : 2.8;
      const minions = [...this.bodies.values()].filter(q => q.minion).length, r = this.rand();
      const pick = () => players[Math.floor(this.rand() * players.length)];
      if (r < 0.2 && minions < 3) {
        for (let i = 0; i < 3; i++) {
          const a = this.rand() * Math.PI * 2, m = this.addBody({ id: this.nid++, name: 'Minion', team: 1, minion: true, color: 0, skill: 0.6, scale: 0.75, ability: 'dash' });
          m.x = b.x + Math.cos(a) * 4; m.z = b.z + Math.sin(a) * 4; m.y = 0.1; m.ground = false;
          this.emit({ t: 'tp', id: m.id, p: [r2(m.x), r2(m.y), r2(m.z), 0] });
        }
        this.emit({ t: 'summon', id: b.id, x: r2(b.x), z: r2(b.z) });
      } else if (r < 0.6) {
        const tg = pick(), atk = { k: 'circle', x: tg.x, z: tg.z, r: 6, t: rage ? 0.85 : 1.15 };
        if (rage && players.length > 1) { const t2 = pick(); atk.next = { k: 'circle', x: t2.x, z: t2.z, r: 6, t: 0.75 }; }
        ai.atk = atk;
      } else {
        const tg = near || pick(); b.yaw = Math.atan2(tg.x - b.x, tg.z - b.z);
        ai.atk = { k: 'sector', x: b.x, z: b.z, yaw: b.yaw, r: 12.5, arc: rage ? 3.4 : 2.6, t: rage ? 0.75 : 0.95 };
      }
      if (ai.atk) { this.tele.push(Object.assign({ until: this.t + ai.atk.t }, ai.atk)); this.emit(Object.assign({ t: 'tele', d: ai.atk.t }, this.teleMsg(ai.atk))); }
    }
    return inp;
  },
  teleMsg(q) { return { k: q.k, x: r2(q.x), z: r2(q.z), r: q.r, yaw: r2(q.yaw || 0), arc: q.arc || 0 }; },
  bossHit(b, q) {
    if (q.k === 'circle') this.emit({ t: 'bslam', id: b.id, x: r2(q.x), z: r2(q.z), r: q.r });
    else this.emit({ t: 'bsweep', id: b.id, yaw: r2(q.yaw), arc: q.arc, r: q.r });
    for (const e of this.bodies.values()) {
      if (e.team !== 0 || e.dead) continue;
      const dx = e.x - q.x, dz = e.z - q.z, d = Math.hypot(dx, dz) || 1;
      if (d > q.r || e.y > 3.5) continue;
      if (e.decoy) { this.kill(e); continue; }
      const tank = e.buffs.tank > this.t ? 0.25 : 1, mega = this.mut.mega ? 1.6 : 1;
      if (q.k === 'circle') { const k = (1.1 - d / q.r * 0.4) * tank * mega; this.impulse(e, dx / d * 19 * k, 13 * Math.max(0.6, k), dz / d * 19 * k, 0.5); }
      else {
        let a = Math.atan2(dx, dz) - q.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
        if (Math.abs(a) > q.arc / 2) continue;
        const s = a >= 0 ? 1 : -1, tx = Math.cos(q.yaw) * s, tz = -Math.sin(q.yaw) * s;
        this.impulse(e, (dx / d * 0.6 + tx * 0.8) * 24 * tank * mega, 10, (dz / d * 0.6 + tz * 0.8) * 24 * tank * mega, 0.5);
      }
      e.lastHit = { by: b.id, t: this.t };
    }
  },
});

return { C, TEAM_NAMES, ABILITIES, AB, MUTATORS, ARENAS, EXTRA, makeArena, World, stepBody, hazards, knock, laserZ, armAngle, Match, NOIN, enemies, covers };
});
