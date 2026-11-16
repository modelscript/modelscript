// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Pre-flight Linter Rules.
 *
 * Implements static diagnostics to catch floating nodes, transformer rating
 * mismatches, physically invalid parameters, and weak-grid warnings.
 */

import { lintCSource } from "@modelscript/c";
import { lintFortranSource, tokenizeFortran } from "@modelscript/fortran";
import {
  analyzeControlIntervals,
  analyzeControlZonotopes,
  isBounded,
  outputLimits,
} from "../analysis/control-intervals.js";
import {
  verifyControlDelayStability,
  verifyConverterReachability,
  verifyProtectionRelayBmc,
} from "../analysis/formal-emt-checks.js";
import { analyzeSimulationCoverage } from "../netlist/coverage.js";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { evalParamExpr } from "../netlist/param-eval.js";
import { computePortWorldPosition } from "../parser/pscx-parser.js";
import { evaluateCheckRules } from "../script/script-parser.js";
import { checkRationalPassivity } from "../solver/vector-fitting.js";
import type { Point2D, PscadDiagnostic, PscxProject } from "../types.js";

/**
 * Catalog of PSCAD pre-flight electrical and control diagnostic error codes (`M6001`–`M6011`).
 */
export const PscadErrorCode = {
  /** `M6001`: Electrical bus or node has no connected branches, sources, or shunt elements. */
  FLOATING_NODE: {
    code: "M6001",
    rule: "floating-electrical-node",
    severity: "error" as const,
    message: (nodeName: string) => `Electrical node '${nodeName}' is floating with no closed connections.`,
  },
  /** `M6002`: Transformer primary or secondary nominal voltage differs by more than 5% from the connected bus base kV. */
  TRANSFORMER_MISMATCH: {
    code: "M6002",
    rule: "transformer-winding-mismatch",
    severity: "warning" as const,
    message: (xfmrName: string, ratedKv: number, busKv: number, side: "primary" | "secondary") =>
      `Transformer '${xfmrName}' ${side} rating (${ratedKv} kV) does not match connected bus base (${busKv} kV).`,
  },
  /** `M6003`: Component physical parameter ($R$, $L$, $C$, or rated $\text{MVA}$) violates non-negativity or positivity bounds. */
  INVALID_PARAMETER: {
    code: "M6003",
    rule: "invalid-parameter-bounds",
    severity: "error" as const,
    message: (elemName: string, paramName: string, val: number, reason: string) =>
      `Component '${elemName}' parameter '${paramName}' = ${val} is invalid: ${reason}.`,
  },
  /** `M6004`: Point of Interconnection (POI) Short-Circuit Ratio ($\text{SCR} = S_{\text{sc}} / S_{\text{IBR}}$) is below 1.5. */
  WEAK_GRID: {
    code: "M6004",
    rule: "weak-grid-warning",
    severity: "warning" as const,
    message: (poiBus: string, scr: number) =>
      `Point of Interconnection '${poiBus}' has low Short-Circuit Ratio (SCR = ${scr.toFixed(2)} < 1.5). IBR control stability risks detected.`,
  },
  /** `M6005`: CSMF control block references an input signal ID that does not match any block in the schematic. */
  CSMF_UNRESOLVED_INPUT: {
    code: "M6005",
    rule: "csmf-unresolved-input",
    severity: "error" as const,
    message: (blockId: string, missingInputId: string) =>
      `CSMF control block '${blockId}' references unresolved upstream signal block '${missingInputId}'.`,
  },
  /** `M6006`: Distributed Bergeron/FDPM transmission line wave travel time $\tau = \ell\sqrt{L'C'}$ is shorter than the EMT step $\Delta t$. */
  LINE_TRAVEL_TIME_UNDERFLOW: {
    code: "M6006",
    rule: "line-travel-time-underflow",
    severity: "error" as const,
    message: (lineId: string, tauUs: number, dtUs: number) =>
      `Transmission line '${lineId}' wave propagation delay (${tauUs.toFixed(2)} us) is smaller than simulation time step (${dtUs.toFixed(2)} us). Reduce time step or use a lumped pi-section model.`,
  },
  /** `M6007`: Synchronous machine d-axis reactances violate the physical flux-leakage ordering $X_d \ge X_d' \ge X_d'' > 0$. */
  SYNC_MACHINE_REACTANCE_ORDER: {
    code: "M6007",
    rule: "sync-machine-reactance-order",
    severity: "error" as const,
    message: (machineId: string, xd: number, xdPrime: number, xdSub: number) =>
      `Synchronous machine '${machineId}' violates physical d-axis reactance hierarchy (Xd=${xd} >= Xd'=${xdPrime} >= Xd''=${xdSub} pu required).`,
  },
  /** `M6008`: Metal-Oxide Varistor (MOV) surge arrester $V_{\text{ref}}$ is below connected bus peak line-to-ground voltage $V_{\text{base}}\sqrt{2/3}$. */
  MOV_ARRESTER_UNDER_RATED: {
    code: "M6008",
    rule: "mov-arrester-under-rated",
    severity: "warning" as const,
    message: (arresterId: string, vRefKv: number, busName: string, vPeakPhaseKv: number) =>
      `MOV surge arrester '${arresterId}' reference voltage (${vRefKv.toFixed(1)} kV) is below connected bus '${busName}' nominal phase-to-ground peak voltage (${vPeakPhaseKv.toFixed(1)} kV), causing continuous thermal conduction.`,
  },
  /** `M6009`: Two components or buses share the same identifier within the same schematic canvas module. */
  DUPLICATE_COMPONENT_ID: {
    code: "M6009",
    rule: "duplicate-component-id",
    severity: "error" as const,
    message: (id: string, modName: string) =>
      `Duplicate component or bus ID '${id}' declared in schematic module '${modName}'.`,
  },
  /** `M6010`: A conductive wire net directly shorts two buses whose nominal base voltages differ by more than 5%. */
  BUS_VOLTAGE_CONFLICT: {
    code: "M6010",
    rule: "bus-voltage-conflict",
    severity: "error" as const,
    message: (busA: string, kvA: number, busB: string, kvB: number) =>
      `Conductive net shorts bus '${busA}' (${kvA} kV) directly to bus '${busB}' (${kvB} kV) without an intervening transformer.`,
  },
  /** `M6011`: A wire connects a CSMF control signal port directly to a 3-phase electrical port or bus. */
  PORT_DOMAIN_MISMATCH: {
    code: "M6011",
    rule: "port-domain-mismatch",
    severity: "error" as const,
    message: (wireId: string, sigPort: string, elecPort: string) =>
      `Wire '${wireId}' connects control signal port '${sigPort}' directly to 3-phase electrical port '${elecPort}'.`,
  },
  /** `M6012`: CSMF control blocks form a feedback cycle that contains no state (integrator, lag, delay) block. */
  ALGEBRAIC_LOOP: {
    code: "M6012",
    rule: "csmf-algebraic-loop",
    severity: "error" as const,
    message: (cycle: string) => `CSMF control blocks form an algebraic loop with no state or delay element: ${cycle}.`,
  },
  /** `M6013`: Two or more voltage sources with an explicit zero source impedance are connected to the same bus. */
  PARALLEL_IDEAL_SOURCES: {
    code: "M6013",
    rule: "parallel-ideal-sources",
    severity: "error" as const,
    message: (busName: string, sourceIds: string) =>
      `Ideal voltage sources ${sourceIds} are connected in parallel at bus '${busName}', making the nodal matrix singular.`,
  },
  /** `M6014`: Two or more voltage sources with no declared source impedance share a bus (solver applies a stiff default). */
  PARALLEL_LOW_IMPEDANCE_SOURCES: {
    code: "M6014",
    rule: "parallel-low-impedance-sources",
    severity: "warning" as const,
    message: (busName: string, sourceIds: string) =>
      `Voltage sources ${sourceIds} are connected in parallel at bus '${busName}' with no declared source impedance; a stiff default impedance is assumed and large circulating currents may result.`,
  },
  /** `M6015`: A limiter's input interval lies entirely outside its output limits, so it is permanently saturated. */
  PERMANENT_SATURATION: {
    code: "M6015",
    rule: "limiter-permanently-saturated",
    severity: "warning" as const,
    message: (blockId: string, inLo: number, inHi: number, limLo: number, limHi: number) =>
      `Limiter '${blockId}' is permanently saturated: its input stays within [${inLo}, ${inHi}] but its output limits are [${limLo}, ${limHi}].`,
  },
  /** `M6016`: Parameter validation check assertion failed in component `<segment name="Checks">`. */
  CHECK_FAILED: {
    code: "M6016",
    rule: "component-check-failed",
    severity: "error" as const,
    message: (cmpName: string, reason: string) => `Component '${cmpName}' check failed: ${reason}.`,
  },
  /** `M6017`: Parameter validation check warning in component `<segment name="Checks">`. */
  CHECK_WARNING: {
    code: "M6017",
    rule: "component-check-warning",
    severity: "warning" as const,
    message: (cmpName: string, reason: string) => `Component '${cmpName}' check warning: ${reason}.`,
  },
  /** `M6021`: Component references a definition not found in the project or loaded libraries. */
  UNRESOLVED_DEFINITION: {
    code: "M6021",
    rule: "unresolved-component-definition",
    severity: "warning" as const,
    message: (cmpName: string, defName: string) =>
      `Component '${cmpName}' references definition '${defName}', which is not found in the project or loaded .pslx libraries.`,
  },
  /** `M6022`: Wire endpoint terminates just outside the snap radius of a port, bus, or wire. */
  WIRE_NEAR_MISS: {
    code: "M6022",
    rule: "wire-near-miss",
    severity: "warning" as const,
    message: (wireId: string, dist: number, targetName: string) =>
      `Wire '${wireId}' endpoint is ${dist.toFixed(1)} px from '${targetName}' (outside snap tolerance 4 px), leaving an unintentional open circuit.`,
  },
  /** `M6024`: Wireless signal tag (`datalabel`, `radiolink`, `import`, `export`) has no matching peer. */
  DANGLING_WIRELESS_SIGNAL: {
    code: "M6024",
    rule: "dangling-wireless-signal",
    severity: "warning" as const,
    message: (tagName: string, kind: string, reason: string) =>
      `Wireless signal tag '${tagName}' (${kind}) is dangling: ${reason}.`,
  },
  /** `M6031`: Component/source rated frequency differs from the project nominal system frequency. */
  SYSTEM_FREQUENCY_MISMATCH: {
    code: "M6031",
    rule: "system-frequency-mismatch",
    severity: "warning" as const,
    message: (elemName: string, elemFreqHz: number, sysFreqHz: number) =>
      `Element '${elemName}' is rated at ${elemFreqHz} Hz, which differs from the project system frequency (${sysFreqHz} Hz).`,
  },
  /** `M6040`: EMT simulation time step violates carrier PWM Nyquist/sampling resolution. */
  PWM_STEP_NYQUIST_VIOLATION: {
    code: "M6040",
    rule: "pwm-step-nyquist-violation",
    severity: "warning" as const,
    message: (cmpName: string, carrierHz: number, dtUs: number, recommendedUs: number) =>
      `PWM/switching block '${cmpName}' operates at ${carrierHz} Hz while EMT time step Δt=${dtUs} us yields <10 steps/cycle (recommend Δt <= ${recommendedUs.toFixed(1)} us).`,
  },
  /** `M6041`: CSMF lag/lead-lag/PI time constant is smaller than 2*Δt (discretization underflow). */
  CONTROL_TIME_CONSTANT_UNDERFLOW: {
    code: "M6041",
    rule: "control-time-constant-underflow",
    severity: "warning" as const,
    message: (blockId: string, tcSec: number, dtUs: number) =>
      `CSMF control block '${blockId}' has time constant ${(tcSec * 1e6).toFixed(1)} us < 2*Δt (${(2 * dtUs).toFixed(1)} us), causing numerical aliasing/instability.`,
  },
  /** `M6061`: Interval analysis detects CSMF division by zero or negative square-root input. */
  CSMF_DOMAIN_HAZARD: {
    code: "M6061",
    rule: "csmf-domain-hazard",
    severity: "error" as const,
    message: (blockId: string, kind: string, reason: string) =>
      `CSMF block '${blockId}' (${kind}) has a mathematical domain hazard: ${reason}.`,
  },
  /** `M6062`: CSMF PI controller or integrator has no finite output anti-windup bounds. */
  PI_INTEGRATOR_UNBOUNDED: {
    code: "M6062",
    rule: "pi-integrator-unbounded",
    severity: "warning" as const,
    message: (blockId: string, kind: string) =>
      `CSMF '${kind}' block '${blockId}' has unbounded output limits and may wind up indefinitely under saturation.`,
  },
  /** `M6065`: Custom Fortran UDM segment (`Fortran`/`Dsdyn`/`Dsout`) has a static hazard or storage mismatch. */
  FORTRAN_UDM_HAZARD: {
    code: "M6065",
    rule: "fortran-udm-hazard",
    severity: "error" as const,
    message: (defName: string, segmentName: string, reason: string) =>
      `Definition '${defName}' Fortran segment '${segmentName}' hazard: ${reason}.`,
  },
  /** `M6023`: Collinear overlapping wire segments share an axis without an explicit junction vertex. */
  WIRE_OVERLAP: {
    code: "M6023",
    rule: "overlapping-wire-segments",
    severity: "warning" as const,
    message: (wireA: string, wireB: string) =>
      `Wire '${wireA}' overlaps collinearly with wire '${wireB}'; verify whether a junction or unintentional short exists.`,
  },
  /** `M6025`: Control/signal wire or `datatap` connects ports with mismatched vector dimensions. */
  VECTOR_DIMENSION_MISMATCH: {
    code: "M6025",
    rule: "vector-signal-dimension-mismatch",
    severity: "error" as const,
    message: (srcPort: string, srcDim: number, dstPort: string, dstDim: number) =>
      `Signal vector dimension mismatch: '${srcPort}' (dim=${srcDim}) cannot connect directly to '${dstPort}' (dim=${dstDim}).`,
  },
  /** `M6026`: Single-phase electrical port connects directly to a 3-phase port without phase breakout. */
  PHASE_DIMENSION_MISMATCH: {
    code: "M6026",
    rule: "phase-dimension-mismatch",
    severity: "error" as const,
    message: (wireId: string, port3p: string, port1p: string) =>
      `Wire '${wireId}' connects 3-phase port '${port3p}' directly to 1-phase port '${port1p}' without a breakout block.`,
  },
  /** `M6029`: Component numeric parameter expression fails to evaluate cleanly (e.g., division by zero or unknown symbol). */
  PARAM_EXPR_ERROR: {
    code: "M6029",
    rule: "parameter-expression-eval-error",
    severity: "error" as const,
    message: (cmpName: string, paramKey: string, rawExpr: string) =>
      `Component '${cmpName}' parameter '${paramKey}' expression '${rawExpr}' failed to evaluate to a finite value.`,
  },
  /** `M6030`: Output channel (`pgb`) has a duplicate name or no connected input signal. */
  PGB_CHANNEL_HAZARD: {
    code: "M6030",
    rule: "pgb-output-channel-duplicate-or-unwired",
    severity: "warning" as const,
    message: (channelName: string, reason: string) => `Output channel (pgb) '${channelName}' ${reason}.`,
  },
  /** `M6044`: Multi-bus loop composed solely of zero-impedance jumpers/ideal switches forms a topological KVL short. */
  ZERO_IMPEDANCE_LOOP: {
    code: "M6044",
    rule: "loop-of-capacitors-and-voltage-sources",
    severity: "error" as const,
    message: (cycleDesc: string) =>
      `Zero-impedance closed loop detected across switches/jumpers (${cycleDesc}), making the Dommel nodal matrix singular.`,
  },
  /** `M6060`: Sound interval analysis proves limiter input never reaches upper or lower clamp thresholds (dead limiter). */
  DEAD_LIMITER: {
    code: "M6060",
    rule: "csmf-dead-limiter-never-activates",
    severity: "info" as const,
    message: (blockId: string, inLo: number, inHi: number, limLo: number, limHi: number) =>
      `Limiter '${blockId}' never saturates: input interval [${inLo}, ${inHi}] stays strictly inside limits [${limLo}, ${limHi}].`,
  },
  /** `M6066`: Custom Fortran UDM reads `STORF`/`STORI` without initialization under `TIMEZERO` guard or prior write. */
  FORTRAN_UNINITIALIZED_STOR: {
    code: "M6066",
    rule: "fortran-udm-uninitialized-history-state",
    severity: "warning" as const,
    message: (defName: string, segName: string, arrayName: string) =>
      `Definition '${defName}' segment '${segName}' reads '${arrayName}' before any prior store or TIMEZERO initialization guard.`,
  },
  /** `M6067`: Multi-instance custom Fortran UDM mutates a shared `COMMON` block (non-reentrant state cross-talk). */
  FORTRAN_COMMON_NON_REENTRANT: {
    code: "M6067",
    rule: "fortran-udm-non-reentrant-global-common",
    severity: "error" as const,
    message: (defName: string, instances: number) =>
      `Definition '${defName}' uses a shared Fortran COMMON block while instantiated ${instances} times in the project (causes cross-instance state corruption; use STORF/STORI instead).`,
  },
  /** `M6027`: Hierarchical submodule instance port list does not match the target `<definition>` interface. */
  SUBMODULE_INTERFACE_MISMATCH: {
    code: "M6027",
    rule: "submodule-port-interface-mismatch",
    severity: "error" as const,
    message: (cmpName: string, defName: string, detail: string) =>
      `Submodule instance '${cmpName}' (${defName}) port interface mismatch: ${detail}.`,
  },
  /** `M6043`: Current source or open switch feeds a pure inductive cutset without parallel damping path. */
  INDUCTIVE_CUTSET_HAZARD: {
    code: "M6043",
    rule: "cutset-of-inductors-and-current-sources",
    severity: "error" as const,
    message: (elemId: string, busId: string) =>
      `Inductive/current-source cutset at bus '${busId}' for '${elemId}' has no parallel resistive/snubber path (causes DAE index-2 di/dt impulse).`,
  },
  /** `M6046`: Dommel nodal conductance matrix condition ratio $G_{\\max}/G_{\\min}$ exceeds $10^{11}$. */
  NODAL_ILL_CONDITIONED: {
    code: "M6046",
    rule: "nodal-conductance-matrix-ill-conditioned",
    severity: "warning" as const,
    message: (ratio: number, gMax: number, gMin: number) =>
      `Dommel nodal conductance ratio Gmax/Gmin = ${ratio.toExponential(2)} (${gMax.toExponential(2)} S / ${gMin.toExponential(2)} S) exceeds 1e11 and risks IEEE-754 mantissa loss.`,
  },
  /** `M6064`: High-bandwidth SRF-PLL connected to a weak AC grid ($\\text{SCR} < 2.0$) risks small-signal instability. */
  PLL_WEAK_GRID_INSTABILITY: {
    code: "M6064",
    rule: "pll-bandwidth-weak-grid-instability",
    severity: "warning" as const,
    message: (pllName: string, bwHz: number, scr: number) =>
      `PLL '${pllName}' high bandwidth (${bwHz.toFixed(1)} Hz > 25 Hz) coupled to weak grid (SCR = ${scr.toFixed(2)} < 2.0) risks synchronization instability.`,
  },
  /** `M6028`: Component dropped/unlowered by native EMT simulation extraction (`computeSimulationCoverage`). */
  UNLOWERED_COMPONENT: {
    code: "M6028",
    rule: "unlowered-simulatable-component",
    severity: "info" as const,
    message: (cmpName: string, defName: string) =>
      `Component '${cmpName}' (${defName}) is not lowered into the native EMT netlist and will be omitted from standalone simulation.`,
  },
  /** `M6032`: AC source magnitude differs from connected bus base kV by a sqrt(2), sqrt(3), or sqrt(2/3) scaling factor. */
  RMS_PEAK_VOLTAGE_SUSPECT: {
    code: "M6032",
    rule: "rms-vs-peak-voltage-entry-suspect",
    severity: "warning" as const,
    message: (srcName: string, enteredKv: number, busName: string, busKv: number, hint: string) =>
      `Source '${srcName}' voltage (${enteredKv} kV) differs from connected bus '${busName}' (${busKv} kV L-L RMS) by ${hint}.`,
  },
  /** `M6042`: Plot/channel sampling step is much coarser than simulation Δt with switching devices, causing harmonic aliasing. */
  PLOT_STEP_ALIASING: {
    code: "M6042",
    rule: "plot-step-aliasing-hazard",
    severity: "warning" as const,
    message: (plotStepUs: number, dtUs: number, nyquistHz: number) =>
      `Plot sampling step (${plotStepUs} us > 10*Δt where Δt=${dtUs} us) lowers Nyquist frequency to ${nyquistHz.toFixed(0)} Hz and risks aliasing switching harmonics.`,
  },
  /** `M6045`: Switching valve/bridge lacks snubber RC damping when Critical Damping Adjustment (CDA) is disabled. */
  MISSING_SWITCH_SNUBBER: {
    code: "M6045",
    rule: "missing-switch-snubber-chatter-risk",
    severity: "warning" as const,
    message: (elemName: string, defName: string) =>
      `Switching device '${elemName}' (${defName}) has no RC snubber parameters while CDA chatter elimination is disabled.`,
  },
  /** `M6047`: Frequency-dependent / ULM transmission line rational fit violates strict passivity (negative conductance or RHP pole). */
  ULM_PASSIVITY_VIOLATION: {
    code: "M6047",
    rule: "ulm-vector-fitting-passivity-violation",
    severity: "error" as const,
    message: (lineId: string, detail: string) =>
      `Transmission line '${lineId}' rational vector fit violates passivity: ${detail}.`,
  },
  /** `M6048`: Saturable transformer core parameters violate physical knee-point, inductance ordering, or remanent flux bounds. */
  TRANSFORMER_SATURATION_INVALID: {
    code: "M6048",
    rule: "transformer-magnetizing-inrush-remanence-invalid",
    severity: "error" as const,
    message: (xfmrId: string, detail: string) =>
      `Saturable transformer '${xfmrId}' magnetizing/remanence configuration is invalid: ${detail}.`,
  },
  /** `M6049`: Series capacitor + inductive branch path produces a subsynchronous electrical resonance (5–55 Hz). */
  SUBSYNCHRONOUS_RESONANCE_RISK: {
    code: "M6049",
    rule: "subsynchronous-series-resonance-risk",
    severity: "warning" as const,
    message: (capId: string, indId: string, fResHz: number, fBaseHz: number) =>
      `Series capacitor '${capId}' in series with inductive element '${indId}' resonates at ${fResHz.toFixed(1)} Hz (< ${fBaseHz} Hz nominal), creating subsynchronous resonance (SSR/SSCI) risk.`,
  },
  /** `M6068`: OEM DLL / shared-library UDM block has invalid ABI header or missing CodeMeter/HASP DRM policy metadata. */
  OEM_DLL_ABI_OR_LICENSE: {
    code: "M6068",
    rule: "oem-dll-abi-and-license-preflight",
    severity: "warning" as const,
    message: (cmpName: string, detail: string) => `OEM black-box DLL block '${cmpName}' pre-flight warning: ${detail}.`,
  },
  /** `M6080`: Breaker/relay protection logic contains a conflicting trip/close race or inverted reclose timer. */
  PROTECTION_STATE_MACHINE_DEADLOCK: {
    code: "M6080",
    rule: "protection-breaker-state-machine-deadlock",
    severity: "error" as const,
    message: (target: string, detail: string) => `Protection state machine hazard on '${target}': ${detail}.`,
  },
  /** `M6081`: Delayed CSMF feedback loop diverges or loses phase margin in DDE flowpipe verification. */
  TIME_DELAY_LOOP_INSTABILITY: {
    code: "M6081",
    rule: "time-delay-control-loop-instability",
    severity: "warning" as const,
    message: (blockId: string, detail: string) =>
      `Time-delay control loop through '${blockId}' shows DDE instability risk: ${detail}.`,
  },
  /** `M6082`: Converter/IBR reachable flowpipe breaches overcurrent or DC-link overvoltage thresholds. */
  CONVERTER_FLOWPIPE_BREACH: {
    code: "M6082",
    rule: "converter-overcurrent-overvoltage-flowpipe",
    severity: "warning" as const,
    message: (unitId: string, detail: string) =>
      `Converter '${unitId}' zonotope reachable flowpipe breached safety envelope: ${detail}.`,
  },
  /** `M6063`: Affine/zonotope noise-symbol tracking eliminated interval dependency blowup on a correlated feedback/subtraction loop. */
  CSMF_RELATIONAL_CANCELATION: {
    code: "M6063",
    rule: "csmf-relational-cancelation-zonotope",
    severity: "info" as const,
    message: (blockId: string, zLo: number, zHi: number, pLo: number, pHi: number) =>
      `Zonotope analysis tightened correlated control block '${blockId}' from [${pLo.toFixed(3)}, ${pHi.toFixed(3)}] to [${zLo.toFixed(3)}, ${zHi.toFixed(3)}].`,
  },
  /** `M6069`: Custom C UDM segment (`<segment name="C">`) has a safety or static analysis hazard from `@modelscript/c`. */
  C_UDM_HAZARD: {
    code: "M6069",
    rule: "c-udm-hazard",
    severity: "error" as const,
    message: (defName: string, segmentName: string, reason: string) =>
      `Definition '${defName}' C segment '${segmentName}' hazard: ${reason}.`,
  },
  /** `M6083`: IEEE 2800 / NERC PRC-029 STL quantitative robustness margin is negative or critical. */
  IEEE2800_STL_VIOLATION: {
    code: "M6083",
    rule: "ieee2800-stl-specification-synthesis",
    severity: "warning" as const,
    message: (clause: string, rho: number) =>
      `IEEE 2800 STL specification '${clause}' failed with robustness ρ=${rho.toFixed(4)}.`,
  },
};

function analyzeFortranStorageSafety(raw: string): {
  hasCommon: boolean;
  readsStorBeforeWrite: "STORF" | "STORI" | null;
} {
  const toks = tokenizeFortran(raw);
  let hasCommon = false;
  let hasTimeZeroGuard = false;
  let wroteStorf = false;
  let wroteStori = false;
  let readsStorBeforeWrite: "STORF" | "STORI" | null = null;

  for (let i = 0; i < toks.length; i++) {
    const up = toks[i]!.value.toUpperCase();
    if (up === "COMMON") {
      hasCommon = true;
    } else if (up === "TIMEZERO" || up === "TZERO") {
      hasTimeZeroGuard = true;
    } else if (up === "STORF" || up === "STORI") {
      // Check if LHS of assignment: skip balanced `(...)` after STORF/STORI and inspect next token `=`
      let j = i + 1;
      if (toks[j]?.value === "(") {
        let depth = 1;
        j++;
        while (j < toks.length && depth > 0) {
          if (toks[j]!.value === "(") depth++;
          else if (toks[j]!.value === ")") depth--;
          j++;
        }
      }
      const isWrite = toks[j]?.value === "=";
      if (isWrite) {
        if (up === "STORF") wroteStorf = true;
        else wroteStori = true;
      } else if (!hasTimeZeroGuard && !readsStorBeforeWrite) {
        if (up === "STORF" && !wroteStorf) readsStorBeforeWrite = "STORF";
        else if (up === "STORI" && !wroteStori) readsStorBeforeWrite = "STORI";
      }
    }
  }
  return { hasCommon, readsStorBeforeWrite };
}

const WIRE_SNAP_TOLERANCE = 4;
const WIRE_NEAR_MISS_RADIUS = 12;

function pointToSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

function readNumParam(params: Record<string, string | number>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const raw = params[k];
    if (raw === undefined) continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const HIGH_SIGNAL_FORTRAN_CODES = new Set<number>([4072, 4073, 4075, 4078]);

function sanitizePscadFortranForLint(raw: string): string {
  // Replace PSCAD `$name` parameter macros with valid Fortran identifiers before parsing
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "$" && i + 1 < raw.length && /[A-Za-z_]/.test(raw[i + 1]!)) {
      out += "MS_PARAM_";
    } else {
      out += ch;
    }
  }
  const upper = out.toUpperCase();
  const hasUnitHeader = upper.includes("SUBROUTINE ") || upper.includes("FUNCTION ") || upper.includes("PROGRAM ");
  return hasUnitHeader ? out : `      SUBROUTINE PSCAD_UDM()\n${out}\n      END SUBROUTINE\n`;
}

function sanitizePscadCForLint(raw: string): string {
  // Replace PSCAD `$name` parameter macros with valid C identifiers while preserving newlines
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "$" && i + 1 < raw.length && /[A-Za-z_]/.test(raw[i + 1]!)) {
      out += "MS_PARAM_";
    } else {
      out += ch;
    }
  }
  return out;
}

function extractNstorAdvances(raw: string): { nstorf: number; nstori: number } {
  const toks = tokenizeFortran(raw);
  let nstorf = 0;
  let nstori = 0;
  for (let i = 0; i + 4 < toks.length; i++) {
    const t0 = toks[i]!.value.toUpperCase();
    if (
      (t0 === "NSTORF" || t0 === "NSTORI") &&
      toks[i + 1]!.value === "=" &&
      toks[i + 2]!.value.toUpperCase() === t0 &&
      toks[i + 3]!.value === "+"
    ) {
      const val = Number.parseInt(toks[i + 4]!.value, 10);
      if (Number.isFinite(val)) {
        if (t0 === "NSTORF") nstorf += val;
        else nstori += val;
      }
    }
  }
  return { nstorf, nstori };
}

/** Control block kinds whose output depends on internal state, which breaks algebraic loops. */
const STATEFUL_BLOCK_KINDS = new Set(["pi", "lag", "leadlag", "integral", "fp_int", "upramp", "ratelimit"]);

/**
 * Tarjan strongly-connected-components over the control block graph (edge: input -> block).
 * Returns the SCCs that form a feedback cycle (size > 1, or a self loop).
 */
function findControlCycles(blocks: { id: string; kind: string; inputs: string[] }[]): string[][] {
  const ids = new Set(blocks.map((b) => b.id));
  const succ = new Map<string, string[]>();
  for (const b of blocks) succ.set(b.id, []);
  for (const b of blocks) {
    for (const inp of b.inputs) if (ids.has(inp)) succ.get(inp)!.push(b.id);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ.get(v)!) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || succ.get(v)!.includes(v)) out.push(comp);
    }
  };
  for (const b of blocks) if (!idx.has(b.id)) strong(b.id);
  return out;
}

/**
 * Runs all PSCAD linter rules on a parsed project.
 */
export function lintPscx(project: PscxProject): PscadDiagnostic[] {
  const diagnostics: PscadDiagnostic[] = [];
  const netlist = extractEmtNetlist(project);

  const allModules = [project.rootModule, ...Array.from(project.subModules?.values() ?? [])];

  const busLocationMap = new Map<
    string,
    { line?: number | undefined; column?: number | undefined; endColumn?: number | undefined }
  >();
  const cmpLocationMap = new Map<
    string,
    { line?: number | undefined; column?: number | undefined; endColumn?: number | undefined }
  >();
  for (const mod of allModules) {
    for (const b of mod.buses) {
      busLocationMap.set(b.id, { line: b.line, column: b.column, endColumn: b.endColumn });
    }
    for (const c of mod.components) {
      cmpLocationMap.set(c.id, { line: c.line, column: c.column, endColumn: c.endColumn });
    }
  }

  // 1. M6001: Check for isolated/floating buses (skip buses/components that are wired to unlowered blocks)
  const wiredEntityIds = new Set<string>();
  for (const mod of allModules) {
    for (const w of mod.wires) {
      for (const pid of w.connectedPortIds) {
        wiredEntityIds.add(pid);
        const underscore = pid.indexOf("_");
        if (underscore > 0) wiredEntityIds.add(pid.slice(0, underscore));
        const lastUnderscore = pid.lastIndexOf("_");
        if (lastUnderscore > 0) wiredEntityIds.add(pid.slice(lastUnderscore + 1));
      }
    }
  }
  const isLibraryProject = project.projectType === "library";
  const rootComponentIds = new Set(project.rootModule.components.map((c) => c.id));
  for (const [busId, bus] of netlist.buses) {
    if (bus.connectedBranchIds.length === 0) {
      if (isLibraryProject) continue;
      if (busId.includes(":") && (!bus.sourceComponentId || !rootComponentIds.has(bus.sourceComponentId))) continue;
      if (/(?:^|[:_])Node_\d+$/i.test(busId) && !bus.sourceComponentId) continue;
      const unprefixedBus = busId.includes("_") ? busId.slice(busId.lastIndexOf("_") + 1) : busId;
      if (
        wiredEntityIds.has(busId) ||
        (busId.includes(":") && (wiredEntityIds.has(unprefixedBus) || wiredEntityIds.has(bus.name))) ||
        (bus.sourceComponentId && wiredEntityIds.has(bus.sourceComponentId))
      ) {
        continue;
      }
      const busLoc = busLocationMap.get(busId);
      const cmpLoc = !busLoc && bus.sourceComponentId ? cmpLocationMap.get(bus.sourceComponentId) : undefined;
      const loc = busLoc ?? cmpLoc;
      diagnostics.push({
        code: PscadErrorCode.FLOATING_NODE.code,
        rule: PscadErrorCode.FLOATING_NODE.rule,
        severity: PscadErrorCode.FLOATING_NODE.severity,
        message: PscadErrorCode.FLOATING_NODE.message(bus.name),
        busId,
        componentId: bus.sourceComponentId,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + (bus.name || busId).length : undefined),
      });
    }
  }

  // 2. M6002: Check transformer winding voltage matches connected bus base
  for (const xfmr of netlist.transformers) {
    const bus1 = netlist.buses.get(xfmr.fromBus);
    const bus2 = netlist.buses.get(xfmr.toBus);
    const loc = cmpLocationMap.get(xfmr.id);

    if (bus1 && bus1.explicitBaseKv && bus1.baseKv > 0 && Math.abs(bus1.baseKv - xfmr.primaryKv) > 0.05 * bus1.baseKv) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.primaryKv, bus1.baseKv, "primary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + xfmr.id.length : undefined),
      });
    }

    if (
      bus2 &&
      bus2.explicitBaseKv &&
      bus2.baseKv > 0 &&
      Math.abs(bus2.baseKv - xfmr.secondaryKv) > 0.05 * bus2.baseKv
    ) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_MISMATCH.code,
        rule: PscadErrorCode.TRANSFORMER_MISMATCH.rule,
        severity: PscadErrorCode.TRANSFORMER_MISMATCH.severity,
        message: PscadErrorCode.TRANSFORMER_MISMATCH.message(xfmr.id, xfmr.secondaryKv, bus2.baseKv, "secondary"),
        componentId: xfmr.id,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.endColumn ?? (loc?.column !== undefined ? loc.column + xfmr.id.length : undefined),
      });
    }
  }

  // 3. M6003: Check parameter bounds
  for (const mod of allModules) {
    for (const cmp of mod.components) {
      const defn = cmp.definitionName.toLowerCase();
      const isElectricalRlc =
        defn.includes("resistor") ||
        defn.includes("inductor") ||
        defn.includes("capacitor") ||
        defn.includes("rlc") ||
        defn.includes("load") ||
        defn.includes("line") ||
        defn.includes("cable") ||
        defn.includes("branch") ||
        defn.includes("source") ||
        defn.includes("xfmr") ||
        defn.includes("breaker") ||
        defn.includes("fault") ||
        defn.includes("arrester");
      for (const [paramName, val] of Object.entries(cmp.parameters)) {
        if (typeof val === "number") {
          const lowerName = paramName.toLowerCase();
          const pLoc = cmp.paramLocations?.[paramName];
          const line = pLoc?.line ?? cmp.line;
          const column = pLoc?.column ?? cmp.column;
          const endColumn = column !== undefined ? column + paramName.length : undefined;
          if (isElectricalRlc && (lowerName === "r" || lowerName === "resistance") && val < 0) {
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(
                cmp.instanceName || cmp.id,
                paramName,
                val,
                "resistance cannot be negative",
              ),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
          if (
            isElectricalRlc &&
            (lowerName === "l" || lowerName === "inductance") &&
            (val < 0 || (defn.includes("inductor") && val <= 0))
          ) {
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(
                cmp.instanceName || cmp.id,
                paramName,
                val,
                val < 0 ? "inductance cannot be negative" : "inductance must be positive",
              ),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
          if (
            isElectricalRlc &&
            (lowerName === "c" || lowerName === "capacitance") &&
            (val < 0 || (defn.includes("capacitor") && val <= 0))
          ) {
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(
                cmp.instanceName || cmp.id,
                paramName,
                val,
                val < 0 ? "capacitance cannot be negative" : "capacitance must be positive",
              ),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
          if (
            (lowerName === "mva" ||
              lowerName === "rated_mva" ||
              lowerName === "v_nom" ||
              lowerName === "vbase" ||
              lowerName === "p_rated" ||
              lowerName === "p_mw") &&
            val <= 0
          ) {
            const reason =
              lowerName === "v_nom" || lowerName === "vbase"
                ? "nominal voltage must be positive"
                : lowerName === "p_rated" || lowerName === "p_mw"
                  ? "rated active power must be positive"
                  : "MVA rating must be positive";
            diagnostics.push({
              code: PscadErrorCode.INVALID_PARAMETER.code,
              rule: PscadErrorCode.INVALID_PARAMETER.rule,
              severity: PscadErrorCode.INVALID_PARAMETER.severity,
              message: PscadErrorCode.INVALID_PARAMETER.message(cmp.instanceName || cmp.id, paramName, val, reason),
              componentId: cmp.id,
              line,
              column,
              endLine: line,
              endColumn,
            });
          }
        }
      }
    }
  }

  // 4. M6004: Check Short-Circuit Ratio (SCR) for FMU IBR instances
  const omega = 2 * Math.PI * (netlist.nominalFrequencyHz || 60);
  for (const fmu of netlist.fmuInstances) {
    const connectedBus = netlist.buses.get(fmu.busConnection);
    if (connectedBus && fmu.ratedMva > 0) {
      let availableGridMva = 0;

      // Direct transformers at POI
      for (const xfmr of netlist.transformers) {
        if (xfmr.fromBus === connectedBus.id || xfmr.toBus === connectedBus.id) {
          availableGridMva += xfmr.mvaRating / (xfmr.leakageReactancePu || 0.1);
        }
      }

      // Direct synchronous sources at POI
      for (const src of netlist.sources) {
        if (src.bus === connectedBus.id) {
          availableGridMva += src.mvaRating / 0.15;
        }
      }

      // 1-hop transmission lines connected to POI: S_sc ≈ V_base^2 / |Z_line|
      if (availableGridMva === 0 && connectedBus.baseKv > 0) {
        for (const line of netlist.transmissionLines) {
          if (line.fromBus === connectedBus.id || line.toBus === connectedBus.id) {
            const rTot = line.rPerKm * line.lengthKm;
            const xTot = omega * line.lPerKm * line.lengthKm;
            const zMag = Math.hypot(rTot, xTot);
            if (zMag > 0) {
              availableGridMva += (connectedBus.baseKv * connectedBus.baseKv) / zMag;
            }
          }
        }
      }

      if (availableGridMva > 0) {
        const scr = availableGridMva / fmu.ratedMva;
        if (scr < 1.5) {
          const loc = cmpLocationMap.get(fmu.id);
          diagnostics.push({
            code: PscadErrorCode.WEAK_GRID.code,
            rule: PscadErrorCode.WEAK_GRID.rule,
            severity: PscadErrorCode.WEAK_GRID.severity,
            message: PscadErrorCode.WEAK_GRID.message(connectedBus.name, scr),
            componentId: fmu.id,
            busId: connectedBus.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + fmu.id.length : undefined,
          });
        }
      }
    }
  }

  // 5. M6005: Check CSMF control block upstream signal references
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const knownBlockIds = new Set(netlist.controlBlocks.map((cb) => cb.id));
    for (const [bId, b] of netlist.buses) {
      knownBlockIds.add(bId);
      if (b.name) knownBlockIds.add(b.name);
    }
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        knownBlockIds.add(cmp.id);
        if (cmp.instanceName) knownBlockIds.add(cmp.instanceName);
        if (cmp.definitionName) {
          knownBlockIds.add(cmp.definitionName);
          const defShort = cmp.definitionName.split(":").pop();
          if (defShort) knownBlockIds.add(defShort);
        }
        for (const key of ["Name", "Symbol", "Tag"] as const) {
          const val = cmp.parameters[key];
          if (typeof val === "string" && val.trim()) knownBlockIds.add(val.trim());
        }
      }
    }
    const isResolvedInput = (inp: string): boolean => {
      const noPhase = inp.replace(/(?:_phase[ABC])+$/i, "");
      if (knownBlockIds.has(inp) || knownBlockIds.has(noPhase)) return true;
      const colonIdx = noPhase.lastIndexOf(":");
      const afterColon = colonIdx >= 0 ? noPhase.slice(colonIdx + 1) : noPhase;
      if (knownBlockIds.has(afterColon)) return true;
      let idx = afterColon.indexOf("_");
      while (idx >= 0) {
        if (knownBlockIds.has(afterColon.slice(idx + 1))) return true;
        idx = afterColon.indexOf("_", idx + 1);
      }
      return false;
    };
    for (const cb of netlist.controlBlocks) {
      for (const inp of cb.inputs) {
        if (!inp || !inp.trim()) continue;
        if (!isResolvedInput(inp)) {
          const loc = cmpLocationMap.get(cb.id);
          diagnostics.push({
            code: PscadErrorCode.CSMF_UNRESOLVED_INPUT.code,
            rule: PscadErrorCode.CSMF_UNRESOLVED_INPUT.rule,
            severity: PscadErrorCode.CSMF_UNRESOLVED_INPUT.severity,
            message: PscadErrorCode.CSMF_UNRESOLVED_INPUT.message(cb.id, inp),
            componentId: cb.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + cb.id.length : undefined,
          });
        }
      }
    }
  }

  // 6. M6006: Check Bergeron / FDPM transmission line travel time vs simulation time step
  const dtUs = project.settings.timeStepUs > 0 ? project.settings.timeStepUs : 50.0;
  for (const line of netlist.transmissionLines) {
    if (line.modelType !== "pi" && line.lengthKm > 0 && line.lPerKm > 0 && line.cPerKm > 0) {
      const tauUs = line.lengthKm * Math.sqrt(line.lPerKm * line.cPerKm) * 1e6;
      if (tauUs < dtUs) {
        const loc = cmpLocationMap.get(line.id);
        diagnostics.push({
          code: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.code,
          rule: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.rule,
          severity: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.severity,
          message: PscadErrorCode.LINE_TRAVEL_TIME_UNDERFLOW.message(line.id, tauUs, dtUs),
          componentId: line.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + line.id.length : undefined,
        });
      }
    }
  }

  // 7. M6007: Check Synchronous Machine subtransient/transient/synchronous reactance hierarchy (Xd >= Xd' >= Xd'')
  if (netlist.synchronousMachines) {
    for (const sm of netlist.synchronousMachines) {
      const xd = sm.xd ?? 1.8;
      const xdPrime = sm.xdPrime ?? 0.3;
      const xdSub = sm.xdSub ?? 0.2;
      if (xdSub > xdPrime || xdPrime > xd || xdSub <= 0) {
        const loc = cmpLocationMap.get(sm.id);
        diagnostics.push({
          code: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.code,
          rule: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.rule,
          severity: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.severity,
          message: PscadErrorCode.SYNC_MACHINE_REACTANCE_ORDER.message(sm.id, xd, xdPrime, xdSub),
          componentId: sm.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + sm.id.length : undefined,
        });
      }
    }
  }

  // 8. M6008: Check MOV Surge Arrester reference voltage against connected bus nominal phase-to-ground peak voltage
  if (netlist.surgeArresters) {
    for (const arr of netlist.surgeArresters) {
      const connectedBus = netlist.buses.get(arr.fromBus);
      if (connectedBus && connectedBus.baseKv > 0 && arr.vRefKv > 0) {
        const vPeakPhaseKv = connectedBus.baseKv * Math.sqrt(2.0 / 3.0);
        if (arr.vRefKv < vPeakPhaseKv) {
          const loc = cmpLocationMap.get(arr.id);
          diagnostics.push({
            code: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.code,
            rule: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.rule,
            severity: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.severity,
            message: PscadErrorCode.MOV_ARRESTER_UNDER_RATED.message(
              arr.id,
              arr.vRefKv,
              connectedBus.name,
              vPeakPhaseKv,
            ),
            componentId: arr.id,
            busId: connectedBus.id,
            line: loc?.line,
            column: loc?.column,
            endLine: loc?.line,
            endColumn: loc?.column !== undefined ? loc.column + arr.id.length : undefined,
          });
        }
      }
    }
  }

  // 9. M6009, M6010, M6011: Structural net-level lints (Duplicate IDs, Bus Voltage Conflicts, Port Domain Mismatches)
  for (const mod of allModules) {
    const seenIds = new Set<string>();
    for (const cmp of mod.components) {
      if (seenIds.has(cmp.id)) {
        diagnostics.push({
          code: PscadErrorCode.DUPLICATE_COMPONENT_ID.code,
          rule: PscadErrorCode.DUPLICATE_COMPONENT_ID.rule,
          severity: PscadErrorCode.DUPLICATE_COMPONENT_ID.severity,
          message: PscadErrorCode.DUPLICATE_COMPONENT_ID.message(cmp.id, mod.name || "Main"),
          componentId: cmp.id,
          line: cmp.line,
          column: cmp.column,
          endLine: cmp.line,
          endColumn: cmp.column !== undefined ? cmp.column + cmp.id.length : undefined,
        });
      } else {
        seenIds.add(cmp.id);
      }
    }
    for (const bus of mod.buses) {
      if (seenIds.has(bus.id)) {
        diagnostics.push({
          code: PscadErrorCode.DUPLICATE_COMPONENT_ID.code,
          rule: PscadErrorCode.DUPLICATE_COMPONENT_ID.rule,
          severity: PscadErrorCode.DUPLICATE_COMPONENT_ID.severity,
          message: PscadErrorCode.DUPLICATE_COMPONENT_ID.message(bus.id, mod.name || "Main"),
          busId: bus.id,
          line: bus.line,
          column: bus.column,
          endLine: bus.line,
          endColumn: bus.column !== undefined ? bus.column + bus.id.length : undefined,
        });
      } else {
        seenIds.add(bus.id);
      }
    }

    const busById = new Map(mod.buses.map((b) => [b.id, b]));
    const portMeta = new Map<string, { kind: string; isWirelessAdapter: boolean; explicitDomain: boolean }>();
    for (const cmp of mod.components) {
      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      const isWirelessAdapter =
        cleanDef === "datalabel" ||
        cleanDef === "data_label" ||
        cleanDef === "xnode" ||
        cleanDef === "pin" ||
        cleanDef === "radio_link" ||
        cleanDef === "pgb" ||
        cleanDef === "breakout" ||
        cleanDef === "datamerge" ||
        cleanDef === "multimeter" ||
        cleanDef === "ground" ||
        cleanDef === "var" ||
        cleanDef === "const" ||
        cleanDef === "consti" ||
        cleanDef === "emtconst" ||
        cleanDef === "nodeloop";
      const isKnownCsmf =
        cleanDef === "pi_ctlr" ||
        cleanDef === "realpole" ||
        cleanDef === "gain" ||
        cleanDef === "sum" ||
        cleanDef === "limit" ||
        cleanDef === "compar" ||
        cleanDef === "integral" ||
        cleanDef === "hardlimit";
      const isKnown3Ph =
        cleanDef === "source3" ||
        cleanDef === "source_3" ||
        cleanDef === "xfmr-3p2w" ||
        cleanDef === "breaker3" ||
        cleanDef === "tline" ||
        cleanDef === "cable" ||
        cleanDef === "sync_machine" ||
        cleanDef === "ind_machine";
      for (const p of cmp.ports) {
        if (!p.name && p.kind === "electrical") continue;
        const explicitDomain = (p.kind === "signal" && isKnownCsmf) || (p.kind === "electrical" && isKnown3Ph);
        portMeta.set(p.id, { kind: p.kind, isWirelessAdapter, explicitDomain });
      }
    }

    const reportedBusConflictPairs = new Set<string>();
    const reportedWireDomainMismatch = new Set<string>();

    for (const wire of mod.wires) {
      // M6010: Check if a single wire net connects two explicit buses with conflicting voltageBaseKv
      const connectedBuses = wire.connectedPortIds
        .map((pid) => busById.get(pid))
        .filter((b): b is NonNullable<typeof b> => b !== undefined && (b.voltageBaseKv ?? 0) > 0);
      if (connectedBuses.length >= 2) {
        const bA = connectedBuses[0]!;
        for (let k = 1; k < connectedBuses.length; k++) {
          const bB = connectedBuses[k]!;
          const kvA = bA.voltageBaseKv!;
          const kvB = bB.voltageBaseKv!;
          if (Math.abs(kvA - kvB) > 0.05 * Math.max(kvA, kvB)) {
            const pairKey = [bA.id, bB.id].sort().join("::");
            if (!reportedBusConflictPairs.has(pairKey)) {
              reportedBusConflictPairs.add(pairKey);
              diagnostics.push({
                code: PscadErrorCode.BUS_VOLTAGE_CONFLICT.code,
                rule: PscadErrorCode.BUS_VOLTAGE_CONFLICT.rule,
                severity: PscadErrorCode.BUS_VOLTAGE_CONFLICT.severity,
                message: PscadErrorCode.BUS_VOLTAGE_CONFLICT.message(bA.name, kvA, bB.name, kvB),
                busId: bB.id,
                line: bB.line ?? wire.line,
                column: bB.column ?? 1,
                endLine: bB.line ?? wire.line,
                endColumn: (bB.column ?? 1) + bB.name.length,
              });
            }
          }
        }
      }

      // M6011: Check if a wire connects a non-adapter control signal port directly to an electrical port or bus
      if (!reportedWireDomainMismatch.has(wire.id)) {
        const sigPorts: string[] = [];
        const elecPorts: string[] = [];
        for (const pid of wire.connectedPortIds) {
          if (busById.has(pid)) {
            elecPorts.push(pid);
            continue;
          }
          const meta = portMeta.get(pid);
          if (!meta || meta.isWirelessAdapter || !meta.explicitDomain) continue;
          if (meta.kind === "signal") sigPorts.push(pid);
          else if (meta.kind === "electrical") elecPorts.push(pid);
        }
        if (sigPorts.length > 0 && elecPorts.length > 0) {
          reportedWireDomainMismatch.add(wire.id);
          diagnostics.push({
            code: PscadErrorCode.PORT_DOMAIN_MISMATCH.code,
            rule: PscadErrorCode.PORT_DOMAIN_MISMATCH.rule,
            severity: PscadErrorCode.PORT_DOMAIN_MISMATCH.severity,
            message: PscadErrorCode.PORT_DOMAIN_MISMATCH.message(wire.id, sigPorts[0]!, elecPorts[0]!),
            line: wire.line ?? 1,
            column: 1,
            endLine: wire.line ?? 1,
            endColumn: 1 + Math.max(1, wire.id.length),
          });
        }
      }
    }
  }

  // 10. M6012: Algebraic loops in CSMF control graph (Tarjan SCC without a stateful block)
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const kindById = new Map(netlist.controlBlocks.map((b) => [b.id, b.kind as string]));
    for (const comp of findControlCycles(netlist.controlBlocks)) {
      if (comp.some((id) => STATEFUL_BLOCK_KINDS.has(kindById.get(id) ?? ""))) continue;
      const first = comp[0]!;
      const loc = cmpLocationMap.get(first);
      diagnostics.push({
        code: PscadErrorCode.ALGEBRAIC_LOOP.code,
        rule: PscadErrorCode.ALGEBRAIC_LOOP.rule,
        severity: PscadErrorCode.ALGEBRAIC_LOOP.severity,
        message: PscadErrorCode.ALGEBRAIC_LOOP.message(comp.map((c) => `'${c}'`).join(" -> ")),
        componentId: first,
        line: loc?.line,
        column: loc?.column,
        endLine: loc?.line,
        endColumn: loc?.column !== undefined ? loc.column + first.length : undefined,
      });
    }
  }

  // 11. M6013/M6014: Parallel zero-impedance voltage sources on one bus
  const noImpedance = netlist.sources.filter((s) => (s.rSourceOhm ?? 0) === 0 && (s.lSourceH ?? 0) === 0);
  const buckets = new Map<string, { strict: typeof noImpedance; loose: typeof noImpedance }>();
  for (const src of noImpedance) {
    const b = buckets.get(src.bus) ?? { strict: [], loose: [] };
    b.loose.push(src);
    if (src.rSourceSpecified) b.strict.push(src);
    buckets.set(src.bus, b);
  }
  for (const [busId, { strict, loose }] of buckets) {
    const isStrict = strict.length >= 2;
    const group = isStrict ? strict : loose;
    if (group.length < 2) continue;
    const def = isStrict ? PscadErrorCode.PARALLEL_IDEAL_SOURCES : PscadErrorCode.PARALLEL_LOW_IMPEDANCE_SOURCES;
    const second = group[1]!;
    const loc = cmpLocationMap.get(second.id);
    diagnostics.push({
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message: def.message(netlist.buses.get(busId)?.name ?? busId, group.map((s) => `'${s.name || s.id}'`).join(", ")),
      componentId: second.id,
      busId,
      line: loc?.line,
      column: loc?.column,
      endLine: loc?.line,
      endColumn: loc?.column !== undefined ? loc.column + second.id.length : undefined,
    });
  }

  // 12. M6015: Permanently saturated limiters (interval abstract interpretation, Tier 2)
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const intervals = analyzeControlIntervals(netlist.controlBlocks);
    for (const b of netlist.controlBlocks) {
      if (b.kind !== "limit" || b.inputs.length !== 1) continue;
      const input = intervals.get(b.inputs[0]!);
      if (!input || !isBounded(input)) continue;
      const lim = outputLimits(b);
      if (input.hi < lim.lo || input.lo > lim.hi) {
        const loc = cmpLocationMap.get(b.id);
        diagnostics.push({
          code: PscadErrorCode.PERMANENT_SATURATION.code,
          rule: PscadErrorCode.PERMANENT_SATURATION.rule,
          severity: PscadErrorCode.PERMANENT_SATURATION.severity,
          message: PscadErrorCode.PERMANENT_SATURATION.message(b.id, input.lo, input.hi, lim.lo, lim.hi),
          componentId: b.id,
          line: loc?.line,
          column: loc?.column,
          endLine: loc?.line,
          endColumn: loc?.column !== undefined ? loc.column + b.id.length : undefined,
        });
      }
    }
  }

  // 12. Component Parameter Checks (from <segment name="Checks">)
  if (project.definitions && !isLibraryProject) {
    const allComponents = allModules.flatMap((m) => m.components);
    for (const cmp of allComponents) {
      if (cmp.definitionName.startsWith("master:")) continue;
      const defName = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;
      const def = project.definitions.get(defName) ?? project.definitions.get(cmp.definitionName);
      if (!def?.checks || def.checks.length === 0) continue;

      const params: Record<string, string | number> = {
        ...(project.rootModule.parameterDefaults ?? {}),
        ...cmp.parameters,
      };

      const portDims: Record<string, number> = {};
      for (const port of cmp.ports) {
        if (port.name) {
          portDims[port.name] = port.dimension ?? 1;
        }
      }
      if (Object.keys(portDims).length === 0) continue;

      const failures = evaluateCheckRules(def.checks, params, portDims);
      for (const fail of failures) {
        const isWarn = fail.severity === "warning";
        const ruleDef = isWarn ? PscadErrorCode.CHECK_WARNING : PscadErrorCode.CHECK_FAILED;
        const loc = cmpLocationMap.get(cmp.id);
        diagnostics.push({
          code: ruleDef.code,
          rule: ruleDef.rule,
          severity: ruleDef.severity,
          message: isWarn
            ? PscadErrorCode.CHECK_WARNING.message(cmp.instanceName || cmp.id, fail.message)
            : PscadErrorCode.CHECK_FAILED.message(cmp.instanceName || cmp.id, fail.message),
          componentId: cmp.id,
          line: loc?.line ?? cmp.line,
          column: loc?.column ?? cmp.column,
          endLine: loc?.line ?? cmp.line,
          endColumn:
            (loc?.column ?? cmp.column) !== undefined
              ? (loc?.column ?? cmp.column)! + (cmp.instanceName || cmp.id).length
              : undefined,
        });
      }
    }
  }

  // 13. M6022: Near-miss unconnected wire endpoints (distance in (4, 12] px from port, bus, or other wire)
  if (!isLibraryProject) {
    for (const mod of allModules) {
      const targetPoints: Array<{ name: string; pos: Point2D }> = [];
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cname = cmp.instanceName || cmp.id;
        for (const port of cmp.ports) {
          targetPoints.push({
            name: `${cname}.${port.name}`,
            pos: computePortWorldPosition(cmp.position, port.position, cmp.rotation ?? 0, Boolean(cmp.mirror)),
          });
        }
      }
      const busSegments: Array<{ name: string; a: Point2D; b: Point2D }> = [];
      for (const bus of mod.buses) {
        const verts =
          bus.vertices && bus.vertices.length >= 2
            ? bus.vertices
            : [bus.position, { x: bus.position.x + (bus.length ?? 60), y: bus.position.y }];
        for (let k = 0; k < verts.length - 1; k++) {
          busSegments.push({ name: bus.name || bus.id, a: verts[k]!, b: verts[k + 1]! });
        }
      }

      for (let wi = 0; wi < mod.wires.length; wi++) {
        const wire = mod.wires[wi]!;
        if (wire.vertices.length < 2) continue;
        const endpoints = [wire.vertices[0]!, wire.vertices[wire.vertices.length - 1]!];
        for (const ep of endpoints) {
          let minDist = Infinity;
          let nearestTarget = "";
          for (const tp of targetPoints) {
            const d = Math.hypot(ep.x - tp.pos.x, ep.y - tp.pos.y);
            if (d < minDist) {
              minDist = d;
              nearestTarget = tp.name;
            }
          }
          for (const bs of busSegments) {
            const d = pointToSegDist(ep, bs.a, bs.b);
            if (d < minDist) {
              minDist = d;
              nearestTarget = bs.name;
            }
          }
          for (let wj = 0; wj < mod.wires.length; wj++) {
            if (wi === wj) continue;
            const other = mod.wires[wj]!;
            for (let k = 0; k < other.vertices.length - 1; k++) {
              const d = pointToSegDist(ep, other.vertices[k]!, other.vertices[k + 1]!);
              if (d < minDist) {
                minDist = d;
                nearestTarget = `wire ${other.id}`;
              }
            }
          }
          if (minDist > WIRE_SNAP_TOLERANCE && minDist <= WIRE_NEAR_MISS_RADIUS && nearestTarget) {
            diagnostics.push({
              code: PscadErrorCode.WIRE_NEAR_MISS.code,
              rule: PscadErrorCode.WIRE_NEAR_MISS.rule,
              severity: PscadErrorCode.WIRE_NEAR_MISS.severity,
              message: PscadErrorCode.WIRE_NEAR_MISS.message(wire.id, minDist, nearestTarget),
              componentId: wire.id,
              line: wire.line,
              endLine: wire.line,
            });
            break;
          }
        }
      }
    }
  }

  // 14. M6024: Dangling wireless signal tags (datalabel / radiolink / import / export)
  if (!isLibraryProject) {
    const projectImports = new Set<string>();
    const projectExports = new Set<string>();
    const projectXnodes = new Set<string>();
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cleanDef = (
          cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
        ).toLowerCase();
        const tag = String(
          cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cmp.parameters["Label"] ?? cmp.instanceName ?? "",
        ).trim();
        if (!tag) continue;
        if (cleanDef === "import") projectImports.add(tag);
        else if (cleanDef === "export") projectExports.add(tag);
        else if (cleanDef === "xnode") projectXnodes.add(tag);
      }
    }

    for (const mod of allModules) {
      const localLabels = new Map<
        string,
        Array<{ id: string; kind: string; line?: number | undefined; col?: number | undefined }>
      >();
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cleanDef = (
          cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
        ).toLowerCase();
        const tag = String(
          cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cmp.parameters["Label"] ?? cmp.instanceName ?? "",
        ).trim();
        if (!tag) continue;
        if (
          cleanDef === "datalabel" ||
          cleanDef === "data_label" ||
          cleanDef === "radiolink" ||
          cleanDef === "radio_link"
        ) {
          const list = localLabels.get(tag) ?? [];
          list.push({ id: cmp.id, kind: cleanDef, line: cmp.line, col: cmp.column });
          localLabels.set(tag, list);
        } else if (cleanDef === "import" && !projectExports.has(tag)) {
          diagnostics.push({
            code: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.code,
            rule: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.rule,
            severity: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.severity,
            message: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.message(tag, "import", "no matching 'export' tag found"),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        } else if (cleanDef === "export" && !projectImports.has(tag)) {
          diagnostics.push({
            code: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.code,
            rule: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.rule,
            severity: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.severity,
            message: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.message(tag, "export", "no matching 'import' tag found"),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        }
      }
      for (const [tag, occs] of localLabels) {
        if (occs.length === 1 && !projectXnodes.has(tag) && !projectImports.has(tag) && !projectExports.has(tag)) {
          const first = occs[0]!;
          diagnostics.push({
            code: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.code,
            rule: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.rule,
            severity: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.severity,
            message: PscadErrorCode.DANGLING_WIRELESS_SIGNAL.message(
              tag,
              first.kind,
              "only one occurrence exists in module",
            ),
            componentId: first.id,
            line: first.line,
            column: first.col,
          });
        }
      }
    }
  }

  // 15. M6031: System frequency mismatch between project settings and AC sources/components
  const sysFreq = project.settings.frequencyHz;
  if (Number.isFinite(sysFreq) && sysFreq > 0) {
    for (const src of netlist.sources) {
      if (src.dc || !Number.isFinite(src.frequencyHz) || src.frequencyHz <= 0) continue;
      if (Math.abs(src.frequencyHz - sysFreq) > 0.5) {
        const loc = cmpLocationMap.get(src.id);
        diagnostics.push({
          code: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.code,
          rule: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.rule,
          severity: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.severity,
          message: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.message(src.name || src.id, src.frequencyHz, sysFreq),
          componentId: src.id,
          line: loc?.line,
          column: loc?.column,
        });
      }
    }
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cleanDef = (
          cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
        ).toLowerCase();
        if (!cleanDef.includes("xfmr") && !cleanDef.includes("transformer") && !cleanDef.includes("machine")) continue;
        const elFreq = readNumParam(cmp.parameters, ["f", "F", "Freq", "freq", "Fn", "fn"]);
        if (elFreq !== undefined && elFreq > 0 && Math.abs(elFreq - sysFreq) > 0.5) {
          diagnostics.push({
            code: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.code,
            rule: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.rule,
            severity: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.severity,
            message: PscadErrorCode.SYSTEM_FREQUENCY_MISMATCH.message(cmp.instanceName || cmp.id, elFreq, sysFreq),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        }
      }
    }
  }

  // 16. M6040: PWM / carrier switching frequency vs EMT time-step Nyquist resolution
  const stepUs = dtUs;
  const stepSec = stepUs * 1e-6;
  for (const mod of allModules) {
    for (const cmp of mod.components) {
      if (cmp.disabled) continue;
      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      const isPwmLike =
        cleanDef.includes("pwm") ||
        cleanDef.includes("carrier") ||
        cleanDef.includes("triangular") ||
        cleanDef.includes("sawtooth") ||
        cleanDef.includes("vsc_pwm") ||
        cleanDef.includes("firing");
      if (!isPwmLike) continue;
      const fSw = readNumParam(cmp.parameters, ["Fc", "fc", "Fsw", "fsw", "Fcarrier", "f_sw", "Freq", "freq", "F"]);
      if (fSw === undefined || fSw <= 0) continue;
      const recommendedUs = 100_000 / fSw; // >= 10 steps per switching period
      if (stepSec > 1 / (10 * fSw) + 1e-12) {
        diagnostics.push({
          code: PscadErrorCode.PWM_STEP_NYQUIST_VIOLATION.code,
          rule: PscadErrorCode.PWM_STEP_NYQUIST_VIOLATION.rule,
          severity: PscadErrorCode.PWM_STEP_NYQUIST_VIOLATION.severity,
          message: PscadErrorCode.PWM_STEP_NYQUIST_VIOLATION.message(
            cmp.instanceName || cmp.id,
            fSw,
            stepUs,
            recommendedUs,
          ),
          componentId: cmp.id,
          line: cmp.line,
          column: cmp.column,
        });
      }
    }
  }

  // 17. M6041, M6061, M6062: CSMF time-constant underflow, interval domain hazards, & unbounded integrators
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const intervals = analyzeControlIntervals(netlist.controlBlocks);
    const cmpDefById = new Map<string, string>();
    for (const mod of allModules) {
      for (const cmp of mod.components) cmpDefById.set(cmp.id, cmp.definitionName.toLowerCase());
    }

    for (const b of netlist.controlBlocks) {
      const loc = cmpLocationMap.get(b.componentId ?? b.id);

      // M6041: Discretization time-constant underflow (0 < tau < 2*dt)
      if (b.kind === "lag" || b.kind === "leadlag" || b.kind === "pi") {
        const tcKeys = b.kind === "pi" ? (["Ti", "ti"] as const) : (["T", "T1", "T2", "Tc", "tau"] as const);
        for (const key of tcKeys) {
          const tc = b.params[key];
          if (tc !== undefined && Number.isFinite(tc) && tc > 0 && tc < 2 * stepSec) {
            diagnostics.push({
              code: PscadErrorCode.CONTROL_TIME_CONSTANT_UNDERFLOW.code,
              rule: PscadErrorCode.CONTROL_TIME_CONSTANT_UNDERFLOW.rule,
              severity: PscadErrorCode.CONTROL_TIME_CONSTANT_UNDERFLOW.severity,
              message: PscadErrorCode.CONTROL_TIME_CONSTANT_UNDERFLOW.message(b.id, tc, stepUs),
              componentId: b.componentId ?? b.id,
              line: loc?.line,
              column: loc?.column,
            });
            break;
          }
        }
      }

      // M6061: Division by zero & negative sqrt hazards over bounded abstract intervals
      if (b.kind === "div") {
        const denom = b.inputs.length >= 2 && b.inputs[1] ? intervals.get(b.inputs[1]) : { lo: 0, hi: 0 };
        if (denom && isBounded(denom) && denom.lo <= 0 && denom.hi >= 0) {
          diagnostics.push({
            code: PscadErrorCode.CSMF_DOMAIN_HAZARD.code,
            rule: PscadErrorCode.CSMF_DOMAIN_HAZARD.rule,
            severity: PscadErrorCode.CSMF_DOMAIN_HAZARD.severity,
            message: PscadErrorCode.CSMF_DOMAIN_HAZARD.message(
              b.id,
              "div",
              `denominator interval [${denom.lo}, ${denom.hi}] includes 0`,
            ),
            componentId: b.componentId ?? b.id,
            line: loc?.line,
            column: loc?.column,
          });
        }
      } else if (b.kind === "inv") {
        const invIn = b.inputs[0] ? intervals.get(b.inputs[0]) : { lo: 0, hi: 0 };
        if (invIn && isBounded(invIn) && invIn.lo <= 0 && invIn.hi >= 0) {
          diagnostics.push({
            code: PscadErrorCode.CSMF_DOMAIN_HAZARD.code,
            rule: PscadErrorCode.CSMF_DOMAIN_HAZARD.rule,
            severity: PscadErrorCode.CSMF_DOMAIN_HAZARD.severity,
            message: PscadErrorCode.CSMF_DOMAIN_HAZARD.message(
              b.id,
              "inv",
              `input interval [${invIn.lo}, ${invIn.hi}] includes 0`,
            ),
            componentId: b.componentId ?? b.id,
            line: loc?.line,
            column: loc?.column,
          });
        }
      } else if (b.kind === "x_power_y") {
        const rawDef = b.componentId ? (cmpDefById.get(b.componentId) ?? "") : "";
        const cleanDef = rawDef.includes(":") ? rawDef.split(":").pop()! : rawDef;
        if (cleanDef === "sqrt") {
          const radIn = b.inputs[0] ? intervals.get(b.inputs[0]) : undefined;
          if (radIn && isBounded(radIn) && radIn.lo < 0) {
            diagnostics.push({
              code: PscadErrorCode.CSMF_DOMAIN_HAZARD.code,
              rule: PscadErrorCode.CSMF_DOMAIN_HAZARD.rule,
              severity: PscadErrorCode.CSMF_DOMAIN_HAZARD.severity,
              message: PscadErrorCode.CSMF_DOMAIN_HAZARD.message(
                b.id,
                "sqrt",
                `input interval [${radIn.lo}, ${radIn.hi}] reaches negative values`,
              ),
              componentId: b.componentId ?? b.id,
              line: loc?.line,
              column: loc?.column,
            });
          }
        }
      }

      // M6062: Unbounded PI / Integrator windup risk
      if (b.kind === "pi" || b.kind === "integral") {
        const lim = outputLimits(b);
        if (!Number.isFinite(lim.lo) || !Number.isFinite(lim.hi)) {
          diagnostics.push({
            code: PscadErrorCode.PI_INTEGRATOR_UNBOUNDED.code,
            rule: PscadErrorCode.PI_INTEGRATOR_UNBOUNDED.rule,
            severity: PscadErrorCode.PI_INTEGRATOR_UNBOUNDED.severity,
            message: PscadErrorCode.PI_INTEGRATOR_UNBOUNDED.message(b.id, b.kind),
            componentId: b.componentId ?? b.id,
            line: loc?.line,
            column: loc?.column,
          });
        }
      }
    }
  }

  // 18. M6065 & M6069: Fortran/C UDM static safety and STORF/NSTORF pointer integrity via @modelscript/fortran & @modelscript/c
  if (project.definitions) {
    for (const [defName, def] of project.definitions) {
      if (!def.scriptSegments || def.scriptSegments.size === 0) continue;
      let dsdynAdv: { nstorf: number; nstori: number } | undefined;
      let dsoutAdv: { nstorf: number; nstori: number } | undefined;
      for (const [segKey, seg] of def.scriptSegments) {
        const lowerKey = segKey.toLowerCase();
        if (lowerKey === "c") {
          if (!seg.content || !seg.content.trim()) continue;
          const sanitizedC = sanitizePscadCForLint(seg.content);
          const cDiags = lintCSource(sanitizedC);
          const baseLine = seg.startLine ?? 1;
          for (const cd of cDiags) {
            if (cd.severity !== "error" && cd.severity !== "warning") continue;
            diagnostics.push({
              code: PscadErrorCode.C_UDM_HAZARD.code,
              rule: PscadErrorCode.C_UDM_HAZARD.rule,
              severity: cd.severity,
              message: PscadErrorCode.C_UDM_HAZARD.message(defName, seg.name, cd.message),
              line: baseLine + Math.max(0, (cd.line ?? 1) - 1),
              column: cd.col ?? 1,
            });
          }
          continue;
        }
        if (lowerKey !== "fortran" && lowerKey !== "dsdyn" && lowerKey !== "dsout") continue;
        if (!seg.content || !seg.content.trim()) continue;
        const wrapped = sanitizePscadFortranForLint(seg.content);
        const wrapperShift = wrapped.startsWith("      SUBROUTINE PSCAD_UDM()\n") ? 1 : 0;
        const baseLine = seg.startLine ?? 1;
        const fDiags = lintFortranSource(wrapped);
        for (const fd of fDiags) {
          if (HIGH_SIGNAL_FORTRAN_CODES.has(fd.code)) {
            const relLine = Math.max(0, (fd.line ?? 1) - 1 - wrapperShift);
            diagnostics.push({
              code: PscadErrorCode.FORTRAN_UDM_HAZARD.code,
              rule: PscadErrorCode.FORTRAN_UDM_HAZARD.rule,
              severity: PscadErrorCode.FORTRAN_UDM_HAZARD.severity,
              message: PscadErrorCode.FORTRAN_UDM_HAZARD.message(defName, seg.name, fd.message),
              line: baseLine + relLine,
              column: fd.column,
            });
          }
        }
        const adv = extractNstorAdvances(wrapped);
        if (lowerKey === "dsdyn") dsdynAdv = adv;
        else if (lowerKey === "dsout") dsoutAdv = adv;

        const storageSafety = analyzeFortranStorageSafety(wrapped);
        if (storageSafety.hasCommon) {
          const instCount = allModules.reduce(
            (acc, m) =>
              acc +
              m.components.filter((c) => {
                const dn = c.definitionName.includes(":") ? c.definitionName.split(":").pop()! : c.definitionName;
                return dn === defName || c.definitionName === defName;
              }).length,
            0,
          );
          if (instCount >= 2) {
            diagnostics.push({
              code: PscadErrorCode.FORTRAN_COMMON_NON_REENTRANT.code,
              rule: PscadErrorCode.FORTRAN_COMMON_NON_REENTRANT.rule,
              severity: PscadErrorCode.FORTRAN_COMMON_NON_REENTRANT.severity,
              message: PscadErrorCode.FORTRAN_COMMON_NON_REENTRANT.message(defName, instCount),
              line: baseLine,
            });
          }
        }
        if (storageSafety.readsStorBeforeWrite) {
          diagnostics.push({
            code: PscadErrorCode.FORTRAN_UNINITIALIZED_STOR.code,
            rule: PscadErrorCode.FORTRAN_UNINITIALIZED_STOR.rule,
            severity: PscadErrorCode.FORTRAN_UNINITIALIZED_STOR.severity,
            message: PscadErrorCode.FORTRAN_UNINITIALIZED_STOR.message(
              defName,
              seg.name,
              storageSafety.readsStorBeforeWrite,
            ),
            line: baseLine,
          });
        }
      }
      if (dsdynAdv && dsoutAdv && dsdynAdv.nstorf > 0 && dsoutAdv.nstorf > 0 && dsdynAdv.nstorf !== dsoutAdv.nstorf) {
        diagnostics.push({
          code: PscadErrorCode.FORTRAN_UDM_HAZARD.code,
          rule: PscadErrorCode.FORTRAN_UDM_HAZARD.rule,
          severity: PscadErrorCode.FORTRAN_UDM_HAZARD.severity,
          message: PscadErrorCode.FORTRAN_UDM_HAZARD.message(
            defName,
            "Dsout",
            `NSTORF advance in Dsdyn (+${dsdynAdv.nstorf}) mismatches Dsout (+${dsoutAdv.nstorf})`,
          ),
        });
      }
    }
  }

  // 19. M6023: Collinear overlapping wire segments within a module
  if (!isLibraryProject) {
    for (const mod of allModules) {
      for (let wi = 0; wi < mod.wires.length; wi++) {
        const wa = mod.wires[wi]!;
        let overlapped = false;
        for (let si = 0; si < wa.vertices.length - 1 && !overlapped; si++) {
          const a1 = wa.vertices[si]!;
          const a2 = wa.vertices[si + 1]!;
          const aHoriz = Math.abs(a1.y - a2.y) < 1e-3 && Math.abs(a1.x - a2.x) > 1e-3;
          const aVert = Math.abs(a1.x - a2.x) < 1e-3 && Math.abs(a1.y - a2.y) > 1e-3;
          if (!aHoriz && !aVert) continue;

          for (let wj = wi + 1; wj < mod.wires.length && !overlapped; wj++) {
            const wb = mod.wires[wj]!;
            for (let sj = 0; sj < wb.vertices.length - 1; sj++) {
              const b1 = wb.vertices[sj]!;
              const b2 = wb.vertices[sj + 1]!;
              if (aHoriz && Math.abs(b1.y - b2.y) < 1e-3 && Math.abs(b1.y - a1.y) < 1e-3) {
                const lo = Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
                const hi = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x));
                if (hi - lo > 1.0) {
                  diagnostics.push({
                    code: PscadErrorCode.WIRE_OVERLAP.code,
                    rule: PscadErrorCode.WIRE_OVERLAP.rule,
                    severity: PscadErrorCode.WIRE_OVERLAP.severity,
                    message: PscadErrorCode.WIRE_OVERLAP.message(wa.id, wb.id),
                    componentId: wa.id,
                    line: wa.line,
                  });
                  overlapped = true;
                  break;
                }
              } else if (aVert && Math.abs(b1.x - b2.x) < 1e-3 && Math.abs(b1.x - a1.x) < 1e-3) {
                const lo = Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
                const hi = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y));
                if (hi - lo > 1.0) {
                  diagnostics.push({
                    code: PscadErrorCode.WIRE_OVERLAP.code,
                    rule: PscadErrorCode.WIRE_OVERLAP.rule,
                    severity: PscadErrorCode.WIRE_OVERLAP.severity,
                    message: PscadErrorCode.WIRE_OVERLAP.message(wa.id, wb.id),
                    componentId: wa.id,
                    line: wa.line,
                  });
                  overlapped = true;
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  // 20. M6025 & M6026: Vector signal & phase-count port mismatches across wires
  if (!isLibraryProject) {
    for (const mod of allModules) {
      const portInfo = new Map<string, { label: string; kind: string; dim: number; cleanDef: string }>();
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cleanDef = (
          cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
        ).toLowerCase();
        for (const p of cmp.ports) {
          portInfo.set(p.id, {
            label: `${cmp.instanceName || cmp.id}.${p.name || p.id}`,
            kind: p.kind,
            dim: p.dimension || 1,
            cleanDef,
          });
        }
      }

      const VECTOR_ADAPTERS = new Set(["breakout", "datamerge", "datatap"]);
      const ONE_PHASE_DEFS = new Set(["breaker1", "source_1", "source1", "resistor_1", "inductor_1", "capacitor_1"]);
      const THREE_PHASE_DEFS = new Set([
        "source3",
        "source_3",
        "source_3p",
        "xfmr-3p",
        "xfmr-3p2w",
        "breaker3",
        "tline_3p",
      ]);

      for (const w of mod.wires) {
        const infos = w.connectedPortIds.map((pid) => portInfo.get(pid)).filter((x): x is NonNullable<typeof x> => !!x);
        if (infos.length < 2) continue;
        if (infos.some((x) => VECTOR_ADAPTERS.has(x.cleanDef))) continue;

        const sigs = infos.filter((x) => x.kind === "signal");
        if (sigs.length >= 2) {
          const first = sigs[0]!;
          const diff = sigs.find((s) => s.dim !== first.dim);
          if (diff) {
            diagnostics.push({
              code: PscadErrorCode.VECTOR_DIMENSION_MISMATCH.code,
              rule: PscadErrorCode.VECTOR_DIMENSION_MISMATCH.rule,
              severity: PscadErrorCode.VECTOR_DIMENSION_MISMATCH.severity,
              message: PscadErrorCode.VECTOR_DIMENSION_MISMATCH.message(first.label, first.dim, diff.label, diff.dim),
              componentId: w.id,
              line: w.line,
            });
          }
        }

        const elecs = infos.filter((x) => x.kind === "electrical");
        if (elecs.length >= 2) {
          const p3 =
            elecs.find((e) => e.dim === 3 && THREE_PHASE_DEFS.has(e.cleanDef)) ?? elecs.find((e) => e.dim === 3);
          const p1 = elecs.find((e) => e.dim === 1 && ONE_PHASE_DEFS.has(e.cleanDef));
          if (p3 && p1) {
            diagnostics.push({
              code: PscadErrorCode.PHASE_DIMENSION_MISMATCH.code,
              rule: PscadErrorCode.PHASE_DIMENSION_MISMATCH.rule,
              severity: PscadErrorCode.PHASE_DIMENSION_MISMATCH.severity,
              message: PscadErrorCode.PHASE_DIMENSION_MISMATCH.message(w.id, p3.label, p1.label),
              componentId: w.id,
              line: w.line,
            });
          }
        }
      }
    }
  }

  // 21. M6029 & M6030: Parameter expression evaluation errors and duplicate/unwired pgb output channels
  const NUMERIC_PARAM_KEYS = new Set([
    "r",
    "l",
    "c",
    "v",
    "v1",
    "v2",
    "x",
    "mva",
    "kp",
    "ki",
    "ti",
    "t",
    "t1",
    "t2",
    "g",
    "k",
    "value",
    "max",
    "min",
    "ul",
    "ll",
    "f",
    "fc",
    "fsw",
    "basekv",
  ]);
  for (const mod of allModules) {
    const scope = new Map<string, number>();
    for (const [k, v] of Object.entries(mod.parameterDefaults ?? {})) {
      const n = evalParamExpr(v, scope);
      if (n !== undefined && Number.isFinite(n)) scope.set(k, n);
    }

    const pgbSeen = new Set<string>();
    for (const cmp of mod.components) {
      if (cmp.disabled) continue;
      for (const [key, val] of Object.entries(cmp.parameters)) {
        if (!NUMERIC_PARAM_KEYS.has(key.toLowerCase()) || typeof val !== "string") continue;
        const trimmed = val.trim();
        if (!trimmed) continue;
        // Skip string/path values lacking arithmetic syntax unless explicitly NaN/Infinity
        const hasMathOp =
          trimmed.includes("+") ||
          trimmed.includes("-") ||
          trimmed.includes("*") ||
          (trimmed.includes("/") && !trimmed.includes(".fmu")) ||
          trimmed === "NaN" ||
          trimmed === "Infinity";
        if (!hasMathOp) continue;
        const evaluated = evalParamExpr(trimmed, scope);
        if (evaluated === undefined || !Number.isFinite(evaluated)) {
          diagnostics.push({
            code: PscadErrorCode.PARAM_EXPR_ERROR.code,
            rule: PscadErrorCode.PARAM_EXPR_ERROR.rule,
            severity: PscadErrorCode.PARAM_EXPR_ERROR.severity,
            message: PscadErrorCode.PARAM_EXPR_ERROR.message(cmp.instanceName || cmp.id, key, trimmed),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        }
      }

      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      if (!isLibraryProject && cleanDef === "pgb") {
        const chName = String(cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cmp.instanceName ?? "").trim();
        if (chName) {
          if (pgbSeen.has(chName)) {
            diagnostics.push({
              code: PscadErrorCode.PGB_CHANNEL_HAZARD.code,
              rule: PscadErrorCode.PGB_CHANNEL_HAZARD.rule,
              severity: PscadErrorCode.PGB_CHANNEL_HAZARD.severity,
              message: PscadErrorCode.PGB_CHANNEL_HAZARD.message(chName, "has a duplicate output channel label"),
              componentId: cmp.id,
              line: cmp.line,
              column: cmp.column,
            });
          }
          pgbSeen.add(chName);
        }
      }
    }
  }

  // 22. M6044: Zero-impedance closed loops across branches / ideal switches
  if (!isLibraryProject && netlist.branches.length >= 2) {
    const zeroEdges = netlist.branches.filter(
      (br) =>
        br.fromBus !== br.toBus &&
        br.fromBus !== "0" &&
        br.toBus !== "0" &&
        (br.kind === "switch"
          ? br.status !== "open" && (br.rClosedOhm ?? br.resistanceOhm) <= 1e-3
          : br.kind === "rlc" && br.resistanceOhm <= 1e-6 && br.inductanceH <= 1e-9),
    );
    if (zeroEdges.length >= 2) {
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        let p = parent.get(x) ?? x;
        while ((parent.get(p) ?? p) !== p) p = parent.get(p)!;
        parent.set(x, p);
        return p;
      };
      for (const ze of zeroEdges) {
        const ra = find(ze.fromBus);
        const rb = find(ze.toBus);
        if (ra === rb) {
          diagnostics.push({
            code: PscadErrorCode.ZERO_IMPEDANCE_LOOP.code,
            rule: PscadErrorCode.ZERO_IMPEDANCE_LOOP.rule,
            severity: PscadErrorCode.ZERO_IMPEDANCE_LOOP.severity,
            message: PscadErrorCode.ZERO_IMPEDANCE_LOOP.message(`${ze.fromBus} <-> ${ze.toBus} via '${ze.id}'`),
            componentId: ze.id,
          });
          break;
        }
        parent.set(ra, rb);
      }
    }
  }

  // 23. M6060 & M6063: Sound dead-limiter & affine/zonotope relational cancellation analysis
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    const zonoMap = analyzeControlZonotopes(netlist.controlBlocks);
    for (const b of netlist.controlBlocks) {
      const zEntry = zonoMap.get(b.id);
      if (zEntry?.tightenedByZonotope && (b.kind === "sum" || b.kind === "limit")) {
        const loc = cmpLocationMap.get(b.componentId ?? b.id);
        diagnostics.push({
          code: PscadErrorCode.CSMF_RELATIONAL_CANCELATION.code,
          rule: PscadErrorCode.CSMF_RELATIONAL_CANCELATION.rule,
          severity: PscadErrorCode.CSMF_RELATIONAL_CANCELATION.severity,
          message: PscadErrorCode.CSMF_RELATIONAL_CANCELATION.message(
            b.id,
            zEntry.interval.lo,
            zEntry.interval.hi,
            zEntry.plainInterval.lo,
            zEntry.plainInterval.hi,
          ),
          componentId: b.componentId ?? b.id,
          line: loc?.line,
          column: loc?.column,
        });
      }
      if (b.kind !== "limit" || b.inputs.length !== 1) continue;
      const input = zonoMap.get(b.inputs[0]!)?.interval;
      if (!input || !isBounded(input)) continue;
      const lim = outputLimits(b);
      if (Number.isFinite(lim.lo) && Number.isFinite(lim.hi) && input.lo > lim.lo && input.hi < lim.hi) {
        const loc = cmpLocationMap.get(b.componentId ?? b.id);
        diagnostics.push({
          code: PscadErrorCode.DEAD_LIMITER.code,
          rule: PscadErrorCode.DEAD_LIMITER.rule,
          severity: PscadErrorCode.DEAD_LIMITER.severity,
          message: PscadErrorCode.DEAD_LIMITER.message(b.id, input.lo, input.hi, lim.lo, lim.hi),
          componentId: b.componentId ?? b.id,
          line: loc?.line,
          column: loc?.column,
        });
      }
    }
  }

  // 24. M6027: Hierarchical submodule port interface mismatch
  if (!isLibraryProject && project.subModules.size > 0) {
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        if (cmp.disabled || cmp.ports.length === 0) continue;
        const shortDef = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;
        const targetSub = project.subModules.get(cmp.definitionName) ?? project.subModules.get(shortDef);
        if (!targetSub) continue;
        const boundaryPorts = new Set<string>();
        for (const sc of targetSub.components) {
          const sDef = (
            sc.definitionName.includes(":") ? sc.definitionName.split(":").pop()! : sc.definitionName
          ).toLowerCase();
          if (sDef === "xnode" || sDef === "pin" || sDef === "import" || sDef === "export") {
            const pname = String(sc.parameters["Name"] ?? sc.parameters["name"] ?? sc.instanceName ?? "")
              .trim()
              .toLowerCase();
            if (pname) boundaryPorts.add(pname);
          }
        }
        if (boundaryPorts.size === 0) continue;
        for (const p of cmp.ports) {
          if (p.name && !boundaryPorts.has(p.name.toLowerCase())) {
            diagnostics.push({
              code: PscadErrorCode.SUBMODULE_INTERFACE_MISMATCH.code,
              rule: PscadErrorCode.SUBMODULE_INTERFACE_MISMATCH.rule,
              severity: PscadErrorCode.SUBMODULE_INTERFACE_MISMATCH.severity,
              message: PscadErrorCode.SUBMODULE_INTERFACE_MISMATCH.message(
                cmp.instanceName || cmp.id,
                shortDef,
                `port '${p.name}' does not exist in submodule definition`,
              ),
              componentId: cmp.id,
              line: cmp.line,
              column: cmp.column,
            });
            break;
          }
        }
      }
    }
  }

  // 25. M6043: Current-source or open-switch inductive cutsets without parallel damping path
  if (!isLibraryProject && netlist.currentSources && netlist.currentSources.length > 0) {
    for (const cs of netlist.currentSources) {
      const attached = netlist.branches.filter((b) => b.fromBus === cs.bus || b.toBus === cs.bus);
      const hasExternalLoadOrSwitch = attached.some(
        (b) =>
          (b.kind === "switch" && b.status !== "open") ||
          (b.kind !== "switch" && b.capacitanceF > 0) ||
          b.resistanceOhm > 0,
      );
      if (attached.length === 0 || !hasExternalLoadOrSwitch) {
        const loc = cmpLocationMap.get(cs.id);
        diagnostics.push({
          code: PscadErrorCode.INDUCTIVE_CUTSET_HAZARD.code,
          rule: PscadErrorCode.INDUCTIVE_CUTSET_HAZARD.rule,
          severity: PscadErrorCode.INDUCTIVE_CUTSET_HAZARD.severity,
          message: PscadErrorCode.INDUCTIVE_CUTSET_HAZARD.message(cs.name || cs.id, cs.bus),
          componentId: cs.id,
          busId: cs.bus,
          line: loc?.line,
          column: loc?.column,
        });
      }
    }
  }

  // 26. M6046: Dommel nodal conductance matrix conditioning ratio (G_max / G_min > 1e11)
  if (!isLibraryProject && netlist.branches.length >= 1) {
    let gMin = Infinity;
    let gMax = 0;
    const stepS = (project.settings.timeStepUs || 50) * 1e-6;
    for (const br of netlist.branches) {
      if (br.kind === "switch") {
        const rOn = br.rClosedOhm ?? (br.status !== "open" ? br.resistanceOhm : undefined);
        const rOff = br.rOpenOhm ?? (br.status === "open" ? br.resistanceOhm : undefined);
        if (rOn !== undefined && rOn > 0) {
          const gOn = 1 / rOn;
          if (gOn > gMax) gMax = gOn;
          if (gOn < gMin) gMin = gOn;
        }
        if (rOff !== undefined && rOff > 0) {
          const gOff = 1 / rOff;
          if (gOff > gMax) gMax = gOff;
          if (gOff < gMin) gMin = gOff;
        }
      } else if (br.kind === "rlc") {
        const g = br.resistanceOhm > 0 ? 1 / br.resistanceOhm : br.inductanceH > 0 ? stepS / (2 * br.inductanceH) : 0;
        if (g > 0) {
          if (g > gMax) gMax = g;
          if (g < gMin) gMin = g;
        }
      }
    }
    if (gMin > 0 && Number.isFinite(gMin) && gMax > 0 && gMax / gMin > 1e11) {
      diagnostics.push({
        code: PscadErrorCode.NODAL_ILL_CONDITIONED.code,
        rule: PscadErrorCode.NODAL_ILL_CONDITIONED.rule,
        severity: PscadErrorCode.NODAL_ILL_CONDITIONED.severity,
        message: PscadErrorCode.NODAL_ILL_CONDITIONED.message(gMax / gMin, gMax, gMin),
      });
    }
  }

  // 27. M6064: High-bandwidth SRF-PLL coupled to weak AC grid (SCR < 2.0)
  if (!isLibraryProject && netlist.fmuInstances.length > 0 && netlist.sources.length > 0) {
    let minScr = Infinity;
    const totalIbrMva = netlist.fmuInstances.reduce((acc, f) => acc + Math.max(1, f.ratedMva), 0);
    for (const src of netlist.sources) {
      if (src.dc) continue;
      const omega = 2 * Math.PI * (src.frequencyHz || 60);
      const zMag = Math.hypot(src.rSourceOhm ?? 0, omega * (src.lSourceH ?? 0));
      const busKv = netlist.buses.get(src.bus)?.baseKv || src.vPeakKv * Math.SQRT1_2 || 230;
      if (zMag > 1e-4 && busKv > 0) {
        const sScMva = (busKv * busKv) / zMag;
        const scr = sScMva / totalIbrMva;
        if (scr < minScr) minScr = scr;
      }
    }
    if (minScr < 2.0) {
      for (const mod of allModules) {
        for (const cmp of mod.components) {
          if (cmp.disabled) continue;
          const cleanDef = (
            cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
          ).toLowerCase();
          if (!cleanDef.includes("pll")) continue;
          const kp = readNumParam(cmp.parameters, ["Kp", "kp", "K_p", "Wp", "wp"]);
          const ki = readNumParam(cmp.parameters, ["Ki", "ki", "K_i"]);
          const estBwHz =
            ki !== undefined && ki > 0 ? Math.sqrt(ki) / (2 * Math.PI) : kp !== undefined && kp > 0 ? kp : 0;
          if (estBwHz > 25.0) {
            diagnostics.push({
              code: PscadErrorCode.PLL_WEAK_GRID_INSTABILITY.code,
              rule: PscadErrorCode.PLL_WEAK_GRID_INSTABILITY.rule,
              severity: PscadErrorCode.PLL_WEAK_GRID_INSTABILITY.severity,
              message: PscadErrorCode.PLL_WEAK_GRID_INSTABILITY.message(cmp.instanceName || cmp.id, estBwHz, minScr),
              componentId: cmp.id,
              line: cmp.line,
              column: cmp.column,
            });
          }
        }
      }
    }
  }

  // 28. M6028: Unlowered / dropped simulatable components from computeSimulationCoverage
  if (!isLibraryProject) {
    const cov = analyzeSimulationCoverage(project, netlist);
    for (const cmp of cov.unlowered) {
      if (cmp.disabled) continue;
      diagnostics.push({
        code: PscadErrorCode.UNLOWERED_COMPONENT.code,
        rule: PscadErrorCode.UNLOWERED_COMPONENT.rule,
        severity: PscadErrorCode.UNLOWERED_COMPONENT.severity,
        message: PscadErrorCode.UNLOWERED_COMPONENT.message(cmp.instanceName || cmp.id, cmp.definitionName),
        componentId: cmp.id,
        line: cmp.line,
        column: cmp.column,
      });
    }
  }

  // 29. M6032: AC source L-L RMS vs peak/L-G voltage entry suspicion against explicit bus baseKv
  if (!isLibraryProject) {
    for (const src of netlist.sources) {
      if (src.dc || src.vPeakKv <= 0) continue;
      const bus = netlist.buses.get(src.bus);
      if (!bus || !bus.explicitBaseKv || bus.baseKv <= 0) continue;
      const cmp = [...allModules.flatMap((m) => m.components)].find(
        (c) => (c.id === src.id || src.id.endsWith(`_${c.id}`)) && !c.disabled,
      );
      const isLlRmsParam =
        cmp !== undefined &&
        (cmp.parameters["V"] !== undefined || cmp.parameters["Vbase"] !== undefined) &&
        cmp.parameters["Vm"] === undefined;
      if (!isLlRmsParam) continue;
      const ratio = src.vPeakKv / bus.baseKv;
      let hint: string | undefined;
      if (Math.abs(ratio - Math.SQRT2) < 0.03) {
        hint = "factor sqrt(2) ≈ 1.414 (looks like L-L peak entered as L-L RMS)";
      } else if (Math.abs(ratio - Math.sqrt(2 / 3)) < 0.03) {
        hint = "factor sqrt(2/3) ≈ 0.816 (looks like L-G peak entered as L-L RMS)";
      } else if (Math.abs(ratio - 1 / Math.sqrt(3)) < 0.03) {
        hint = "factor 1/sqrt(3) ≈ 0.577 (looks like L-G RMS entered as L-L RMS)";
      } else if (Math.abs(ratio - Math.sqrt(3)) < 0.04) {
        hint = "factor sqrt(3) ≈ 1.732 (looks like L-L vs L-G confusion)";
      }
      if (hint) {
        diagnostics.push({
          code: PscadErrorCode.RMS_PEAK_VOLTAGE_SUSPECT.code,
          rule: PscadErrorCode.RMS_PEAK_VOLTAGE_SUSPECT.rule,
          severity: PscadErrorCode.RMS_PEAK_VOLTAGE_SUSPECT.severity,
          message: PscadErrorCode.RMS_PEAK_VOLTAGE_SUSPECT.message(src.name, src.vPeakKv, bus.name, bus.baseKv, hint),
          componentId: cmp?.id ?? src.id,
          line: cmp?.line,
          column: cmp?.column,
        });
      }
    }
  }

  // 30. M6042: Plot/channel sampling step aliasing hazard with power-electronic switching
  if (
    !isLibraryProject &&
    project.settings.plotStepUs !== undefined &&
    project.settings.timeStepUs > 0 &&
    project.settings.plotStepUs > 10 * project.settings.timeStepUs &&
    project.settings.plotStepUs > 250 &&
    ((netlist.converterBridges?.length ?? 0) > 0 || netlist.fmuInstances.length > 0)
  ) {
    const nyquistHz = 1e6 / (2 * project.settings.plotStepUs);
    diagnostics.push({
      code: PscadErrorCode.PLOT_STEP_ALIASING.code,
      rule: PscadErrorCode.PLOT_STEP_ALIASING.rule,
      severity: PscadErrorCode.PLOT_STEP_ALIASING.severity,
      message: PscadErrorCode.PLOT_STEP_ALIASING.message(
        project.settings.plotStepUs,
        project.settings.timeStepUs,
        nyquistHz,
      ),
    });
  }

  // 31. M6045: Switching valve/bridge without RC snubber when CDA is disabled
  if (!isLibraryProject && !project.settings.enableCda) {
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const cleanDef = (
          cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
        ).toLowerCase();
        const isValve =
          cleanDef.includes("thyristor") ||
          cleanDef === "diode" ||
          cleanDef.endsWith("_diode") ||
          cleanDef.includes("igbt") ||
          cleanDef.includes("gto") ||
          cleanDef.includes("bridge_6p") ||
          cleanDef.includes("vsc_bridge");
        if (!isValve) continue;
        const hasSnubber =
          readNumParam(cmp.parameters, ["Rsnub", "Csnub", "Rs", "Cs", "R_snub", "C_snub", "Rsn"]) !== undefined;
        if (!hasSnubber) {
          diagnostics.push({
            code: PscadErrorCode.MISSING_SWITCH_SNUBBER.code,
            rule: PscadErrorCode.MISSING_SWITCH_SNUBBER.rule,
            severity: PscadErrorCode.MISSING_SWITCH_SNUBBER.severity,
            message: PscadErrorCode.MISSING_SWITCH_SNUBBER.message(cmp.instanceName || cmp.id, cmp.definitionName),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        }
      }
    }
  }

  // 32. M6047: ULM / FD-Line rational vector-fitting passivity violation
  for (const line of netlist.transmissionLines) {
    if (line.poles && line.residues && line.poles.length > 0 && line.residues.length === line.poles.length) {
      const rep = checkRationalPassivity(line.poles, line.residues, line.d0 ?? 0);
      if (!rep.passive) {
        const detail = rep.hasUnstablePole
          ? "contains unstable pole Re(p_m) >= 0"
          : `Re{Y(jω)} = ${rep.minRealPart.toExponential(2)} < 0 near ${rep.worstFreqHz.toFixed(1)} Hz`;
        diagnostics.push({
          code: PscadErrorCode.ULM_PASSIVITY_VIOLATION.code,
          rule: PscadErrorCode.ULM_PASSIVITY_VIOLATION.rule,
          severity: PscadErrorCode.ULM_PASSIVITY_VIOLATION.severity,
          message: PscadErrorCode.ULM_PASSIVITY_VIOLATION.message(line.id, detail),
          componentId: line.id,
        });
      }
    }
  }

  // 33. M6048: Saturable transformer magnetizing knee, inductance ordering & remanence bounds
  for (const xf of netlist.transformers) {
    if (!xf.saturation) continue;
    let detail: string | undefined;
    if (xf.lSatH !== undefined && xf.lSatH <= 0) {
      detail = `saturated air-core inductance L_sat=${xf.lSatH} H must be > 0`;
    } else if (xf.lUnsatH !== undefined && xf.lSatH !== undefined && xf.lSatH >= xf.lUnsatH) {
      detail = `saturated inductance L_sat (${xf.lSatH} H) >= unsaturated inductance L_unsat (${xf.lUnsatH} H)`;
    } else if (xf.kneeFluxWb !== undefined && xf.kneeFluxWb <= 0) {
      detail = `knee flux linkage (${xf.kneeFluxWb} Wb) must be > 0`;
    } else if (
      xf.remanentFluxWb !== undefined &&
      xf.kneeFluxWb !== undefined &&
      Math.abs(xf.remanentFluxWb) > Math.abs(xf.kneeFluxWb) * 1.05
    ) {
      detail = `|remanentFlux| (${Math.abs(xf.remanentFluxWb).toFixed(1)} Wb) exceeds kneeFlux (${xf.kneeFluxWb.toFixed(1)} Wb)`;
    }
    if (detail) {
      diagnostics.push({
        code: PscadErrorCode.TRANSFORMER_SATURATION_INVALID.code,
        rule: PscadErrorCode.TRANSFORMER_SATURATION_INVALID.rule,
        severity: PscadErrorCode.TRANSFORMER_SATURATION_INVALID.severity,
        message: PscadErrorCode.TRANSFORMER_SATURATION_INVALID.message(xf.id, detail),
        componentId: xf.id,
      });
    }
  }

  // 34. M6049: Series capacitor + inductive branch subsynchronous series resonance (5–55 Hz)
  if (!isLibraryProject && netlist.branches.length > 0) {
    const fBase = project.settings.frequencyHz > 0 ? project.settings.frequencyHz : 60.0;
    const indByBus = new Map<string, { id: string; lH: number }[]>();
    const addInd = (busId: string, id: string, lH: number) => {
      if (lH <= 0) return;
      let list = indByBus.get(busId);
      if (!list) {
        list = [];
        indByBus.set(busId, list);
      }
      list.push({ id, lH });
    };
    for (const br of netlist.branches) {
      if (br.kind === "rlc" && br.inductanceH > 0) {
        addInd(br.fromBus, br.id, br.inductanceH);
        addInd(br.toBus, br.id, br.inductanceH);
      }
    }
    for (const ln of netlist.transmissionLines) {
      const lH = ln.lPerKm * ln.lengthKm;
      if (lH > 0) {
        addInd(ln.fromBus, ln.id, lH);
        addInd(ln.toBus, ln.id, lH);
      }
    }
    for (const br of netlist.branches) {
      if (br.kind !== "rlc" || br.capacitanceF <= 0 || br.inductanceH > 0 || br.fromBus === br.toBus) continue;
      // Only examine series (two-terminal ungrounded) capacitors
      if (br.fromBus === "0" || br.toBus === "0" || br.fromBus === "GND" || br.toBus === "GND") continue;
      const adj = [...(indByBus.get(br.fromBus) ?? []), ...(indByBus.get(br.toBus) ?? [])];
      if (adj.length === 0) continue;
      const bestInd = adj.reduce((a, b) => (a.lH >= b.lH ? a : b));
      const fResHz = 1.0 / (2.0 * Math.PI * Math.sqrt(bestInd.lH * br.capacitanceF));
      if (fResHz >= 5.0 && fResHz <= 0.92 * fBase) {
        diagnostics.push({
          code: PscadErrorCode.SUBSYNCHRONOUS_RESONANCE_RISK.code,
          rule: PscadErrorCode.SUBSYNCHRONOUS_RESONANCE_RISK.rule,
          severity: PscadErrorCode.SUBSYNCHRONOUS_RESONANCE_RISK.severity,
          message: PscadErrorCode.SUBSYNCHRONOUS_RESONANCE_RISK.message(br.id, bestInd.id, fResHz, fBase),
          componentId: br.id,
        });
      }
    }
  }

  // 35. M6068: OEM black-box DLL ABI header & hardware dongle metadata preflight
  if (!isLibraryProject) {
    for (const blk of netlist.customFortranBlocks ?? []) {
      if (blk.binaryBuffer) {
        const buf = blk.binaryBuffer;
        const isPe = buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a;
        const isElf = buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
        if (!isPe && !isElf) {
          diagnostics.push({
            code: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.code,
            rule: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.rule,
            severity: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.severity,
            message: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.message(
              blk.name || blk.id,
              "binaryBuffer lacks valid PE ('MZ') or ELF binary header",
            ),
            componentId: blk.id,
          });
        }
      }
      if (blk.requireHardwareDongle && blk.drmFirmCode === undefined) {
        diagnostics.push({
          code: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.code,
          rule: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.rule,
          severity: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.severity,
          message: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.message(
            blk.name || blk.id,
            "requires hardware dongle without specifying drmFirmCode/drmProductCode",
          ),
          componentId: blk.id,
        });
      }
    }
    for (const mod of allModules) {
      for (const cmp of mod.components) {
        if (cmp.disabled) continue;
        const dllParam = String(
          cmp.parameters["dll_path"] ?? cmp.parameters["DllPath"] ?? cmp.parameters["binary"] ?? "",
        ).trim();
        const reqDongle =
          String(cmp.parameters["requireHardwareDongle"] ?? cmp.parameters["dongle"] ?? "0").toLowerCase() === "1" ||
          String(cmp.parameters["requireHardwareDongle"] ?? "").toLowerCase() === "true";
        const hasFirm = cmp.parameters["drmFirmCode"] !== undefined || cmp.parameters["firmCode"] !== undefined;
        if (
          (dllParam.toLowerCase().endsWith(".dll") || dllParam.toLowerCase().endsWith(".so")) &&
          (reqDongle ? !hasFirm : true)
        ) {
          diagnostics.push({
            code: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.code,
            rule: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.rule,
            severity: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.severity,
            message: PscadErrorCode.OEM_DLL_ABI_OR_LICENSE.message(
              cmp.instanceName || cmp.id,
              reqDongle && !hasFirm
                ? `external DLL '${dllParam}' requires hardware dongle without drmFirmCode`
                : `external native DLL '${dllParam}' requires Wasm-Machina companion metadata for standalone portability`,
            ),
            componentId: cmp.id,
            line: cmp.line,
            column: cmp.column,
          });
        }
      }
    }
  }

  // 36. M6080 & M6081: Formal BMC breaker/relay deadlock check & DDE delay feedback stability check
  if (!isLibraryProject && netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    diagnostics.push(...verifyProtectionRelayBmc(netlist.controlBlocks));
    diagnostics.push(...verifyControlDelayStability(netlist.controlBlocks, (project.settings.timeStepUs || 50) * 1e-6));
  }

  // 37. M6082: Certified Zonotope reachability envelope for grid-tied converters/IBRs
  if (!isLibraryProject && ((netlist.converterBridges?.length ?? 0) > 0 || netlist.fmuInstances.length > 0)) {
    const reach = verifyConverterReachability(netlist);
    diagnostics.push(...reach.diagnostics);
  }

  return diagnostics;
}

export * from "./workspace.js";
