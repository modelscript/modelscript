// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 Layered Standard for Phasor / RMS Electromechanical Transients (`fmi-ls-rms`).
 *
 * Defines a non-breaking FMI 3.0 layered standard (`org.fmi-standard.fmi-ls-rms`)
 * enabling simultaneous positive-sequence Norton-companion nodal stamping
 * (`G_eq`, `B_eq`, `Ir_hist`, `Ii_hist`) and post-solve `doStep(t, dt, vr, vi)`
 * state updates in RMS transient stability solvers without 1-step co-simulation delay.
 */

export const FMI_LS_RMS_ANNOTATION_TYPE = "org.fmi-standard.fmi-ls-rms";

export interface FmiLsRmsTerminalBinding {
  /** Terminal name matching `terminalsAndIcons.xml` `<Terminal name="...">`. */
  terminalName: string;
  /** Default PSS/E bus number or parameter name holding the attached bus number. */
  busIdVar: string;
  /** Input variable name receiving solved bus real voltage `Vr` (pu). */
  vrVar: string;
  /** Input variable name receiving solved bus imaginary voltage `Vi` (pu). */
  viVar: string;
  /** Output variable name providing Norton equivalent conductance `G_eq` (pu). */
  gEqVar: string;
  /** Output variable name providing Norton equivalent susceptance `B_eq` (pu). */
  bEqVar: string;
  /** Output variable name providing Norton history current real part `Ir_hist` (pu). */
  irHistVar: string;
  /** Output variable name providing Norton history current imaginary part `Ii_hist` (pu). */
  iiHistVar: string;
}

export interface FmiLsRmsManifest {
  version: string;
  supportsNewtonIteration: boolean;
  terminals: FmiLsRmsTerminalBinding[];
}

/**
 * Runtime Norton-companion callback contract implemented by `fmi-ls-rms` FMUs or WASM modules.
 */
export interface FmiLsRmsCompanionInstance {
  /** Attached bus number in the PSS/E network. */
  busNumber: number;
  /** Optional equipment/machine identifier. */
  machineId?: string | undefined;
  /** Phase 1 (Pre-solve): return positive-sequence Norton `(gEq, bEq, irHist, iiHist)` in pu at time `t`. */
  stampNorton(
    tSec: number,
    dtSec: number,
  ): {
    gEq: number;
    bEq: number;
    irHist: number;
    iiHist: number;
  };
  /** Phase 2 (Post-solve): advance internal states given solved bus phasor `(vr, vi)` in pu. */
  doStep(tSec: number, dtSec: number, vr: number, vi: number): void;
}

function attrOf(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return attrs.match(re)?.[1];
}

/**
 * Parses `org.fmi-standard.fmi-ls-rms` `<Annotation>` blocks from `modelDescription.xml`.
 */
export function parseFmiLsRmsAnnotations(modelDescriptionXml: string): FmiLsRmsManifest | undefined {
  const annRe = /<Annotation\b([^>]*)>([\s\S]*?)<\/Annotation>/gi;
  let match: RegExpExecArray | null;
  while ((match = annRe.exec(modelDescriptionXml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (attrOf(attrs, "type") !== FMI_LS_RMS_ANNOTATION_TYPE) continue;

    const rmsBlock = body.match(/<RmsCompanion\b([^>]*)>([\s\S]*?)<\/RmsCompanion>/i);
    const rmsAttrs = rmsBlock?.[1] ?? attrs;
    const rmsBody = rmsBlock?.[2] ?? body;

    const terminals: FmiLsRmsTerminalBinding[] = [];
    const termRe = /<RmsTerminal\b([^>]*)\/?>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = termRe.exec(rmsBody)) !== null) {
      const tAttrs = tMatch[1] ?? "";
      terminals.push({
        terminalName: attrOf(tAttrs, "terminalName") ?? "BusTerm",
        busIdVar: attrOf(tAttrs, "busIdVar") ?? "bus_id",
        vrVar: attrOf(tAttrs, "vrVar") ?? "vr",
        viVar: attrOf(tAttrs, "viVar") ?? "vi",
        gEqVar: attrOf(tAttrs, "gEqVar") ?? "G_eq",
        bEqVar: attrOf(tAttrs, "bEqVar") ?? "B_eq",
        irHistVar: attrOf(tAttrs, "irHistVar") ?? "Ir_hist",
        iiHistVar: attrOf(tAttrs, "iiHistVar") ?? "Ii_hist",
      });
    }

    return {
      version: attrOf(rmsAttrs, "version") ?? "1.0",
      supportsNewtonIteration: attrOf(rmsAttrs, "supportsNewtonIteration") === "true",
      terminals,
    };
  }
  return undefined;
}

/**
 * Generates an FMI 3.0 `<Annotation type="org.fmi-standard.fmi-ls-rms">` XML block
 * for inclusion in `modelDescription.xml`.
 */
export function generateFmiLsRmsAnnotationXml(manifest: FmiLsRmsManifest): string {
  const terms = manifest.terminals
    .map(
      (t) =>
        `      <RmsTerminal terminalName="${t.terminalName}" busIdVar="${t.busIdVar}" vrVar="${t.vrVar}" viVar="${t.viVar}" gEqVar="${t.gEqVar}" bEqVar="${t.bEqVar}" irHistVar="${t.irHistVar}" iiHistVar="${t.iiHistVar}"/>`,
    )
    .join("\n");
  return [
    `<Annotation type="${FMI_LS_RMS_ANNOTATION_TYPE}">`,
    `  <RmsCompanion version="${manifest.version}" supportsNewtonIteration="${manifest.supportsNewtonIteration}">`,
    terms,
    `  </RmsCompanion>`,
    `</Annotation>`,
  ].join("\n");
}

/**
 * Generates a clean-room AssemblyScript FMI 3.0 C-ABI + `fmi-ls-rms` Norton-companion
 * module source ready to compile to WebAssembly via `compileAsToWasm`.
 */
export function generateFmiLsRmsAsStub(
  modelName: string,
  options?: { gEq?: number | undefined; bEq?: number | undefined },
): string {
  const gEq = options?.gEq ?? 0.05;
  const bEq = options?.bEq ?? -0.02;
  return `// Clean-room FMI 3.0 + fmi-ls-rms Norton-companion stub for ${modelName}
// ValueReferences: 1=vr, 2=vi, 3=G_eq, 4=B_eq, 5=Ir_hist, 6=Ii_hist

let _vr: f64 = 1.0;
let _vi: f64 = 0.0;
let _gEq: f64 = ${gEq};
let _bEq: f64 = ${bEq};
let _irHist: f64 = 0.01;
let _iiHist: f64 = 0.0;

export function fmi3InstantiateCoSimulation(
  _name: usize,
  _token: usize,
  _resLoc: usize,
  _vis: i32,
  _log: i32,
  _evtMode: i32,
  _early: i32,
  _reqVars: usize,
  _nReq: usize,
  _cb: usize
): usize {
  return 1;
}

export function fmi3EnterInitializationMode(
  _c: usize,
  _tolDef: i32,
  _tol: f64,
  _t0: f64,
  _stopDef: i32,
  _stop: f64
): i32 {
  return 0;
}

export function fmi3ExitInitializationMode(_c: usize): i32 {
  return 0;
}

export function fmi3SetFloat64(_c: usize, vrs: usize, nvr: usize, vals: usize, _nvals: usize): i32 {
  for (let i: usize = 0; i < nvr; i++) {
    const vr = load<u32>(vrs + i * 4);
    const val = load<f64>(vals + i * 8);
    if (vr == 1) _vr = val;
    else if (vr == 2) _vi = val;
    else if (vr == 3) _gEq = val;
    else if (vr == 4) _bEq = val;
    else if (vr == 5) _irHist = val;
    else if (vr == 6) _iiHist = val;
  }
  return 0;
}

export function fmi3GetFloat64(_c: usize, vrs: usize, nvr: usize, vals: usize, _nvals: usize): i32 {
  for (let i: usize = 0; i < nvr; i++) {
    const vr = load<u32>(vrs + i * 4);
    let out: f64 = 0.0;
    if (vr == 1) out = _vr;
    else if (vr == 2) out = _vi;
    else if (vr == 3) out = _gEq;
    else if (vr == 4) out = _bEq;
    else if (vr == 5) out = _irHist;
    else if (vr == 6) out = _iiHist;
    store<f64>(vals + i * 8, out);
  }
  return 0;
}

export function fmi3DoStep(
  _c: usize,
  _t: f64,
  dt: f64,
  _noSet: i32,
  _evt: usize,
  _term: usize,
  _early: usize,
  _lastT: usize
): i32 {
  const alpha: f64 = dt > 0.0 ? dt / (0.05 + dt) : 0.1;
  _irHist = _irHist + alpha * (0.01 * _vr - _irHist);
  _iiHist = _iiHist + alpha * (0.01 * _vi - _iiHist);
  return 0;
}
`;
}
