// SPDX-License-Identifier: GPL-3.0-or-later
// Lineage: the ISAAC algorithm is Bob Jenkins' work, released to the public
// domain (https://burtleburtle.net/bob/rand/isaacafa.html). This TypeScript
// implementation is part of pyr3 and distributed under GPL-3.0-or-later.
//
// ISAAC RNG — Bob Jenkins' indirection-shift-accumulate-add-count generator,
// matching flam3's `RANDSIZL = 4` configuration (`isaac.c` + `isaac.h`).
// State per stream: 4 scalars (randa, randb, randc, randcnt) + randmem[16]
// + randrsl[16]. Total 36 × u32 = 144 bytes per stream.
//
// Used host-side to initialize per-walker ISAAC state for the chaos-game GPU
// dispatch. Each walker has its own independent ISAAC stream — replaces the
// previous PCG32 per-walker streams which had inferior multi-step distribution
// for chaos-game IFS sampling, producing visibly diffuse walker concentration
// vs flam3's tighter attractor visiting pattern (flam3 also uses ISAAC).

export const RANDSIZL = 4;
export const RANDSIZ = 1 << RANDSIZL; // 16
export const ISAAC_STATE_U32 = 4 + RANDSIZ + RANDSIZ; // 36

export interface IsaacState {
  randcnt: number;       // u32 — index into randrsl
  randa: number;         // u32
  randb: number;         // u32
  randc: number;         // u32
  randmem: Uint32Array;  // length RANDSIZ
  randrsl: Uint32Array;  // length RANDSIZ — output buffer (read by irand)
}

// All ops are u32 with wrap. Use `>>> 0` to cast back to u32.
function u32(x: number): number { return x >>> 0; }

// Run one ISAAC round — fills randrsl[0..RANDSIZ-1] with new outputs.
// Direct port of `isaac()` from `flam3-ref/isaac.c:25`.
export function isaacRound(s: IsaacState): void {
  let a = s.randa;
  // randb + ++randc
  const newc = u32(s.randc + 1);
  s.randc = newc;
  let b = u32(s.randb + newc);
  const mm = s.randmem;
  const r = s.randrsl;
  let x: number, y: number;

  // Two halves: 0..7 reads m2 from m+8..m+15, then 8..15 reads m2 from m..m+7.
  for (let half = 0; half < 2; half++) {
    const mStart = half * 8;
    const m2Start = half === 0 ? 8 : 0;
    for (let k = 0; k < 8; k += 4) {
      // 4 sub-steps with 4 different mix functions on `a`.
      // rngstep(mix, a, b, mm, m, m2, r, x):
      //   x = *m
      //   a = (a ^ mix) + *m2++
      //   *m++ = y = mm[(x>>2) & (RANDSIZ-1)] + a + b
      //   *r++ = b = mm[(y>>RANDSIZL) & (RANDSIZ-1)] + x

      // mix1: a << 13
      x = mm[mStart + k]!;
      a = u32((a ^ u32(a << 13)) + mm[m2Start + k]!);
      y = u32(mm[(x >>> 2) & (RANDSIZ - 1)]! + a + b);
      mm[mStart + k] = y;
      // `ind(mm, y >> RANDSIZL)` expands to `mm[((y >> RANDSIZL) >> 2) & (RANDSIZ-1)]`
      // = mm[(y >> 6) & 15] for RANDSIZL=4. Caught 2026-05-10 by the
      // ISAAC golden-output harness — was previously `(y >>> RANDSIZL) & (RANDSIZ-1)`.
      b = u32(mm[(y >>> (RANDSIZL + 2)) & (RANDSIZ - 1)]! + x);
      r[mStart + k] = b;

      // mix2: a >> 6
      x = mm[mStart + k + 1]!;
      a = u32((a ^ (a >>> 6)) + mm[m2Start + k + 1]!);
      y = u32(mm[(x >>> 2) & (RANDSIZ - 1)]! + a + b);
      mm[mStart + k + 1] = y;
      // `ind(mm, y >> RANDSIZL)` expands to `mm[((y >> RANDSIZL) >> 2) & (RANDSIZ-1)]`
      // = mm[(y >> 6) & 15] for RANDSIZL=4. Caught 2026-05-10 by the
      // ISAAC golden-output harness — was previously `(y >>> RANDSIZL) & (RANDSIZ-1)`.
      b = u32(mm[(y >>> (RANDSIZL + 2)) & (RANDSIZ - 1)]! + x);
      r[mStart + k + 1] = b;

      // mix3: a << 2
      x = mm[mStart + k + 2]!;
      a = u32((a ^ u32(a << 2)) + mm[m2Start + k + 2]!);
      y = u32(mm[(x >>> 2) & (RANDSIZ - 1)]! + a + b);
      mm[mStart + k + 2] = y;
      // `ind(mm, y >> RANDSIZL)` expands to `mm[((y >> RANDSIZL) >> 2) & (RANDSIZ-1)]`
      // = mm[(y >> 6) & 15] for RANDSIZL=4. Caught 2026-05-10 by the
      // ISAAC golden-output harness — was previously `(y >>> RANDSIZL) & (RANDSIZ-1)`.
      b = u32(mm[(y >>> (RANDSIZL + 2)) & (RANDSIZ - 1)]! + x);
      r[mStart + k + 2] = b;

      // mix4: a >> 16
      x = mm[mStart + k + 3]!;
      a = u32((a ^ (a >>> 16)) + mm[m2Start + k + 3]!);
      y = u32(mm[(x >>> 2) & (RANDSIZ - 1)]! + a + b);
      mm[mStart + k + 3] = y;
      // `ind(mm, y >> RANDSIZL)` expands to `mm[((y >> RANDSIZL) >> 2) & (RANDSIZ-1)]`
      // = mm[(y >> 6) & 15] for RANDSIZL=4. Caught 2026-05-10 by the
      // ISAAC golden-output harness — was previously `(y >>> RANDSIZL) & (RANDSIZ-1)`.
      b = u32(mm[(y >>> (RANDSIZL + 2)) & (RANDSIZ - 1)]! + x);
      r[mStart + k + 3] = b;
    }
  }

  s.randa = a;
  s.randb = b;
}

// Direct port of the `mix(a..h)` macro from `isaac.c:48-58`.
function isaacMix(v: Uint32Array): void {
  let a = v[0]!, b = v[1]!, c = v[2]!, d = v[3]!, e = v[4]!, f = v[5]!, g = v[6]!, h = v[7]!;
  a = u32(a ^ u32(b << 11)); d = u32(d + a); b = u32(b + c);
  b = u32(b ^ (c >>> 2));    e = u32(e + b); c = u32(c + d);
  c = u32(c ^ u32(d << 8));  f = u32(f + c); d = u32(d + e);
  d = u32(d ^ (e >>> 16));   g = u32(g + d); e = u32(e + f);
  e = u32(e ^ u32(f << 10)); h = u32(h + e); f = u32(f + g);
  f = u32(f ^ (g >>> 4));    a = u32(a + f); g = u32(g + h);
  g = u32(g ^ u32(h << 8));  b = u32(b + g); h = u32(h + a);
  h = u32(h ^ (a >>> 9));    c = u32(c + h); a = u32(a + b);
  v[0] = a; v[1] = b; v[2] = c; v[3] = d; v[4] = e; v[5] = f; v[6] = g; v[7] = h;
}

// Initialize ISAAC state. If `seedFromRandrsl`, mix in s.randrsl[] as seed
// (flag=1 path); otherwise use just the golden-ratio init (flag=0 path).
// Direct port of `irandinit()` from `isaac.c:61`.
export function irandinit(s: IsaacState, seedFromRandrsl: boolean): void {
  s.randa = 0; s.randb = 0; s.randc = 0;
  const v = new Uint32Array(8);
  v.fill(0x9e3779b9); // golden ratio

  // Scramble the 8 vars.
  for (let i = 0; i < 4; i++) isaacMix(v);

  // Pass 1: mix randrsl into v, write into randmem.
  if (seedFromRandrsl) {
    for (let i = 0; i < RANDSIZ; i += 8) {
      for (let j = 0; j < 8; j++) v[j] = u32(v[j]! + s.randrsl[i + j]!);
      isaacMix(v);
      for (let j = 0; j < 8; j++) s.randmem[i + j] = v[j]!;
    }
    // Pass 2: mix randmem back into v + randmem to make all of seed affect all of m.
    for (let i = 0; i < RANDSIZ; i += 8) {
      for (let j = 0; j < 8; j++) v[j] = u32(v[j]! + s.randmem[i + j]!);
      isaacMix(v);
      for (let j = 0; j < 8; j++) s.randmem[i + j] = v[j]!;
    }
  } else {
    for (let i = 0; i < RANDSIZ; i += 8) {
      isaacMix(v);
      for (let j = 0; j < 8; j++) s.randmem[i + j] = v[j]!;
    }
  }

  isaacRound(s);
  s.randcnt = RANDSIZ;
}

// Allocate a fresh state with random fields zeroed.
export function newIsaacState(): IsaacState {
  return {
    randcnt: 0,
    randa: 0,
    randb: 0,
    randc: 0,
    randmem: new Uint32Array(RANDSIZ),
    randrsl: new Uint32Array(RANDSIZ),
  };
}

// Get next u32 from ISAAC stream. Direct port of `irand` macro:
//   !r->randcnt-- ? (isaac(r), r->randcnt = RANDSIZ-1, r->randrsl[r->randcnt])
//                 : r->randrsl[r->randcnt]
export function isaacIrand(s: IsaacState): number {
  if (s.randcnt === 0) {
    isaacRound(s);
    s.randcnt = RANDSIZ - 1;
  } else {
    s.randcnt = s.randcnt - 1;
  }
  return s.randrsl[s.randcnt]!;
}

// Pack `count` per-walker ISAAC states into a flat u32 buffer for GPU upload.
// Layout per state (4 scalar fields + randmem[16] + randrsl[16] = 36 u32 each):
//   [0]    randcnt
//   [1]    randa
//   [2]    randb
//   [3]    randc
//   [4..19]  randmem
//   [20..35] randrsl
//
// Initialization: each walker's randrsl[] is filled with 16 u32 from a small
// PRNG seeded by `(globalSeed ^ walker_id_hash)`. Then `irandinit(state, true)`
// scrambles randmem from randrsl. Equivalent to flam3 rect.c:863-865 where
// randrsl is filled from the global RNG and irandinit then mixes it into mm.
export function packIsaacStates(walkerCount: number, globalSeed: number): ArrayBuffer {
  const ab = new ArrayBuffer(walkerCount * ISAAC_STATE_U32 * 4);
  const buf = new Uint32Array(ab);
  const state = newIsaacState();

  for (let w = 0; w < walkerCount; w++) {
    // Generate 16 seed values per walker using a lightweight PCG32 stream.
    // The PCG step is plain (one stream initialized from globalSeed XOR walker hash).
    let pcg = u32(globalSeed ^ u32(w * 2654435761 + 1));
    for (let k = 0; k < 4; k++) {
      pcg = u32(Math.imul(pcg, 747796405) + 2891336453);
    }
    for (let i = 0; i < RANDSIZ; i++) {
      // PCG32 oneseq XSH-RS — matching the chaos.wgsl PCG impl byte-for-byte.
      const s = pcg;
      pcg = u32(Math.imul(pcg, 747796405) + 2891336453);
      const shift = u32((s >>> 28) + 4);
      const word = u32(Math.imul(u32((s >>> shift) ^ s), 277803737));
      state.randrsl[i] = u32((word >>> 22) ^ word);
    }
    irandinit(state, true);

    // Pack into output buffer.
    const off = w * ISAAC_STATE_U32;
    buf[off + 0] = state.randcnt;
    buf[off + 1] = state.randa;
    buf[off + 2] = state.randb;
    buf[off + 3] = state.randc;
    for (let i = 0; i < RANDSIZ; i++) {
      buf[off + 4 + i] = state.randmem[i]!;
      buf[off + 4 + RANDSIZ + i] = state.randrsl[i]!;
    }
  }

  return ab;
}
