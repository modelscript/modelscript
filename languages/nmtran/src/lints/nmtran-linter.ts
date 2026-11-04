// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Pre-flight Pharmacometric Control Stream Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9401 - M9410) for NONMEM / NMTRAN models.
 */

import { type DiagnosticItem, NmtranErrorCode } from "../errors.js";
import type { NmtranControlStream, NmtranDocument } from "../types.js";

const GENERAL_ODE_ADVANS = new Set(["ADVAN6", "ADVAN8", "ADVAN9", "ADVAN13", "ADVAN14", "ADVAN15"]);

/**
 * Infers the maximum valid compartment index for an NMTRAN control stream.
 */
export function inferMaxCompartments(cs: NmtranControlStream): number | undefined {
  if (cs.nCompartments !== undefined && cs.nCompartments > 0) {
    return cs.nCompartments;
  }
  if (cs.compartments.length > 0) {
    return cs.compartments.length;
  }
  const advan = cs.subroutines.advan.toUpperCase();
  switch (advan) {
    case "ADVAN1":
    case "ADVAN10":
      return 1;
    case "ADVAN2":
    case "ADVAN3":
      return 2;
    case "ADVAN4":
    case "ADVAN11":
      return 3;
    case "ADVAN12":
      return 4;
    default:
      return undefined;
  }
}

interface RequiredParamGroup {
  canonical: string;
  alternatives: string[];
}

function getRequiredTransParamGroups(advan: string, trans: string): RequiredParamGroup[] {
  const upAdvan = advan.toUpperCase();
  const upTrans = (trans || "TRANS1").toUpperCase();

  if (upAdvan === "ADVAN1") {
    if (upTrans === "TRANS2") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V", alternatives: ["V", "V1"] },
      ];
    }
    return [{ canonical: "K", alternatives: ["K"] }];
  }

  if (upAdvan === "ADVAN2") {
    if (upTrans === "TRANS2") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V", alternatives: ["V", "V2", "V1"] },
        { canonical: "KA", alternatives: ["KA"] },
      ];
    }
    return [
      { canonical: "K", alternatives: ["K"] },
      { canonical: "KA", alternatives: ["KA"] },
    ];
  }

  if (upAdvan === "ADVAN3") {
    if (upTrans === "TRANS3") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V", alternatives: ["V", "V1"] },
        { canonical: "Q", alternatives: ["Q"] },
        { canonical: "VSS", alternatives: ["VSS"] },
      ];
    }
    if (upTrans === "TRANS4") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V1", alternatives: ["V1", "V"] },
        { canonical: "Q", alternatives: ["Q"] },
        { canonical: "V2", alternatives: ["V2"] },
      ];
    }
    if (upTrans === "TRANS5") {
      return [
        { canonical: "AOB", alternatives: ["AOB"] },
        { canonical: "ALPHA", alternatives: ["ALPHA"] },
        { canonical: "BETA", alternatives: ["BETA"] },
      ];
    }
    if (upTrans === "TRANS6") {
      return [
        { canonical: "ALPHA", alternatives: ["ALPHA"] },
        { canonical: "BETA", alternatives: ["BETA"] },
        { canonical: "K21", alternatives: ["K21"] },
      ];
    }
    return [
      { canonical: "K", alternatives: ["K"] },
      { canonical: "K12", alternatives: ["K12"] },
      { canonical: "K21", alternatives: ["K21"] },
    ];
  }

  if (upAdvan === "ADVAN4") {
    if (upTrans === "TRANS3") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V", alternatives: ["V", "V2", "V1"] },
        { canonical: "Q", alternatives: ["Q"] },
        { canonical: "VSS", alternatives: ["VSS"] },
        { canonical: "KA", alternatives: ["KA"] },
      ];
    }
    if (upTrans === "TRANS4") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V2", alternatives: ["V2", "V1", "V"] },
        { canonical: "Q", alternatives: ["Q"] },
        { canonical: "V3", alternatives: ["V3", "V2"] },
        { canonical: "KA", alternatives: ["KA"] },
      ];
    }
    if (upTrans === "TRANS5") {
      return [
        { canonical: "AOB", alternatives: ["AOB"] },
        { canonical: "ALPHA", alternatives: ["ALPHA"] },
        { canonical: "BETA", alternatives: ["BETA"] },
        { canonical: "KA", alternatives: ["KA"] },
      ];
    }
    return [
      { canonical: "K", alternatives: ["K"] },
      { canonical: "K23", alternatives: ["K23"] },
      { canonical: "K32", alternatives: ["K32"] },
      { canonical: "KA", alternatives: ["KA"] },
    ];
  }

  if (upAdvan === "ADVAN10") {
    return [
      { canonical: "VM", alternatives: ["VM"] },
      { canonical: "KM", alternatives: ["KM"] },
    ];
  }

  if (upAdvan === "ADVAN11") {
    if (upTrans === "TRANS4") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V1", alternatives: ["V1", "V"] },
        { canonical: "Q2", alternatives: ["Q2", "Q"] },
        { canonical: "V2", alternatives: ["V2"] },
        { canonical: "Q3", alternatives: ["Q3"] },
        { canonical: "V3", alternatives: ["V3"] },
      ];
    }
    return [
      { canonical: "K", alternatives: ["K"] },
      { canonical: "K12", alternatives: ["K12"] },
      { canonical: "K21", alternatives: ["K21"] },
      { canonical: "K13", alternatives: ["K13"] },
      { canonical: "K31", alternatives: ["K31"] },
    ];
  }

  if (upAdvan === "ADVAN12") {
    if (upTrans === "TRANS4") {
      return [
        { canonical: "CL", alternatives: ["CL"] },
        { canonical: "V2", alternatives: ["V2", "V1", "V"] },
        { canonical: "Q3", alternatives: ["Q3", "Q2", "Q"] },
        { canonical: "V3", alternatives: ["V3"] },
        { canonical: "Q4", alternatives: ["Q4"] },
        { canonical: "V4", alternatives: ["V4"] },
        { canonical: "KA", alternatives: ["KA"] },
      ];
    }
    return [
      { canonical: "K", alternatives: ["K"] },
      { canonical: "K23", alternatives: ["K23"] },
      { canonical: "K32", alternatives: ["K32"] },
      { canonical: "K24", alternatives: ["K24"] },
      { canonical: "K42", alternatives: ["K42"] },
      { canonical: "KA", alternatives: ["KA"] },
    ];
  }

  return [];
}

export function lintNmtran(doc: NmtranDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const cs = doc.controlStream;

  // M9401: Missing $PROBLEM record
  if (!cs.hasProblemRecord || cs.problem.trim() === "") {
    diagnostics.push({
      code: NmtranErrorCode.MISSING_PROBLEM_RECORD.code,
      rule: NmtranErrorCode.MISSING_PROBLEM_RECORD.rule,
      severity: NmtranErrorCode.MISSING_PROBLEM_RECORD.severity,
      message: NmtranErrorCode.MISSING_PROBLEM_RECORD.message(),
      range: cs.problemRange ?? cs.range,
    });
  }

  // M9402: $THETA bounds violation (lower > init or init > upper)
  for (const th of cs.thetas) {
    const low = th.lower ?? Number.NEGATIVE_INFINITY;
    const up = th.upper ?? Number.POSITIVE_INFINITY;
    if (low > th.init || th.init > up || low > up) {
      diagnostics.push({
        code: NmtranErrorCode.THETA_BOUNDS_VIOLATION.code,
        rule: NmtranErrorCode.THETA_BOUNDS_VIOLATION.rule,
        severity: NmtranErrorCode.THETA_BOUNDS_VIOLATION.severity,
        message: NmtranErrorCode.THETA_BOUNDS_VIOLATION.message(th.index, low, th.init, up),
        range: th.range ?? cs.range,
      });
    }
  }

  // M9403: Missing $DES block for general ODE ADVAN (ADVAN6, ADVAN8, ADVAN9, ADVAN13)
  const advan = cs.subroutines.advan.toUpperCase();
  if (GENERAL_ODE_ADVANS.has(advan)) {
    const hasDeriv = cs.hasDesBlock && cs.desEquations.some((e) => e.isDerivative);
    if (!hasDeriv) {
      diagnostics.push({
        code: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.code,
        rule: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.rule,
        severity: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.severity,
        message: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.message(advan),
        range: cs.subroutines.range ?? cs.range,
      });
    }
  }

  // M9404: Undefined THETA(n) reference & M9405: Undefined ETA(n) reference
  const maxTheta = cs.thetas.length;
  const maxOmega = cs.omegas.length;
  const reportedThetas = new Set<number>();
  const reportedEtas = new Set<number>();

  const allBlocksWithRefs = [...cs.pkStatements, ...cs.desEquations, ...cs.errorStatements];
  for (const stmt of allBlocksWithRefs) {
    for (const tIdx of stmt.thetaRefs) {
      if ((tIdx < 1 || tIdx > maxTheta) && !reportedThetas.has(tIdx)) {
        reportedThetas.add(tIdx);
        diagnostics.push({
          code: NmtranErrorCode.UNDEFINED_THETA_REFERENCE.code,
          rule: NmtranErrorCode.UNDEFINED_THETA_REFERENCE.rule,
          severity: NmtranErrorCode.UNDEFINED_THETA_REFERENCE.severity,
          message: NmtranErrorCode.UNDEFINED_THETA_REFERENCE.message(tIdx, maxTheta),
          range: stmt.range ?? cs.range,
        });
      }
    }

    for (const eIdx of stmt.etaRefs) {
      if ((eIdx < 1 || eIdx > maxOmega) && !reportedEtas.has(eIdx)) {
        reportedEtas.add(eIdx);
        diagnostics.push({
          code: NmtranErrorCode.UNDEFINED_ETA_REFERENCE.code,
          rule: NmtranErrorCode.UNDEFINED_ETA_REFERENCE.rule,
          severity: NmtranErrorCode.UNDEFINED_ETA_REFERENCE.severity,
          message: NmtranErrorCode.UNDEFINED_ETA_REFERENCE.message(eIdx, maxOmega),
          range: stmt.range ?? cs.range,
        });
      }
    }
  }

  // M9406: Non-positive $OMEGA diagonal variance (must be > 0 unless FIXED to 0)
  for (const om of cs.omegas) {
    if (om.variance < 0 || (om.variance === 0 && !om.fixed)) {
      diagnostics.push({
        code: NmtranErrorCode.NON_POSITIVE_OMEGA_VARIANCE.code,
        rule: NmtranErrorCode.NON_POSITIVE_OMEGA_VARIANCE.rule,
        severity: NmtranErrorCode.NON_POSITIVE_OMEGA_VARIANCE.severity,
        message: NmtranErrorCode.NON_POSITIVE_OMEGA_VARIANCE.message(om.index, om.variance),
        range: om.range ?? cs.range,
      });
    }
  }

  // M9407: Compartment index out of bounds in $DES, $ERROR, or dosing records
  const maxCmt = inferMaxCompartments(cs);
  if (maxCmt !== undefined && maxCmt > 0) {
    const reportedCmts = new Set<number>();

    for (const eq of cs.desEquations) {
      for (const cIdx of eq.compartmentRefs) {
        if ((cIdx < 1 || cIdx > maxCmt) && !reportedCmts.has(cIdx)) {
          reportedCmts.add(cIdx);
          diagnostics.push({
            code: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.code,
            rule: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.rule,
            severity: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.severity,
            message: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.message(cIdx, maxCmt),
            range: eq.range ?? cs.range,
          });
        }
      }
    }

    for (const errSt of cs.errorStatements) {
      for (const cIdx of errSt.compartmentRefs) {
        if ((cIdx < 1 || cIdx > maxCmt) && !reportedCmts.has(cIdx)) {
          reportedCmts.add(cIdx);
          diagnostics.push({
            code: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.code,
            rule: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.rule,
            severity: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.severity,
            message: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.message(cIdx, maxCmt),
            range: errSt.range ?? cs.range,
          });
        }
      }
    }

    for (const dose of cs.dosingRecords) {
      if ((dose.cmt < 1 || dose.cmt > maxCmt) && !reportedCmts.has(dose.cmt)) {
        reportedCmts.add(dose.cmt);
        diagnostics.push({
          code: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.code,
          rule: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.rule,
          severity: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.severity,
          message: NmtranErrorCode.COMPARTMENT_INDEX_OUT_OF_BOUNDS.message(dose.cmt, maxCmt),
          range: dose.range ?? cs.range,
        });
      }
    }
  }

  // M9408: Missing dependent prediction variable Y in $ERROR block
  if (cs.hasErrorBlock) {
    const definesY = cs.errorStatements.some((st) => st.lhs.toUpperCase() === "Y");
    if (!definesY) {
      const errRange = cs.errorStatements[0]?.range ?? cs.range;
      diagnostics.push({
        code: NmtranErrorCode.MISSING_ERROR_PREDICTION_Y.code,
        rule: NmtranErrorCode.MISSING_ERROR_PREDICTION_Y.rule,
        severity: NmtranErrorCode.MISSING_ERROR_PREDICTION_Y.severity,
        message: NmtranErrorCode.MISSING_ERROR_PREDICTION_Y.message(),
        range: errRange,
      });
    }
  }

  // M9409: Missing required pharmacokinetic parameter for ADVAN + TRANS in $PK
  if (advan.length > 0 && cs.pkStatements.length > 0) {
    const definedPkParams = new Set<string>(cs.pkStatements.map((s) => s.lhs.toUpperCase()));
    const requiredGroups = getRequiredTransParamGroups(advan, cs.subroutines.trans);
    const pkRange = cs.pkStatements[0]?.range ?? cs.subroutines.range ?? cs.range;

    for (const group of requiredGroups) {
      const satisfied = group.alternatives.some((alt) => definedPkParams.has(alt));
      if (!satisfied) {
        diagnostics.push({
          code: NmtranErrorCode.MISSING_REQUIRED_TRANS_PARAMETER.code,
          rule: NmtranErrorCode.MISSING_REQUIRED_TRANS_PARAMETER.rule,
          severity: NmtranErrorCode.MISSING_REQUIRED_TRANS_PARAMETER.severity,
          message: NmtranErrorCode.MISSING_REQUIRED_TRANS_PARAMETER.message(
            advan,
            cs.subroutines.trans || "TRANS1",
            group.canonical,
          ),
          range: pkRange,
        });
      }
    }
  }

  // M9410: Negative dosing AMT or infusion RATE
  for (const dose of cs.dosingRecords) {
    if (dose.amt < 0) {
      diagnostics.push({
        code: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.code,
        rule: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.rule,
        severity: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.severity,
        message: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.message("AMT", dose.amt),
        range: dose.range ?? cs.range,
      });
    }
    if (dose.rate < 0) {
      diagnostics.push({
        code: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.code,
        rule: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.rule,
        severity: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.severity,
        message: NmtranErrorCode.NEGATIVE_DOSING_AMOUNT.message("RATE", dose.rate),
        range: dose.range ?? cs.range,
      });
    }
  }

  return diagnostics;
}
