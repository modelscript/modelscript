// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for `@modelscript/gaussian` (GAU1001–GAU5006).
 */

import { lookupGaussianModelSchema } from "../catalog/library-package-adapter.js";
import { lookupElement } from "../elements.js";
import { GaussianErrorCode } from "../errors.js";
import { parseGaussianInput, resolveValueRef } from "../parser/gjf-parser.js";
import { areCollinear, bondDistance, zmatrixToCartesian } from "../solver/nerf.js";
import type {
  CartesianAtom,
  GaussianAtomSpec,
  GaussianInputDocument,
  GaussianJobStep,
  GaussianValueRef,
} from "../types.js";

export interface GaussianDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  stepIndex?: number | undefined;
}

const VALID_MEM_REGEX = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb|kw|mw|gw|tw|b|w)?$/i;
const VALID_NPROC_REGEX = /^(\d+)$/;

function checkValueRefDefined(
  ref: GaussianValueRef | undefined,
  atom: GaussianAtomSpec,
  job: GaussianJobStep,
  diagnostics: GaussianDiagnostic[],
): number | undefined {
  if (!ref) return undefined;
  const resolved = resolveValueRef(ref, job.variables, job.constants);
  if (resolved === undefined && ref.kind === "variable" && ref.variableName) {
    const def = GaussianErrorCode.UNDEFINED_ZMATRIX_VARIABLE;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(ref.variableName, atom.index),
      line: atom.line,
      column: 1,
      startOffset: atom.startOffset,
      endOffset: atom.endOffset,
      stepIndex: job.stepIndex,
    });
  }
  return resolved;
}

function lintJobStep(job: GaussianJobStep, diagnostics: GaussianDiagnostic[]): void {
  // 1. Validate Link0 directives (%mem, %nproc, %nprocshared)
  for (const cmd of job.link0) {
    if (cmd.directive === "mem") {
      const val = cmd.value ?? "";
      const m = VALID_MEM_REGEX.exec(val.trim());
      if (!m || Number(m[1]) <= 0) {
        const def = GaussianErrorCode.INVALID_MEM_DIRECTIVE;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(val),
          line: cmd.line,
          column: 1,
          startOffset: cmd.startOffset,
          endOffset: cmd.endOffset,
          stepIndex: job.stepIndex,
        });
      }
    } else if (cmd.directive === "nproc" || cmd.directive === "nprocshared") {
      const val = cmd.value ?? "";
      const m = VALID_NPROC_REGEX.exec(val.trim());
      if (!m || Number.parseInt(m[1]!, 10) <= 0) {
        const def = GaussianErrorCode.INVALID_NPROC_DIRECTIVE;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(cmd.directive, val),
          line: cmd.line,
          column: 1,
          startOffset: cmd.startOffset,
          endOffset: cmd.endOffset,
          stepIndex: job.stepIndex,
        });
      }
    }
  }

  // 2. Missing route section '#'
  if (!job.route) {
    const def = GaussianErrorCode.MISSING_ROUTE_SECTION;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(job.stepIndex),
      line: 1,
      column: 1,
      startOffset: job.startOffset,
      endOffset: job.startOffset,
      stepIndex: job.stepIndex,
    });
  } else {
    // Check method/basis against stdlib (informational if unrecognized)
    if (job.route.method && !lookupGaussianModelSchema(job.route.method)) {
      // Only flag clearly unusual/unknown tokens; keep info severity
      const knownExtras = new Set([
        "ccsd",
        "blyp",
        "pbe",
        "bp86",
        "wb97xd",
        "cam-b3lyp",
        "b3pw91",
        "am1",
        "pm6",
        "pm7",
        "uff",
        "amber",
        "cis",
        "mp4",
        "casscf",
        "cbs-qb3",
        "g4",
      ]);
      if (!knownExtras.has(job.route.method.toLowerCase())) {
        const def = GaussianErrorCode.UNKNOWN_METHOD_OR_BASIS;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(job.route.method),
          line: job.route.line,
          column: 1,
          startOffset: job.route.startOffset,
          endOffset: job.route.endOffset,
          stepIndex: job.stepIndex,
        });
      }
    }
  }

  const isAllCheck = job.route?.keywords.some(
    (k) => k.name.toLowerCase() === "geom" && k.options.some((o) => o.toLowerCase() === "allcheck"),
  );
  if (isAllCheck) return;

  // 3. Missing title section
  if (!job.title || job.title.trim().length === 0) {
    const def = GaussianErrorCode.MISSING_TITLE_SECTION;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(job.stepIndex),
      line: job.titleLine ?? job.route?.line ?? 1,
      column: 1,
      startOffset: job.startOffset,
      endOffset: job.startOffset,
      stepIndex: job.stepIndex,
    });
  }

  // 4. Duplicate variable definitions
  const seenVars = new Set<string>();
  for (const v of job.variableEntries) {
    const key = v.name.toLowerCase();
    if (seenVars.has(key)) {
      const def = GaussianErrorCode.DUPLICATE_VARIABLE;
      diagnostics.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(v.name),
        line: v.line,
        column: 1,
        startOffset: v.startOffset,
        endOffset: v.endOffset,
        stepIndex: job.stepIndex,
      });
    } else {
      seenVars.add(key);
    }
  }

  // 5. Missing charge & multiplicity
  const isGeomCheck = job.route?.keywords.some(
    (k) =>
      k.name.toLowerCase() === "geom" &&
      k.options.some((o) => o.toLowerCase() === "checkpoint" || o.toLowerCase() === "check"),
  );
  if (job.charge === undefined || job.multiplicity === undefined) {
    const def = GaussianErrorCode.MISSING_CHARGE_MULTIPLICITY;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(job.stepIndex),
      line: job.chargeMultLine ?? job.titleLine ?? 1,
      column: 1,
      startOffset: job.chargeMultStartOffset ?? job.startOffset,
      endOffset: job.chargeMultEndOffset ?? job.startOffset,
      stepIndex: job.stepIndex,
    });
  }

  // 6. Empty molecule (unless geom=checkpoint)
  if (job.atoms.length === 0 && !isGeomCheck) {
    const def = GaussianErrorCode.EMPTY_MOLECULE;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(job.stepIndex),
      line: job.chargeMultLine ?? 1,
      column: 1,
      startOffset: job.chargeMultStartOffset ?? job.startOffset,
      endOffset: job.chargeMultEndOffset ?? job.startOffset,
      stepIndex: job.stepIndex,
    });
    return;
  }

  // 7. Atom-level checks: unknown element, Z-matrix refs, variable refs, bond length & angle bounds
  let totalNuclearCharge = 0;
  let allElementsKnown = true;
  let canSolveGeometry = true;

  for (const atom of job.atoms) {
    const el = lookupElement(atom.element);
    if (!el) {
      allElementsKnown = false;
      const def = GaussianErrorCode.UNKNOWN_ELEMENT;
      diagnostics.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(atom.element, atom.index),
        line: atom.line,
        column: 1,
        startOffset: atom.startOffset,
        endOffset: atom.endOffset,
        stepIndex: job.stepIndex,
      });
    } else if (!el.isDummy) {
      totalNuclearCharge += el.atomicNumber;
    }

    if (atom.kind === "cartesian") {
      if (checkValueRefDefined(atom.x, atom, job, diagnostics) === undefined) canSolveGeometry = false;
      if (checkValueRefDefined(atom.y, atom, job, diagnostics) === undefined) canSolveGeometry = false;
      if (checkValueRefDefined(atom.z, atom, job, diagnostics) === undefined) canSolveGeometry = false;
      continue;
    }

    // Z-matrix checks
    const refs: number[] = [];
    const checkRef = (ref: number | undefined): void => {
      if (ref === undefined) return;
      if (ref < 1 || ref >= atom.index) {
        canSolveGeometry = false;
        const def = GaussianErrorCode.ZMATRIX_INVALID_ATOM_REF;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(ref, atom.index),
          line: atom.line,
          column: 1,
          startOffset: atom.startOffset,
          endOffset: atom.endOffset,
          stepIndex: job.stepIndex,
        });
      } else if (refs.includes(ref)) {
        canSolveGeometry = false;
        const def = GaussianErrorCode.ZMATRIX_DUPLICATE_ATOM_REF;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(ref, atom.index),
          line: atom.line,
          column: 1,
          startOffset: atom.startOffset,
          endOffset: atom.endOffset,
          stepIndex: job.stepIndex,
        });
      } else {
        refs.push(ref);
      }
    };

    checkRef(atom.bondRef);
    checkRef(atom.angleRef);
    checkRef(atom.dihedralRef);

    const r = checkValueRefDefined(atom.bondLength, atom, job, diagnostics);
    if (atom.bondLength && r === undefined) canSolveGeometry = false;
    if (r !== undefined && r <= 0) {
      canSolveGeometry = false;
      const def = GaussianErrorCode.NON_POSITIVE_BOND_LENGTH;
      diagnostics.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(r, atom.index),
        line: atom.line,
        column: 1,
        startOffset: atom.startOffset,
        endOffset: atom.endOffset,
        stepIndex: job.stepIndex,
      });
    }

    const theta = checkValueRefDefined(atom.bondAngle, atom, job, diagnostics);
    if (atom.bondAngle && theta === undefined) canSolveGeometry = false;
    if (theta !== undefined && (theta <= 0 || theta >= 180)) {
      const def = GaussianErrorCode.INVALID_BOND_ANGLE;
      diagnostics.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(theta, atom.index),
        line: atom.line,
        column: 1,
        startOffset: atom.startOffset,
        endOffset: atom.endOffset,
        stepIndex: job.stepIndex,
      });
    }

    const phi = checkValueRefDefined(atom.dihedralAngle, atom, job, diagnostics);
    if (atom.dihedralAngle && phi === undefined) canSolveGeometry = false;
  }

  // 8. Charge / Spin Multiplicity electron-count parity check
  if (allElementsKnown && job.atoms.length > 0 && job.charge !== undefined && job.multiplicity !== undefined) {
    const totalElectrons = totalNuclearCharge - job.charge;
    const mult = job.multiplicity;
    const cmLine = job.chargeMultLine ?? 1;
    const cmStart = job.chargeMultStartOffset ?? job.startOffset;
    const cmEnd = job.chargeMultEndOffset ?? job.startOffset;

    if (mult < 1 || totalElectrons < 0 || mult > totalElectrons + 1) {
      const def = GaussianErrorCode.INVALID_MULTIPLICITY_VALUE;
      diagnostics.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(mult, Math.max(0, totalElectrons)),
        line: cmLine,
        column: 1,
        startOffset: cmStart,
        endOffset: cmEnd,
        stepIndex: job.stepIndex,
      });
    } else {
      // Even electrons -> odd multiplicity; odd electrons -> even multiplicity
      const electronsEven = totalElectrons % 2 === 0;
      const multOdd = mult % 2 === 1;
      if (electronsEven !== multOdd) {
        const def = GaussianErrorCode.INVALID_CHARGE_MULTIPLICITY_PARITY;
        diagnostics.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(totalElectrons, job.charge, mult),
          line: cmLine,
          column: 1,
          startOffset: cmStart,
          endOffset: cmEnd,
          stepIndex: job.stepIndex,
        });
      }
    }
  }

  // 9. Collinear Z-matrix reference atoms & overlapping atoms check via incremental NeRF placement
  if (canSolveGeometry && job.atoms.length > 0) {
    const placed: CartesianAtom[] = [];
    for (let i = 0; i < job.atoms.length; i++) {
      const atom = job.atoms[i]!;
      if (
        atom.kind === "zmatrix" &&
        atom.bondRef !== undefined &&
        atom.angleRef !== undefined &&
        atom.dihedralRef !== undefined
      ) {
        const aA = placed[atom.dihedralRef - 1];
        const aB = placed[atom.angleRef - 1];
        const aC = placed[atom.bondRef - 1];
        if (aA && aB && aC && areCollinear(aA, aB, aC)) {
          const def = GaussianErrorCode.ZMATRIX_COLLINEAR_REFERENCE;
          diagnostics.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(atom.index, atom.dihedralRef, atom.angleRef, atom.bondRef),
            line: atom.line,
            column: 1,
            startOffset: atom.startOffset,
            endOffset: atom.endOffset,
            stepIndex: job.stepIndex,
          });
          return;
        }
      }
      try {
        const partial = zmatrixToCartesian(job.atoms.slice(0, i + 1), job.variables, job.constants);
        placed.push(partial[i]!);
      } catch {
        return;
      }
    }

    // Check overlapping non-dummy atoms (< 0.40 Å)
    for (let i = 0; i < placed.length; i++) {
      const ai = placed[i]!;
      if (ai.isDummy) continue;
      for (let j = i + 1; j < placed.length; j++) {
        const aj = placed[j]!;
        if (aj.isDummy) continue;
        const d = bondDistance(ai, aj);
        if (d < 0.4) {
          const def = GaussianErrorCode.OVERLAPPING_ATOMS;
          const specJ = job.atoms[j]!;
          diagnostics.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(ai.index, aj.index, d),
            line: specJ.line,
            column: 1,
            startOffset: specJ.startOffset,
            endOffset: specJ.endOffset,
            stepIndex: job.stepIndex,
          });
        }
      }
    }
  }
}

/**
 * Runs all static analysis and chemical validity checks on a parsed `GaussianInputDocument`.
 */
export function lintGaussian(doc: GaussianInputDocument): GaussianDiagnostic[] {
  const diagnostics: GaussianDiagnostic[] = [];

  for (const err of doc.parseErrors) {
    const def = GaussianErrorCode.SYNTAX_ERROR;
    diagnostics.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  for (const job of doc.jobs) {
    lintJobStep(job, diagnostics);
  }

  return diagnostics;
}

/**
 * Convenience helper: parses and lints a Gaussian `.gjf`/`.com` string.
 */
export function lintGaussianText(text: string): GaussianDiagnostic[] {
  return lintGaussian(parseGaussianInput(text));
}

export { GaussianErrorCode };
