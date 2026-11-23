// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for LS-DYNA / DYNA3D (.k, .key, .dyn) explicit dynamics keyword decks.
 */

export interface LsDynaSourceLoc {
  line: number;
  column: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface LsDynaNode {
  nid: number;
  x: number;
  y: number;
  z: number;
  tc: number; // Translational constraint code (0..7)
  rc: number; // Rotational constraint code (0..7)
  loc?: LsDynaSourceLoc | undefined;
}

export type LsDynaElementKind = "SOLID" | "SHELL" | "BEAM";

export interface LsDynaElement {
  eid: number;
  pid: number;
  kind: LsDynaElementKind;
  nodes: number[];
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaPart {
  pid: number;
  title: string;
  secid: number;
  mid: number;
  eosid: number;
  hgid: number;
  grav: number;
  adpopt: number;
  tmid: number;
  loc?: LsDynaSourceLoc | undefined;
}

export type LsDynaSectionKind = "SOLID" | "SHELL" | "BEAM";

export interface LsDynaSection {
  secid: number;
  kind: LsDynaSectionKind;
  elform: number;
  /** Shell thickness (t1..t4) or Beam cross-sectional area */
  thickness?: number | undefined;
  area?: number | undefined;
  /** Beam second moments of area */
  iss?: number | undefined;
  itt?: number | undefined;
  /** Shell shear factor */
  shrf?: number | undefined;
  /** Number of through-thickness integration points */
  nip?: number | undefined;
  loc?: LsDynaSourceLoc | undefined;
}

export type LsDynaMaterialType =
  "MAT_ELASTIC" | "MAT_PLASTIC_KINEMATIC" | "MAT_RIGID" | "MAT_PIECEWISE_LINEAR_PLASTICITY";

export interface LsDynaMaterial {
  mid: number;
  type: LsDynaMaterialType;
  /** Mass density rho (kg/m^3 or consistent units) */
  ro: number;
  /** Young's modulus E */
  e: number;
  /** Poisson's ratio nu */
  pr: number;
  /** Yield stress sigy (MAT_003 / MAT_024) */
  sigy?: number | undefined;
  /** Tangent modulus etan (MAT_003 / MAT_024) */
  etan?: number | undefined;
  /** Hardening parameter beta (0=kinematic, 1=isotropic) */
  beta?: number | undefined;
  /** Strain rate parameters src, srp */
  src?: number | undefined;
  srp?: number | undefined;
  /** Failure strain fs */
  fs?: number | undefined;
  /** Rigid body constraint flags (MAT_020) */
  cmo?: number | undefined;
  con1?: number | undefined;
  con2?: number | undefined;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaBoundarySpc {
  targetType: "NODE" | "SET";
  /** Node ID (for NODE) or Node Set ID (for SET) */
  targetId: number;
  cid: number;
  dofx: boolean;
  dofy: boolean;
  dofz: boolean;
  dofrx: boolean;
  dofry: boolean;
  dofrz: boolean;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaInitialVelocity {
  /** Node set ID (0 = all nodes) */
  nsid: number;
  nsidex: number;
  boxid: number;
  vx: number;
  vy: number;
  vz: number;
  vxr: number;
  vyr: number;
  vzr: number;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaLoadNodePoint {
  nid: number;
  /** DOF: 1=x, 2=y, 3=z, 5=rx, 6=ry, 7=rz */
  dof: number;
  lcid: number;
  sf: number;
  cid: number;
  m1: number;
  m2: number;
  m3: number;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaCurvePoint {
  abscissa: number;
  ordinate: number;
}

export interface LsDynaCurve {
  lcid: number;
  sidr: number;
  sfa: number;
  sfo: number;
  offa: number;
  offo: number;
  points: LsDynaCurvePoint[];
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaNodeSet {
  sid: number;
  nodes: number[];
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaControlTermination {
  endtim: number;
  endcyc: number;
  dtmin: number;
  endeng: number;
  endmas: number;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaControlTimestep {
  dtinit: number;
  tssfac: number;
  isdo: number;
  tslimt: number;
  dt2ms: number;
  lctm: number;
  erode: number;
  ms1st: number;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaDatabaseGlstat {
  dt: number;
  binary: number;
  lcur: number;
  ioopt: number;
  loc?: LsDynaSourceLoc | undefined;
}

export interface LsDynaParseError {
  message: string;
  line: number;
  column: number;
  keyword?: string | undefined;
}

export interface LsDynaDuplicateRecord {
  kind: "node" | "element" | "part" | "material" | "section";
  id: number;
  line: number;
}

export interface LsDynaDeck {
  title: string;
  hasKeywordHeader: boolean;
  hasEndCard: boolean;
  nodes: Map<number, LsDynaNode>;
  elements: Map<number, LsDynaElement>;
  parts: Map<number, LsDynaPart>;
  sections: Map<number, LsDynaSection>;
  materials: Map<number, LsDynaMaterial>;
  boundaries: LsDynaBoundarySpc[];
  initialVelocities: LsDynaInitialVelocity[];
  loads: LsDynaLoadNodePoint[];
  curves: Map<number, LsDynaCurve>;
  nodeSets: Map<number, LsDynaNodeSet>;
  controlTermination?: LsDynaControlTermination | undefined;
  controlTimestep?: LsDynaControlTimestep | undefined;
  databaseGlstat?: LsDynaDatabaseGlstat | undefined;
  keywordsFound: string[];
  duplicates: LsDynaDuplicateRecord[];
  parseErrors: LsDynaParseError[];
}
