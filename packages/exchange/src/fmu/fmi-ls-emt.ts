// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI 3.0 Layered Standard for Electromagnetic Transients (`fmi-ls-emt`).
 *
 * Defines a non-breaking FMI 3.0 layered standard (`org.fmi-standard.fmi-ls-emt`)
 * enabling simultaneous Dommel Norton-companion nodal stamping (`G_eq`, `I_hist`)
 * and post-solve `doStep(t, dt, v_node)` state updates without 1-step co-simulation delay.
 */

export const FMI_LS_EMT_ANNOTATION_TYPE = "org.fmi-standard.fmi-ls-emt";

export interface FmiLsEmtTerminalBinding {
  /** Terminal name matching `terminalsAndIcons.xml` `<Terminal name="...">`. */
  terminalName: string;
  /** Number of electrical nodes/phases (1 for single-phase, 3 for 3-phase). */
  phases: number;
  /** Input variable name receiving solved bus voltages `[v_a, v_b, v_c]` (V). */
  vNodeVar: string;
  /** Output variable name providing flattened `phases x phases` companion conductance matrix (S). */
  gEqVar: string;
  /** Output variable name providing `phases`-length Norton history current vector (A). */
  iHistVar: string;
}

export interface FmiLsEmtManifest {
  version: string;
  supportsHalfStepCda: boolean;
  supportsNewtonIteration: boolean;
  terminals: FmiLsEmtTerminalBinding[];
}

/**
 * Runtime Norton-companion callback contract implemented by `fmi-ls-emt` FMUs or WASM modules.
 */
export interface FmiLsEmtCompanionInstance {
  /** Phase 1 (Pre-solve): return `gEq` (`phases x phases` row-major S) and `iHist` (`phases` A) at time `t`. */
  stampCompanion(
    tSec: number,
    dtSec: number,
  ): {
    gEq: ArrayLike<number>;
    iHist: ArrayLike<number>;
  };
  /** Phase 2 (Post-solve): advance internal companion states given solved terminal voltages `vNode` (V). */
  doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>): void;
}

function attrOf(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return attrs.match(re)?.[1];
}

/**
 * Parses `org.fmi-standard.fmi-ls-emt` `<Annotation>` blocks from `modelDescription.xml`.
 */
export function parseFmiLsEmtAnnotations(modelDescriptionXml: string): FmiLsEmtManifest | undefined {
  const annRe = /<Annotation\b([^>]*)>([\s\S]*?)<\/Annotation>/gi;
  let match: RegExpExecArray | null;
  while ((match = annRe.exec(modelDescriptionXml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (attrOf(attrs, "type") !== FMI_LS_EMT_ANNOTATION_TYPE) continue;

    const emtBlock = body.match(/<EmtCompanion\b([^>]*)>([\s\S]*?)<\/EmtCompanion>/i);
    const emtAttrs = emtBlock?.[1] ?? attrs;
    const emtBody = emtBlock?.[2] ?? body;

    const terminals: FmiLsEmtTerminalBinding[] = [];
    const termRe = /<EmtTerminal\b([^>]*)\/?>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = termRe.exec(emtBody)) !== null) {
      const tAttrs = tMatch[1] ?? "";
      terminals.push({
        terminalName: attrOf(tAttrs, "terminalName") ?? "Term",
        phases: Math.max(1, Number(attrOf(tAttrs, "phases") ?? "3") || 3),
        vNodeVar: attrOf(tAttrs, "vNodeVar") ?? "v_node",
        gEqVar: attrOf(tAttrs, "gEqVar") ?? "G_eq",
        iHistVar: attrOf(tAttrs, "iHistVar") ?? "I_hist",
      });
    }

    return {
      version: attrOf(emtAttrs, "version") ?? "1.0",
      supportsHalfStepCda: attrOf(emtAttrs, "supportsHalfStepCda") === "true",
      supportsNewtonIteration: attrOf(emtAttrs, "supportsNewtonIteration") === "true",
      terminals,
    };
  }
  return undefined;
}

/**
 * Generates an FMI 3.0 `<Annotation type="org.fmi-standard.fmi-ls-emt">` XML block
 * for inclusion in `modelDescription.xml`.
 */
export function generateFmiLsEmtAnnotationXml(manifest: FmiLsEmtManifest): string {
  const terms = manifest.terminals
    .map(
      (t) =>
        `      <EmtTerminal terminalName="${t.terminalName}" phases="${t.phases}" vNodeVar="${t.vNodeVar}" gEqVar="${t.gEqVar}" iHistVar="${t.iHistVar}"/>`,
    )
    .join("\n");
  return [
    `<Annotation type="${FMI_LS_EMT_ANNOTATION_TYPE}">`,
    `  <EmtCompanion version="${manifest.version}" supportsHalfStepCda="${manifest.supportsHalfStepCda}" supportsNewtonIteration="${manifest.supportsNewtonIteration}">`,
    terms,
    `  </EmtCompanion>`,
    `</Annotation>`,
  ].join("\n");
}
