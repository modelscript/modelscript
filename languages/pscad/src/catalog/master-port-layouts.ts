// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PortKind } from "../types.js";

/**
 * Additional Master Library port layouts (names, kinds and nominal offsets at orientation 0).
 *
 * Offsets are nominal: the semantic model snaps ports to the positions where wires really end
 * (`refineModulePorts`), so what matters most here is that each type exposes the right number of
 * named ports with the right kind (signal vs electrical) for netlisting and linting.
 */
export interface MasterPortLayout {
  name: string;
  kind: PortKind;
  dim: number;
  x: number;
  y: number;
}

const sig = (name: string, x: number, y: number, dim = 1): MasterPortLayout => ({ name, kind: "signal", dim, x, y });

const IN = sig("in", -36, 0);
const OUT = sig("out", 36, 0);
const SISO: MasterPortLayout[] = [IN, OUT];
const SRC: MasterPortLayout[] = [OUT];

export const EXTRA_MASTER_PORT_LAYOUTS: Record<string, MasterPortLayout[]> = {
  // Signal sources
  emtconst: SRC,
  consti: SRC,
  unity: SISO,
  "time-sig": SRC,
  sig_gen: [sig("in", -36, 0), OUT],
  upramp: SISO,
  trig: SRC,
  bin_delay: [sig("in", 0, 0), OUT],
  fp_int: [sig("in", 0, 72), OUT],

  // Single-in/single-out functions
  inv: SISO,
  square: SISO,
  trans_filt: [IN, OUT],
  hardlimit: SISO,
  ratelimit: SISO,
  integral: SISO,
  range: SISO,
  xy_transfer_function: SISO,
  x_power_y: SISO,
  angle_resolver: SISO,
  maxmin: SISO,
  // Single input: wire ends in the DC-EMT corpus appear only at (-36,0) and (36,0); X is a parameter.
  compare: SISO,
  rms3ph: [sig("in", -36, 0, 3), OUT],

  // Multi-input arithmetic
  mult: [sig("A", -36, 0), sig("B", 0, 36), OUT],
  div: [sig("A", -36, 0), sig("B", 0, 36), OUT],
  sumjct: [sig("in1", -36, 0), sig("in2", 0, -36), sig("in3", 0, 36), OUT],
  logic_mult: [sig("A", -36, -18), sig("B", -36, 18), OUT],
  select: [sig("in1", -36, -36), sig("in2", -36, 0), sig("sel", -36, 36), OUT],

  // Data plumbing
  import: [OUT],
  export: [IN],
  datatap: [sig("in", 0, 0), sig("tap", 0, -18)],
  datamerge: [sig("out", 0, 0)],
  breakout: [sig("in", 0, 0)],
  nodeloop: [sig("loop", 0, -36)],
  radiolink: [sig("link", 0, 0)],
  abcdq0: [sig("abc", -36, 0, 3), sig("dq0", 36, 0, 3)],
  current_scaler: [
    { name: "in", kind: "electrical", dim: 3, x: -36, y: -18 },
    { name: "out", kind: "electrical", dim: 3, x: 36, y: -18 },
  ],

  // Electrical items observed in practice
  voltmetergnd: [{ name: "N", kind: "electrical", dim: 3, x: 0, y: 18 }],
  peswitch: [
    { name: "N1", kind: "electrical", dim: 1, x: 0, y: 0 },
    { name: "N2", kind: "electrical", dim: 1, x: 0, y: -36 },
  ],
  // Terminal offsets below are derived from wire-end statistics of real PSCAD 5 projects, not from vendor docs.
  varrlc: [
    { name: "N1", kind: "electrical", dim: 1, x: 0, y: 0 },
    { name: "N2", kind: "electrical", dim: 1, x: 36, y: 0 },
  ],
  src_ccin_1: [{ name: "N", kind: "electrical", dim: 1, x: 0, y: 0 }],
  battery: [{ name: "N", kind: "electrical", dim: 1, x: 0, y: 0 }],
  wound_rotor: [
    { name: "stator", kind: "electrical", dim: 3, x: 54, y: 0 },
    { name: "rotor", kind: "electrical", dim: 3, x: -54, y: 36 },
  ],
  source_3: [{ name: "N", kind: "electrical", dim: 3, x: 36, y: 0 }],
  breaker1: [
    { name: "N1", kind: "electrical", dim: 1, x: -36, y: 0 },
    { name: "N2", kind: "electrical", dim: 1, x: 36, y: 0 },
  ],
  // Corpus wires end only at (-36,0), where a data label picks up the breaker status: a signal output.
  tbreakn: [sig("out", -36, 0)],
};
