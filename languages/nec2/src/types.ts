// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for LLNL NEC-2 (Numerical Electromagnetics Code) wire antenna decks,
 * Method-of-Moments (MoM) solver results, and equivalent circuit parameters.
 */

export interface Nec2SourceSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface Nec2CardRecord extends Nec2SourceSpan {
  mnemonic: string;
  raw: string;
}

export interface Nec2Wire extends Nec2SourceSpan {
  tag: number;
  segments: number;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  radius: number;
}

export interface Nec2Arc extends Nec2SourceSpan {
  tag: number;
  segments: number;
  arcRadius: number;
  angle1Deg: number;
  angle2Deg: number;
  wireRadius: number;
}

export interface Nec2Helix extends Nec2SourceSpan {
  tag: number;
  segments: number;
  spacing: number;
  length: number;
  rx1: number;
  ry1: number;
  rx2: number;
  ry2: number;
  wireRadius: number;
}

export interface Nec2Transform extends Nec2SourceSpan {
  tagIncrement: number;
  newStructures: number;
  roXDeg: number;
  roYDeg: number;
  roZDeg: number;
  dx: number;
  dy: number;
  dz: number;
  startTag: number;
}

export interface Nec2Symmetry extends Nec2SourceSpan {
  tagIncrement: number;
  copies: number;
}

export interface Nec2Scale extends Nec2SourceSpan {
  factor: number;
}

export interface Nec2Patch extends Nec2SourceSpan {
  kind: "SP" | "SM";
  ns: number;
  nx?: number | undefined;
  ny?: number | undefined;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

export interface Nec2GeometryEnd extends Nec2SourceSpan {
  /** 0 = free space, 1 = ground plane with current expansion, -1 = ground plane without expansion */
  gpflag: number;
}

export interface Nec2Frequency extends Nec2SourceSpan {
  /** 0 = linear step, 1 = multiplicative step */
  ifrq: number;
  nfrq: number;
  fmhz: number;
  delFreq: number;
}

export interface Nec2Excitation extends Nec2SourceSpan {
  /** 0 = voltage source, 1 = incident plane wave, 4 = current source, 5 = voltage source (current-slope-discontinuity) */
  type: number;
  tag: number;
  segment: number;
  admit: number;
  vReal: number;
  vImag: number;
}

export interface Nec2Load extends Nec2SourceSpan {
  /** 0 = series RLC, 1 = parallel RLC, 2 = series RLC/m, 3 = parallel RLC/m, 4 = fixed impedance (R+jX), 5 = wire conductivity */
  ldtyp: number;
  tag: number;
  segStart: number;
  segEnd: number;
  z1: number;
  z2: number;
  z3: number;
}

export interface Nec2Ground extends Nec2SourceSpan {
  /** -1 = free space, 0 = finite ground (reflection coeff), 1 = PEC ground, 2 = Sommerfeld/Norton finite ground */
  iperf: number;
  nradl: number;
  epsr: number;
  sigma: number;
}

export interface Nec2Network extends Nec2SourceSpan {
  tag1: number;
  seg1: number;
  tag2: number;
  seg2: number;
  y11Re: number;
  y11Im: number;
  y12Re: number;
  y12Im: number;
  y22Re: number;
  y22Im: number;
}

export interface Nec2TransmissionLine extends Nec2SourceSpan {
  tag1: number;
  seg1: number;
  tag2: number;
  seg2: number;
  z0: number;
  length: number;
  y1Re: number;
  y1Im: number;
  y2Re: number;
  y2Im: number;
}

export interface Nec2RadiationPattern extends Nec2SourceSpan {
  mode: number;
  nth: number;
  nph: number;
  xn: number;
  theta0Deg: number;
  phi0Deg: number;
  dThetaDeg: number;
  dPhiDeg: number;
}

export interface Nec2Execute extends Nec2SourceSpan {
  option: number;
}

export interface Nec2SymbolDef extends Nec2SourceSpan {
  name: string;
  expression: string;
  value: number;
}

export interface Nec2ParseError extends Nec2SourceSpan {
  message: string;
  raw: string;
}

export interface Nec2Deck {
  title: string;
  comments: string[];
  hasCommentEnd: boolean;
  hasGeometryEnd: boolean;
  hasEnd: boolean;
  symbolDefs: Nec2SymbolDef[];
  symbols: Map<string, number>;
  wires: Nec2Wire[];
  arcs: Nec2Arc[];
  helices: Nec2Helix[];
  transforms: Nec2Transform[];
  symmetries: Nec2Symmetry[];
  scales: Nec2Scale[];
  patches: Nec2Patch[];
  geometryEnd?: Nec2GeometryEnd | undefined;
  frequencies: Nec2Frequency[];
  excitations: Nec2Excitation[];
  loads: Nec2Load[];
  grounds: Nec2Ground[];
  networks: Nec2Network[];
  transmissionLines: Nec2TransmissionLine[];
  radiationPatterns: Nec2RadiationPattern[];
  executes: Nec2Execute[];
  cards: Nec2CardRecord[];
  parseErrors: Nec2ParseError[];
}

export interface Complex {
  re: number;
  im: number;
}

export interface Nec2FarFieldPoint {
  thetaDeg: number;
  phiDeg: number;
  eTheta: Complex;
  ePhi: Complex;
  gainDbi: number;
  directivityLinear: number;
}

export interface Nec2FrequencyResult {
  frequencyMhz: number;
  wavelengthM: number;
  feedpointImpedance: Complex;
  feedpointAdmittance: Complex;
  feedpointCurrent: Complex;
  reflectionCoeff: Complex;
  s11Mag: number;
  s11PhaseDeg: number;
  vswr: number;
  returnLossDb: number;
  inputPowerW: number;
  radiatedPowerW: number;
  efficiency: number;
  peakDirectivityLinear: number;
  peakDirectivityDbi: number;
  peakGainDbi: number;
  segmentCurrents: Complex[];
  farField: Nec2FarFieldPoint[];
}

export interface Nec2SolveOptions {
  /** Reference characteristic impedance in Ohms (default: 50) */
  z0?: number | undefined;
  /** Whether to compute full far-field radiation pattern grid (default: true) */
  computeFarField?: boolean | undefined;
  /** Number of theta points for far-field integration (default: 37) */
  thetaSamples?: number | undefined;
  /** Number of phi points for far-field integration (default: 18) */
  phiSamples?: number | undefined;
}

export interface Nec2SolveResult {
  z0: number;
  hasGroundPlane: boolean;
  segmentCount: number;
  basisCount: number;
  points: Nec2FrequencyResult[];
}

export interface Nec2EquivalentRlc {
  frequencyMhz: number;
  rRadOhm: number;
  rLossOhm: number;
  lAntH: number;
  cAntF: number;
  z0Ohm: number;
  xAntOhm: number;
  qFactor: number;
}
