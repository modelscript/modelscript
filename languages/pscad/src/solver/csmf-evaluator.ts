// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EmtControlBlock } from "../types.js";

/**
 * Lightweight step-by-step CSMF control-block evaluator supporting algebraic,
 * dynamic (`pi`, `integral`), and delay (`tdelay` ring buffer, `zminusone`) blocks.
 */
export class CsmfControlEvaluator {
  private readonly blocks: EmtControlBlock[];
  private readonly values = new Map<string, number>();
  private readonly prevValues = new Map<string, number>();
  private readonly integrators = new Map<string, number>();
  private readonly delayBuffers = new Map<string, { buf: Float64Array; idx: number }>();

  constructor(blocks: EmtControlBlock[]) {
    this.blocks = blocks;
    for (const b of blocks) {
      this.values.set(b.id, 0);
      this.prevValues.set(b.id, 0);
    }
  }

  setSignal(id: string, value: number): void {
    this.values.set(id, value);
  }

  step(dtSec: number): ReadonlyMap<string, number> {
    const safeDt = dtSec > 1e-9 ? dtSec : 50e-6;
    for (const b of this.blocks) {
      this.prevValues.set(b.id, this.values.get(b.id) ?? 0);
    }

    for (const b of this.blocks) {
      const p = b.params;
      const u0 = b.inputs[0] ? (this.values.get(b.inputs[0]) ?? 0) : 0;
      const u1 = b.inputs[1] ? (this.values.get(b.inputs[1]) ?? 0) : 0;
      let out = 0;

      switch (b.kind) {
        case "sensor_v":
        case "sensor_i":
          out = this.values.get(b.id) ?? 0;
          break;
        case "const":
          out = p["value"] ?? p["Value"] ?? p["K"] ?? p["k"] ?? 0;
          break;
        case "gain":
          out = (p["K"] ?? p["k"] ?? p["G"] ?? 1) * u0;
          break;
        case "sum":
          out = b.inputs.reduce((acc, inp, k) => {
            const sign = k < 3 ? (p[`s${k + 1}`] ?? 1) : 1;
            return acc + sign * (this.values.get(inp) ?? 0);
          }, 0);
          break;
        case "mult":
          out = u0 * u1;
          break;
        case "div":
          out = Math.abs(u1) > 1e-12 ? u0 / u1 : 0;
          break;
        case "abs":
          out = Math.abs(u0);
          break;
        case "zminusone":
          out = b.inputs[0] ? (this.prevValues.get(b.inputs[0]) ?? 0) : 0;
          break;
        case "tdelay": {
          const delaySec = Math.max(0, p["T"] ?? p["Delay"] ?? p["Td"] ?? 0);
          const steps = Math.max(1, Math.round(delaySec / safeDt));
          let ring = this.delayBuffers.get(b.id);
          if (!ring || ring.buf.length !== steps) {
            ring = { buf: new Float64Array(steps), idx: 0 };
            this.delayBuffers.set(b.id, ring);
          }
          out = ring.buf[ring.idx]!;
          ring.buf[ring.idx] = u0;
          ring.idx = (ring.idx + 1) % steps;
          break;
        }
        case "limit": {
          const lo = p["min"] ?? p["LL"] ?? p["Min"] ?? -Infinity;
          const hi = p["max"] ?? p["UL"] ?? p["Max"] ?? Infinity;
          out = Math.max(lo, Math.min(hi, u0));
          break;
        }
        case "integral": {
          const ti = p["T"] ?? p["Ti"] ?? 1;
          const next = (this.integrators.get(b.id) ?? 0) + (ti !== 0 ? (u0 / ti) * safeDt : 0);
          this.integrators.set(b.id, next);
          out = next;
          break;
        }
        case "pi": {
          const kp = p["Kp"] ?? p["G"] ?? 1;
          const ti = p["Ti"] ?? p["T"] ?? 0.1;
          const ki = p["Ki"] ?? (ti > 0 ? kp / ti : 0);
          const nextI = (this.integrators.get(b.id) ?? 0) + ki * u0 * safeDt;
          this.integrators.set(b.id, nextI);
          out = kp * u0 + nextI;
          break;
        }
        default:
          out = u0;
          break;
      }

      this.values.set(b.id, out);
    }

    return this.values;
  }
}
