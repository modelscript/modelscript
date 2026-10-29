// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Text range span for AST/CST nodes and tokens.
 */
export interface SourceSpan {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

/**
 * PSS/E bus operational type code.
 */
export enum BusType {
  PQ = 1,
  PV = 2,
  Swing = 3,
  Isolated = 4,
}

/**
 * Case Identification Data (First line of PSS/E .raw file).
 */
export interface CaseIdentification {
  ic: number;
  sbase: number;
  rev: number;
  xfrrat: number;
  nxfrat: number;
  basfrq: number;
  span?: SourceSpan | undefined;
}

/**
 * Bus Data Record.
 */
export interface BusRecord {
  i: number;
  name: string;
  baseKv: number;
  ide: BusType;
  area: number;
  zone: number;
  owner: number;
  vm: number;
  va: number;
  nvhi?: number | undefined;
  nvlo?: number | undefined;
  evhi?: number | undefined;
  evlo?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Load Data Record.
 */
export interface LoadRecord {
  i: number;
  id: string;
  status: number;
  area: number;
  zone: number;
  pl: number;
  ql: number;
  ip: number;
  iq: number;
  yp: number;
  yq: number;
  owner: number;
  scale: number;
  intrct: number;
  span?: SourceSpan | undefined;
}

/**
 * Fixed Bus Shunt Data Record.
 */
export interface FixedShuntRecord {
  i: number;
  id: string;
  status: number;
  gl: number;
  bl: number;
  span?: SourceSpan | undefined;
}

/**
 * Generator Data Record.
 */
export interface GeneratorRecord {
  i: number;
  id: string;
  pg: number;
  qg: number;
  qt: number;
  qb: number;
  vs: number;
  ireg: number;
  mbase: number;
  zr: number;
  zx: number;
  rt: number;
  xt: number;
  gtap: number;
  stat: number;
  rmpct: number;
  pt: number;
  pb: number;
  o1?: number | undefined;
  f1?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Transmission Line / Non-Transformer Branch Data Record.
 */
export interface BranchRecord {
  i: number;
  j: number;
  ckt: string;
  r: number;
  x: number;
  b: number;
  rateA: number;
  rateB: number;
  rateC: number;
  gi: number;
  bi: number;
  gj: number;
  bj: number;
  st: number;
  met: number;
  len: number;
  o1?: number | undefined;
  f1?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Transformer Data Record (2-Winding or 3-Winding).
 */
export interface TransformerRecord {
  i: number;
  j: number;
  k: number;
  ckt: string;
  cw: number;
  cm: number;
  mag1: number;
  mag2: number;
  nmetr: number;
  name: string;
  stat: number;
  o1?: number | undefined;
  f1?: number | undefined;
  r12: number;
  x12: number;
  sbase12: number;
  r23?: number | undefined;
  x23?: number | undefined;
  sbase23?: number | undefined;
  r31?: number | undefined;
  x31?: number | undefined;
  sbase31?: number | undefined;
  vmstar?: number | undefined;
  anstar?: number | undefined;
  windv1: number;
  nomv1: number;
  ang1: number;
  rata1: number;
  ratb1: number;
  ratc1: number;
  cod1: number;
  cont1: number;
  rma1: number;
  rmi1: number;
  vma1: number;
  vmi1: number;
  ntp1: number;
  tab1: number;
  cr1: number;
  cx1: number;
  cnxa1: number;
  windv2: number;
  nomv2: number;
  ang2?: number | undefined;
  rata2?: number | undefined;
  ratb2?: number | undefined;
  ratc2?: number | undefined;
  windv3?: number | undefined;
  nomv3?: number | undefined;
  ang3?: number | undefined;
  rata3?: number | undefined;
  ratb3?: number | undefined;
  ratc3?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Area Interchange Data Record.
 */
export interface AreaRecord {
  i: number;
  isw: number;
  pdes: number;
  ptol: number;
  arname: string;
  span?: SourceSpan | undefined;
}

/**
 * Two-Terminal DC Line Data Record.
 */
export interface TwoTerminalDcRecord {
  i: number;
  mdc: number;
  rdc: number;
  setvl: number;
  vschd: number;
  vcmod: number;
  rcomp: number;
  deltm: number;
  ipr?: number | undefined;
  ipi?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Voltage Source Converter (VSC) DC Line Data Record.
 */
export interface VscDcRecord {
  name: string;
  mdc: number;
  rdc: number;
  ibus1?: number | undefined;
  ibus2?: number | undefined;
  o1?: number | undefined;
  f1?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Switched Shunt Data Record.
 */
export interface SwitchedShuntRecord {
  i: number;
  modsw: number;
  adjm: number;
  stat: number;
  vswhi: number;
  vswlo: number;
  swrem: number;
  rmpct: number;
  rmidnt: string;
  binit: number;
  n1: number;
  b1: number;
  n2?: number | undefined;
  b2?: number | undefined;
  n3?: number | undefined;
  b3?: number | undefined;
  n4?: number | undefined;
  b4?: number | undefined;
  n5?: number | undefined;
  b5?: number | undefined;
  n6?: number | undefined;
  b6?: number | undefined;
  n7?: number | undefined;
  b7?: number | undefined;
  n8?: number | undefined;
  b8?: number | undefined;
  span?: SourceSpan | undefined;
}

/**
 * Standard PSS/E Dynamic Model Categories in `.dyr` files.
 */
export type PsseDyrCategory = "generator" | "exciter" | "governor" | "stabilizer" | "user";

/**
 * Parsed PSS/E `.dyr` Dynamic Model Record.
 *
 * Standard PSS/E `.dyr` syntax:
 * `IBUS 'MODEL' ID CON(1) ... CON(N) /`
 */
export interface PsseDyrRecord {
  ibus: number;
  model: string;
  id: string;
  category: PsseDyrCategory;
  con: number[];
  namedParams: Record<string, number>;
  span?: SourceSpan | undefined;
}

/**
 * Parsed PSS/E `.dyr` Dynamic Data Collection.
 */
export interface PsseDyrCase {
  records: PsseDyrRecord[];
  generatorsByBusId: Map<string, PsseDyrRecord>;
  excitersByBusId: Map<string, PsseDyrRecord>;
  governorsByBusId: Map<string, PsseDyrRecord>;
  stabilizersByBusId: Map<string, PsseDyrRecord>;
}

/**
 * Parsed PSS/E Base Case Document.
 */
export interface PsseCase {
  header: CaseIdentification;
  title1: string;
  title2: string;
  buses: Map<number, BusRecord>;
  loads: LoadRecord[];
  fixedShunts: FixedShuntRecord[];
  generators: GeneratorRecord[];
  branches: BranchRecord[];
  transformers: TransformerRecord[];
  areas: AreaRecord[];
  twoTerminalDc: TwoTerminalDcRecord[];
  vscDc: VscDcRecord[];
  switchedShunts: SwitchedShuntRecord[];
  dyr?: PsseDyrCase | undefined;
}

/**
 * Diagnostic emitted by the PSS/E linter.
 */
export interface PsseDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  startOffset: number;
  endOffset: number;
  line?: number | undefined;
  column?: number | undefined;
}
