// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-allocation Verlet rope integrator for physical 3D cables in WebXR.
 *
 * Uses flat `Float32Array` position buffers (struct-of-arrays style) so a 25-node
 * braided cable simulates gravity drape, hand-whip momentum, and port strain-relief
 * tangents at 90 Hz without triggering garbage collection.
 */
export interface VerletCableOptions {
  /** Downward gravity acceleration in stage-local m/s² (default -2.6). */
  gravity?: number | undefined;
  /** Per-step velocity retention ∈ (0, 1] (default 0.94). */
  damping?: number | undefined;
  /** Target cable length multiplier over straight-line chord when slack (default 1.12). */
  slackFactor?: number | undefined;
  /** Minimum cable length in meters (default 0.08). */
  minLength?: number | undefined;
  /** Constraint solver iterations per step (default 6). */
  iterations?: number | undefined;
  /** Strain-relief stiffness along exit port normals ∈ [0, 1] (default 0.55). */
  normalStiffness?: number | undefined;
}

export class VerletCableSim {
  readonly nodeCount: number;
  readonly positions: Float32Array;
  private readonly prevPositions: Float32Array;
  private initialized = false;
  private currentLength = 0.2;

  constructor(nodeCount = 25) {
    this.nodeCount = Math.max(4, Math.floor(nodeCount));
    this.positions = new Float32Array(this.nodeCount * 3);
    this.prevPositions = new Float32Array(this.nodeCount * 3);
  }

  /** Marks the cable uninitialized so the next `step` seeds cleanly from the new endpoints. */
  invalidate(): void {
    this.initialized = false;
  }

  /** Seeds all nodes smoothly along a gently draped curve between `start` and `end`. */
  reset(
    start: readonly [number, number, number],
    startNormal: readonly [number, number, number],
    end: readonly [number, number, number],
  ): void {
    const n = this.nodeCount;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const chord = Math.hypot(dx, dy, dz);
    this.currentLength = Math.max(0.08, chord * 1.12);
    const sag = Math.min(0.06, chord * 0.08);
    const exitLen = Math.min(0.04, chord * 0.18);

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const u = 1 - t;
      const arch = 4 * t * u; // peaks at midpoint
      const exitWeight = u * u * t * 3;
      const x = start[0] + dx * t + startNormal[0] * exitLen * exitWeight;
      const y = start[1] + dy * t + startNormal[1] * exitLen * exitWeight - sag * arch;
      const z = start[2] + dz * t + startNormal[2] * exitLen * exitWeight;
      const idx = i * 3;
      this.positions[idx] = x;
      this.positions[idx + 1] = y;
      this.positions[idx + 2] = z;
      this.prevPositions[idx] = x;
      this.prevPositions[idx + 1] = y;
      this.prevPositions[idx + 2] = z;
    }
    this.initialized = true;
  }

  /**
   * Advances the rope by `deltaSec` with both endpoints pinned to `start` (port socket)
   * and `end` (live plug tip in hand or snapped target port).
   */
  step(
    start: readonly [number, number, number],
    startNormal: readonly [number, number, number],
    end: readonly [number, number, number],
    endNormal: readonly [number, number, number] | null,
    deltaSec: number,
    options?: VerletCableOptions,
  ): Float32Array {
    if (!this.initialized) {
      this.reset(start, startNormal, end);
    }

    const dt = Math.max(1e-4, Math.min(deltaSec, 1 / 30));
    const dt2 = dt * dt;
    const gravity = options?.gravity ?? -2.6;
    const damping = options?.damping ?? 0.94;
    const slackFactor = options?.slackFactor ?? 1.12;
    const minLength = options?.minLength ?? 0.08;
    const iterations = options?.iterations ?? 6;
    const normalStiffness = options?.normalStiffness ?? 0.55;

    const n = this.nodeCount;
    const pos = this.positions;
    const prev = this.prevPositions;

    // Detect huge teleport/endpoint jump (e.g., first frame after switching ports) and re-seed cleanly
    const lastIdx = (n - 1) * 3;
    const jumpSq =
      (end[0] - pos[lastIdx]!) ** 2 + (end[1] - pos[lastIdx + 1]!) ** 2 + (end[2] - pos[lastIdx + 2]!) ** 2;
    if (jumpSq > 1.5 * 1.5) {
      this.reset(start, startNormal, end);
    }

    const chord = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    // Smoothly pay out or reel in slack as the hand moves closer/farther from the socket
    const desiredSlack = endNormal ? 1.05 : slackFactor;
    const targetLen = Math.max(minLength, chord * desiredSlack);
    const lenRate = 1 - Math.exp(-dt * 12);
    this.currentLength += (targetLen - this.currentLength) * lenRate;
    // Never allow cable rest length to become shorter than chord (prevents unnatural over-stretching)
    if (this.currentLength < chord * 1.01) {
      this.currentLength = chord * 1.01;
    }
    const segLen = this.currentLength / (n - 1);

    // 1. Verlet integration for interior nodes
    const gravStep = gravity * dt2;
    for (let i = 1; i < n - 1; i++) {
      const idx = i * 3;
      const x = pos[idx]!;
      const y = pos[idx + 1]!;
      const z = pos[idx + 2]!;
      const vx = (x - prev[idx]!) * damping;
      const vy = (y - prev[idx + 1]!) * damping;
      const vz = (z - prev[idx + 2]!) * damping;
      prev[idx] = x;
      prev[idx + 1] = y;
      prev[idx + 2] = z;
      pos[idx] = x + vx;
      pos[idx + 1] = y + vy + gravStep;
      pos[idx + 2] = z + vz;
    }

    // Normalize exit tangents for strain-relief boot alignment
    const snLen = Math.hypot(startNormal[0], startNormal[1], startNormal[2]);
    const snx = snLen > 1e-5 ? startNormal[0] / snLen : 1;
    const sny = snLen > 1e-5 ? startNormal[1] / snLen : 0;
    const snz = snLen > 1e-5 ? startNormal[2] / snLen : 0;

    let enx = 0;
    let eny = 0;
    let enz = 0;
    let hasEndNorm = false;
    if (endNormal) {
      const enLen = Math.hypot(endNormal[0], endNormal[1], endNormal[2]);
      if (enLen > 1e-5) {
        enx = endNormal[0] / enLen;
        eny = endNormal[1] / enLen;
        enz = endNormal[2] / enLen;
        hasEndNorm = true;
      }
    }

    // 2. Constraint relaxation (pin endpoints + strain-relief exit alignment + segment lengths)
    for (let iter = 0; iter < iterations; iter++) {
      // Pin start & end
      pos[0] = start[0];
      pos[1] = start[1];
      pos[2] = start[2];
      pos[lastIdx] = end[0];
      pos[lastIdx + 1] = end[1];
      pos[lastIdx + 2] = end[2];

      // Strain-relief bias on node 1 (exits socket cleanly along port normal)
      if (normalStiffness > 0) {
        const k = normalStiffness * 0.4;
        const tx = start[0] + snx * segLen;
        const ty = start[1] + sny * segLen;
        const tz = start[2] + snz * segLen;
        pos[3] = pos[3]! + (tx - pos[3]!) * k;
        pos[4] = pos[4]! + (ty - pos[4]!) * k;
        pos[5] = pos[5]! + (tz - pos[5]!) * k;

        if (hasEndNorm) {
          const p2 = (n - 2) * 3;
          const ex = end[0] + enx * segLen;
          const ey = end[1] + eny * segLen;
          const ez = end[2] + enz * segLen;
          pos[p2] = pos[p2]! + (ex - pos[p2]!) * k;
          pos[p2 + 1] = pos[p2 + 1]! + (ey - pos[p2 + 1]!) * k;
          pos[p2 + 2] = pos[p2 + 2]! + (ez - pos[p2 + 2]!) * k;
        }
      }

      // Distance constraints along all segments
      for (let i = 0; i < n - 1; i++) {
        const i0 = i * 3;
        const i1 = (i + 1) * 3;
        const dx = pos[i1]! - pos[i0]!;
        const dy = pos[i1 + 1]! - pos[i0 + 1]!;
        const dz = pos[i1 + 2]! - pos[i0 + 2]!;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-6) continue;
        const diff = (dist - segLen) / dist;
        const pin0 = i === 0;
        const pin1 = i + 1 === n - 1;
        if (!pin0 && !pin1) {
          const half = diff * 0.5;
          pos[i0] = pos[i0]! + dx * half;
          pos[i0 + 1] = pos[i0 + 1]! + dy * half;
          pos[i0 + 2] = pos[i0 + 2]! + dz * half;
          pos[i1] = pos[i1]! - dx * half;
          pos[i1 + 1] = pos[i1 + 1]! - dy * half;
          pos[i1 + 2] = pos[i1 + 2]! - dz * half;
        } else if (pin0 && !pin1) {
          pos[i1] = pos[i1]! - dx * diff;
          pos[i1 + 1] = pos[i1 + 1]! - dy * diff;
          pos[i1 + 2] = pos[i1 + 2]! - dz * diff;
        } else if (!pin0 && pin1) {
          pos[i0] = pos[i0]! + dx * diff;
          pos[i0 + 1] = pos[i0 + 1]! + dy * diff;
          pos[i0 + 2] = pos[i0 + 2]! + dz * diff;
        }
      }
    }

    // Ensure prev endpoints match pinned endpoints
    prev[0] = start[0];
    prev[1] = start[1];
    prev[2] = start[2];
    prev[lastIdx] = end[0];
    prev[lastIdx + 1] = end[1];
    prev[lastIdx + 2] = end[2];

    return pos;
  }

  /** Computes the normalized incoming tangent at the cable tip (`node[N-2] → node[N-1]`). */
  getTipTangent(out: [number, number, number]): [number, number, number] {
    const a = (this.nodeCount - 2) * 3;
    const b = (this.nodeCount - 1) * 3;
    const dx = this.positions[b]! - this.positions[a]!;
    const dy = this.positions[b + 1]! - this.positions[a + 1]!;
    const dz = this.positions[b + 2]! - this.positions[a + 2]!;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      out[0] = dx / len;
      out[1] = dy / len;
      out[2] = dz / len;
    } else {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
    }
    return out;
  }
}
