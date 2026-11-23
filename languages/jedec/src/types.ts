// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript types for `@modelscript/jedec` (JEDEC JESD3 PLD Fuse-Map & Test Vector Format).
 */

export type JedecDeviceName = "PAL16L8" | "PAL16R8" | "GAL16V8" | "GAL22V10" | "GENERIC";

export interface JedecSourceSpan {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface JedecFuseBlock {
  /** Starting fuse address (0-indexed decimal from `L<addr>`). */
  address: number;
  /** Raw binary bit string (`0` and `1` characters, whitespace stripped). */
  bits: string;
  /** Source span of this `L` field. */
  span: JedecSourceSpan;
}

export interface JedecTestVector {
  /** 1-based vector index from `V<n>`. */
  number: number;
  /** Pin stimulus/expectation string (length should equal `QP`). */
  pins: string;
  /** Source span of this `V` field. */
  span: JedecSourceSpan;
}

export interface JedecNoteField {
  text: string;
  span: JedecSourceSpan;
}

export interface JedecSyntaxIssue {
  kind: "missing-delimiter" | "syntax" | "invalid-fuse-bit" | "invalid-vector-char";
  message: string;
  span: JedecSourceSpan;
}

export interface JedecDocument {
  /** Document name / identifier (from URI or header). */
  name: string;
  /** Optional design specification header text before the first `*`. */
  headerText: string;
  /** Detected or declared device type (e.g., `PAL16L8`, `GAL16V8`). */
  deviceName: JedecDeviceName;
  /** Pin count (`QP<n>*`). */
  pinCount?: number | undefined;
  pinCountSpan?: JedecSourceSpan | undefined;
  /** Total fuse count (`QF<n>*`, mandatory per JESD3). */
  fuseCount?: number | undefined;
  fuseCountSpan?: JedecSourceSpan | undefined;
  /** Maximum number of test vectors (`QV<n>*`). */
  maxVectors?: number | undefined;
  maxVectorsSpan?: JedecSourceSpan | undefined;
  /** Default fuse state (`F0*` or `F1*`). */
  defaultFuseState?: number | undefined;
  rawDefaultFuseState?: string | undefined;
  defaultFuseSpan?: JedecSourceSpan | undefined;
  /** Security fuse (`G0*` or `G1*`). */
  securityFuse?: number | undefined;
  rawSecurityFuse?: string | undefined;
  securityFuseSpan?: JedecSourceSpan | undefined;
  /** Default test condition (`X0*` or `X1*`). */
  defaultTestCondition?: number | undefined;
  defaultTestConditionSpan?: JedecSourceSpan | undefined;
  /** Declared 16-bit hex fuse checksum (`C<hhhh>*`). */
  declaredFuseChecksum?: number | undefined;
  declaredFuseChecksumHex?: string | undefined;
  declaredFuseChecksumSpan?: JedecSourceSpan | undefined;
  /** Whether STX (`\x02`) was present. */
  hasStx: boolean;
  /** Whether ETX (`\x03`) was present. */
  hasEtx: boolean;
  /** Declared 16-bit hex transmission checksum following ETX (`\x03<hhhh>`). */
  declaredTransmissionChecksum?: number | undefined;
  declaredTransmissionChecksumHex?: string | undefined;
  declaredTransmissionChecksumSpan?: JedecSourceSpan | undefined;
  /** Computed 16-bit transmission checksum (STX..ETX inclusive). */
  computedTransmissionChecksum?: number | undefined;
  /** All `L` fuse data blocks in document order. */
  fuseBlocks: JedecFuseBlock[];
  /** All `V` test vectors in document order. */
  testVectors: JedecTestVector[];
  /** All `N` note / comment fields. */
  notes: JedecNoteField[];
  /** Materialized flat fuse array of length `fuseCount` (0 = intact, 1 = blown). */
  fuses: Uint8Array;
  /** Computed 16-bit JESD3 fuse checksum over `fuses`. */
  computedFuseChecksum: number;
  /** Non-fatal syntax issues recorded during parsing. */
  syntaxIssues: JedecSyntaxIssue[];
  /** Raw source text. */
  sourceText: string;
}

export interface JedecDiagnostic {
  code: string;
  numericCode: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface JedecProductLiteral {
  pin: number;
  signalName: string;
  negated: boolean;
}

export interface JedecProductTerm {
  /** Global product term row index in the AND array. */
  rowIndex: number;
  /** Local index within the output macrocell (0 = OE for PAL16L8/GAL16V8). */
  localIndex: number;
  /** True if this row is the output-enable (tristate) control term. */
  isOutputEnable: boolean;
  /** True if all fuses in this row are intact (0) — product term evaluates to constant 0 (disabled). */
  alwaysFalse: boolean;
  /** True if all fuses in this row are blown (1) — product term evaluates to constant 1 (always active). */
  alwaysTrue: boolean;
  /** Conjunction literals (empty if `alwaysFalse` or `alwaysTrue`). */
  literals: JedecProductLiteral[];
  /** Human-readable Boolean expression for this product term. */
  expression: string;
}

export interface JedecOutputEquation {
  /** Output macrocell index (0-based). */
  outputIndex: number;
  /** Physical IC pin number (1-based). */
  pin: number;
  /** Logical signal name (e.g., `O19` or `Y0`). */
  signalName: string;
  /** Active-low (`!SOP`) vs active-high (`SOP`) polarity. */
  activeLow: boolean;
  /** Optional output-enable product term. */
  oeTerm?: JedecProductTerm | undefined;
  /** Active (non-constant-false) SOP product terms. */
  activeTerms: JedecProductTerm[];
  /** All product terms belonging to this macrocell. */
  allTerms: JedecProductTerm[];
  /** Formatted sum-of-products equation string (e.g., `O19 = !((!I1 & !I2) | (I1 & I2))`). */
  equation: string;
}

export interface JedecFuseUtilization {
  totalFuses: number;
  intactFuses: number;
  blownFuses: number;
  intactRatio: number;
  blownRatio: number;
  totalProductTerms: number;
  usedProductTerms: number;
  alwaysTrueTerms: number;
  disabledProductTerms: number;
  activeOutputs: number;
}

export interface JedecBooleanExtractionResult {
  deviceName: JedecDeviceName;
  pinCount: number;
  matrixRows: number;
  matrixCols: number;
  inputPins: number[];
  outputPins: number[];
  equations: JedecOutputEquation[];
  utilization: JedecFuseUtilization;
}

export interface JedecVectorPinCheck {
  pin: number;
  signalName: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface JedecVectorSimRow {
  vectorNumber: number;
  rawPins: string;
  passed: boolean;
  checks: JedecVectorPinCheck[];
}

export interface JedecSimulationResult {
  deviceName: JedecDeviceName;
  totalVectors: number;
  passedVectors: number;
  failedVectors: number;
  totalChecks: number;
  passedChecks: number;
  passRate: number;
  /** Root-mean-square error over checked expected H/L outputs (0.0 for 100% match). */
  rmse: number;
  rows: JedecVectorSimRow[];
}
