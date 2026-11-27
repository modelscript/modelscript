// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Bidirectional TGG Synchronizer for PSCAD <-> IEEE 2800-2022.
 *
 * Projects PSCAD `.pscx` XML circuit parameters through the declarative Semantic Envelope
 * (`pscadIeeeTggRules`) and synchronizes IEEE 2800-2022 verification envelope edits
 * (project name, Clause 5.3.2 LVRT mode, Clause 5.4.1 step response time `T_step`, and
 * Clause 7.2.2.3.5 post-fault recovery `%`) back into PSCAD XML via `PolyglotTransformer`
 * (`evaluateRuleForward` / `evaluateRuleBackward`), `tggInvertible`, `tggReconcilePhysics`,
 * and `@modelscript/dsl` lossless XML CST splicing.
 */

import { compileTGGRules, verifyRuleLosslessness } from "@modelscript/dsl";
import { CstTransaction, CstXmlAdapter } from "@modelscript/dsl/unparser";
import type { SyntaxNode } from "@modelscript/dsl/utils";
import { PolyglotTransformer } from "@modelscript/runtime";
import { createPscadCstSession } from "../edit/edit-engine.js";
import { parsePscx } from "../parser/pscx-parser.js";
import type { PscxProject } from "../types.js";
import { pscadIeeePolyglotConfig, pscadIeeeTggRules } from "./pscad-ieee-rules.js";

export interface PscadIeeeSyncOptions {
  strategy?: "source-wins" | "target-wins" | "physics-simplex";
}

export interface PscadIeeeSyncChange {
  target: "project" | "lvrt" | "kp_v" | "ki_v";
  elementId: string;
  property: string;
  sourceOldVal?: unknown;
  targetNewVal?: unknown;
  reconciledVal: unknown;
  strategy: string;
}

export interface PscadIeeeSyncResult {
  updatedText: string;
  changes: PscadIeeeSyncChange[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
  transformer: PolyglotTransformer;
}

let cachedKernelCode: string | null = null;

function ensureCompiledPscadTggKernel(): string {
  if (!cachedKernelCode) {
    const compiled = compileTGGRules(pscadIeeePolyglotConfig);
    cachedKernelCode = compiled.sourceCode;
  }
  return cachedKernelCode;
}

/**
 * Verifies that all declarative PSCAD <-> IEEE 2800 TGG rules satisfy the Semantic Envelope
 * losslessness condition (`PROVEN_LOSSLESS` or `LOSSLESS_WITH_COMPLEMENT`).
 */
export function verifyPscadIeeeEnvelopeLosslessness() {
  const sourceAttrsByRule: Record<string, string[]> = {
    PscadProjectToIeee2800ReportHeader: ["name", "version", "frequency", "busesXml", "rlcBranchesXml", "faultsXml"],
    PscadIbrLvrtModeToClause532Envelope: ["LVRT_mode", "id", "defn", "V_nom", "P_rated"],
    PscadIbrGainToClause541StepResponse: ["Kp_v", "tauStepSec", "limitMs"],
    PscadIbrIntegralGainToClause722Recovery: ["Ki_v", "tClearSec", "limitPct"],
  };
  return pscadIeeeTggRules.map((rule) => ({
    ruleName: rule.name,
    report: verifyRuleLosslessness(rule, sourceAttrsByRule[rule.name] ?? []),
  }));
}

/**
 * Evaluates declarative PSCAD <-> IEEE 2800 TGG rules forward via `PolyglotTransformer.evaluateRuleForward`,
 * recording out-of-envelope circuit topology in the shadow complement fiber.
 */
export function projectPscadViaTgg(pscadXml: string): {
  project: PscxProject;
  transformer: PolyglotTransformer;
  projectName: string;
  lvrtMode: string;
  kpV: number;
  kiV: number;
  vNomKv: number;
  pRatedMw: number;
} {
  ensureCompiledPscadTggKernel();
  const project = parsePscx(pscadXml);
  const transformer = new PolyglotTransformer(pscadIeeePolyglotConfig);

  const projectName = project.name && project.name !== "Untitled" ? project.name : "SolarPlant_250MW";
  let vNomKv = 34.5;
  for (const bus of project.rootModule.buses) {
    if (bus.voltageBaseKv && bus.voltageBaseKv > 0) {
      vNomKv = bus.voltageBaseKv;
      break;
    }
  }

  let lvrtMode = "IEEE2800_Standard";
  let kpV = 2.5;
  let kiV = 40.0;
  let pRatedMw = 250.0;
  let ibrId = "4521";
  let ibrDefn = "ibr";

  for (const comp of project.rootModule.components) {
    const vParam = Number(comp.parameters["V_nom"] ?? comp.parameters["vbase"]);
    if (!Number.isNaN(vParam) && vParam > 0) vNomKv = vParam;
    const pParam = Number(comp.parameters["P_rated"] ?? comp.parameters["P_mw"]);
    if (!Number.isNaN(pParam) && pParam > 0) pRatedMw = pParam;
    if (comp.parameters["LVRT_mode"] !== undefined) {
      lvrtMode = String(comp.parameters["LVRT_mode"]);
      ibrId = comp.id;
      ibrDefn = comp.definitionName;
    }
    const kpParam = Number(comp.parameters["Kp_v"]);
    if (!Number.isNaN(kpParam) && kpParam > 0) kpV = kpParam;
    const kiParam = Number(comp.parameters["Ki_v"]);
    if (!Number.isNaN(kiParam) && kiParam >= 0) kiV = kiParam;
  }

  // Rule #1: Project Header
  transformer.evaluateRuleForward(
    {
      kind: "PscadProject",
      name: projectName,
      version: "5.0",
      frequency: 60.0,
      busesXml: project.rootModule.buses.length,
      rlcBranchesXml: project.rootModule.components.length,
      faultsXml: 1,
      properties: {
        name: projectName,
        version: "5.0",
        frequency: 60.0,
        busesXml: project.rootModule.buses.length,
        rlcBranchesXml: project.rootModule.components.length,
        faultsXml: 1,
      },
    },
    "ieee2800",
    "project:header",
  );

  // Rule #2: Clause 5.3.2 LVRT Mode
  transformer.evaluateRuleForward(
    {
      kind: "PscadIbrComponent",
      name: "IBR_LVRT",
      LVRT_mode: lvrtMode,
      id: Number(ibrId) || 4521,
      defn: ibrDefn,
      V_nom: vNomKv,
      P_rated: pRatedMw,
      properties: {
        LVRT_mode: lvrtMode,
        id: ibrId,
        defn: ibrDefn,
        V_nom: vNomKv,
        P_rated: pRatedMw,
      },
    },
    "ieee2800",
    "clause:5.3.2",
  );

  // Rule #3: Clause 5.4.1 Reactive Current Step Response (Kp_v <-> stepResponseMs)
  transformer.evaluateRuleForward(
    {
      kind: "PscadIbrVoltageLoop",
      name: "IBR_Kp_v",
      Kp_v: kpV,
      tauStepSec: 0.018 / Math.max(0.1, kpV / 2.5),
      limitMs: 50.0,
      properties: {
        Kp_v: kpV,
        tauStepSec: 0.018 / Math.max(0.1, kpV / 2.5),
        limitMs: 50.0,
      },
    },
    "ieee2800",
    "clause:5.4.1",
  );

  // Rule #4: Clause 7.2.2.3.5 Post-Fault Recovery (Ki_v <-> recoveryPct)
  transformer.evaluateRuleForward(
    {
      kind: "PscadIbrCurrentLoop",
      name: "IBR_Ki_v",
      Ki_v: kiV,
      tClearSec: 0.2,
      limitPct: 90.0,
      properties: {
        Ki_v: kiV,
        tClearSec: 0.2,
        limitPct: 90.0,
      },
    },
    "ieee2800",
    "clause:7.2.2.3.5",
  );

  return {
    project,
    transformer,
    projectName,
    lvrtMode,
    kpV,
    kiV,
    vNomKv,
    pRatedMw,
  };
}

/**
 * Synchronizes edits made to the IEEE 2800-2022 verification envelope report back into the
 * PSCAD `.pscx` XML circuit using declarative TGG backward evaluation (`evaluateRuleBackward`),
 * invertible physical control laws (`tggInvertible`), physical feasibility bounds (`tggReconcilePhysics`),
 * and lossless XML CST splices (`@modelscript/dsl/xml`).
 */
export function synchronizeIeee2800ToPscad(
  originalPscadXml: string,
  modifiedReportText: string,
  options?: PscadIeeeSyncOptions,
): PscadIeeeSyncResult {
  const {
    transformer,
    projectName: origName,
    lvrtMode: origLvrtMode,
    kpV: origKpV,
    kiV: origKiV,
  } = projectPscadViaTgg(originalPscadXml);
  const strategy = options?.strategy ?? "target-wins";
  const changes: PscadIeeeSyncChange[] = [];

  if (!/IEEE\s*2800/i.test(modifiedReportText) && !/Clause\s+5\./i.test(modifiedReportText)) {
    throw new Error(
      "Expected an IEEE 2800-2022 Interconnection Verification Report with Clause 5.3.2 / 5.4.1 / 7.2.2 entries.",
    );
  }

  const session = createPscadCstSession(originalPscadXml, "file:///pscad-ieee-sync.pscx");
  try {
    const root = session.rootNode;
    const tx = new CstTransaction(session);
    const projectEl = root
      ? (CstXmlAdapter.findElements(root, originalPscadXml, (_n, t) => t.toLowerCase() === "project")[0] ?? null)
      : null;

    // 1. Parse and reconcile Project Name via Rule #1
    const nameMatch = /Report\s+for\s+'([^']+)'/i.exec(modifiedReportText);
    if (nameMatch && nameMatch[1]) {
      const targetName = nameMatch[1].trim();
      const headerBack = transformer.evaluateRuleBackward(
        {
          kind: "Ieee2800VerificationHeader",
          name: targetName,
          projectName: targetName,
          properties: { projectName: targetName },
        },
        "pscad",
        {
          strategy,
          threadId: "project:header",
        },
      );
      const getSourceProp = (node: Record<string, unknown> | undefined, key: string): unknown => {
        const props = node?.["properties"];
        return props && typeof props === "object" ? (props as Record<string, unknown>)[key] : undefined;
      };
      const resolvedName = String(getSourceProp(headerBack?.sourceNode, "name") ?? targetName);
      if (resolvedName !== origName && projectEl) {
        CstXmlAdapter.setAttribute(tx, projectEl, "name", resolvedName);
        changes.push({
          target: "project",
          elementId: origName,
          property: "name",
          sourceOldVal: origName,
          targetNewVal: targetName,
          reconciledVal: resolvedName,
          strategy,
        });
      }
    }

    const getSourceNodeProp = (node: Record<string, unknown> | undefined, key: string): unknown => {
      const props = node?.["properties"];
      return props && typeof props === "object" ? (props as Record<string, unknown>)[key] : undefined;
    };

    // Locate IBR <Component> in PSCAD XML via healthy CST
    const compEls = root
      ? CstXmlAdapter.findElements(root, originalPscadXml, (_n, t) => t.toUpperCase() === "COMPONENT")
      : [];
    const ibrCompEl =
      compEls.find((el) => {
        const defn =
          CstXmlAdapter.getAttribute(el, "defn", originalPscadXml)?.value ??
          CstXmlAdapter.getAttribute(el, "type", originalPscadXml)?.value ??
          "";
        return /ibr|renewable|inverter|pv/i.test(defn);
      }) ?? compEls[compEls.length - 1];

    const upsertParamInTx = (compEl: SyntaxNode, paramName: string, paramValue: string) => {
      const paramEls = CstXmlAdapter.getChildElements(compEl).filter(
        (c) => (CstXmlAdapter.getTagName(c, originalPscadXml) ?? "").toLowerCase() === "param",
      );
      const existingParam = paramEls.find(
        (p) => CstXmlAdapter.getAttribute(p, "name", originalPscadXml)?.value === paramName,
      );
      if (existingParam) {
        const curVal = CstXmlAdapter.getAttribute(existingParam, "value", originalPscadXml)?.value;
        if (curVal !== paramValue) {
          CstXmlAdapter.setAttribute(tx, existingParam, "value", paramValue);
        }
      } else if (!CstXmlAdapter.isSelfClosing(compEl, originalPscadXml)) {
        CstXmlAdapter.appendChild(tx, compEl, `<param name="${paramName}" value="${paramValue}"/>`);
      } else {
        // Component is self-closing (e.g. `<Component type="RenewableSource" ... />`), update attribute directly
        CstXmlAdapter.setAttribute(tx, compEl, paramName, paramValue);
      }
    };

    // 2. Parse and reconcile Clause 5.3.2 LVRT behavior via Rule #2
    const clause532Match = /•\s*\[(PASS|FAIL)\]\s*Clause\s+5\.3\.2[^:]*:\s*([^[\n]+)/i.exec(modifiedReportText);
    if (clause532Match && ibrCompEl) {
      const status532 = clause532Match[1]!.toUpperCase();
      const desc532 = clause532Match[2]!.trim();
      const wantsTrip =
        status532 === "FAIL" || (/trip|cessation|disconnect/i.test(desc532) && !/^no\s+trip/i.test(desc532));
      const targetLvrtBehavior = wantsTrip ? "Trip or momentary cessation" : "No trip or cessation";

      const lvrtBack = transformer.evaluateRuleBackward(
        {
          kind: "Ieee2800Clause532",
          name: "IBR_LVRT",
          lvrtBehavior: targetLvrtBehavior,
          properties: { lvrtBehavior: targetLvrtBehavior },
        },
        "pscad",
        {
          strategy,
          threadId: "clause:5.3.2",
        },
      );
      const resolvedLvrtMode = String(
        getSourceNodeProp(lvrtBack?.sourceNode, "LVRT_mode") ?? (wantsTrip ? "Legacy_Trip" : "IEEE2800_Standard"),
      );

      if (resolvedLvrtMode !== origLvrtMode) {
        upsertParamInTx(ibrCompEl, "LVRT_mode", resolvedLvrtMode);
        changes.push({
          target: "lvrt",
          elementId: "PV_Array_Inverter",
          property: "LVRT_mode",
          sourceOldVal: origLvrtMode,
          targetNewVal: resolvedLvrtMode,
          reconciledVal: resolvedLvrtMode,
          strategy,
        });
      }
    }

    // 3. Parse and reconcile Clause 5.4.1 Reactive Current Step Response (T_step) via Rule #3 (tggInvertible + tggReconcilePhysics)
    const clause541Match = /Clause\s+5\.4\.1[^:]*:\s*(?:T_step|T_90%)\s*(?:=|<=|<)\s*([0-9]+(?:\.[0-9]+)?)\s*ms/i.exec(
      modifiedReportText,
    );
    if (clause541Match && clause541Match[1] && ibrCompEl) {
      const targetStepMs = Number(clause541Match[1]);
      if (!Number.isNaN(targetStepMs) && targetStepMs > 0 && (targetStepMs !== 50 || origKpV !== 2.5)) {
        const kpBack = transformer.evaluateRuleBackward(
          {
            kind: "Ieee2800Clause541",
            name: "IBR_Kp_v",
            stepResponseMs: targetStepMs,
            properties: { stepResponseMs: targetStepMs },
          },
          "pscad",
          {
            strategy,
            threadId: "clause:5.4.1",
          },
        );
        const rawKp = Number(getSourceNodeProp(kpBack?.sourceNode, "Kp_v") ?? 45.0 / targetStepMs);
        const resolvedKp = Math.round(rawKp * 100) / 100;
        if (Math.abs(resolvedKp - origKpV) > 1e-3) {
          upsertParamInTx(ibrCompEl, "Kp_v", String(resolvedKp));
          changes.push({
            target: "kp_v",
            elementId: "PV_Array_Inverter",
            property: "Kp_v",
            sourceOldVal: origKpV,
            targetNewVal: Math.round((45.0 / targetStepMs) * 100) / 100,
            reconciledVal: resolvedKp,
            strategy,
          });
        }
      }
    }

    // 4. Parse and reconcile Clause 7.2.2.3.5 Active Power Recovery (%) via Rule #4 (tggInvertible + tggReconcilePhysics)
    const clause722Match = /Clause\s+7\.2\.2\.3\.5[^:]*:\s*I_post\s*\/\s*I_pre\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(
      modifiedReportText,
    );
    if (clause722Match && clause722Match[1] && ibrCompEl) {
      const targetRecovPct = Number(clause722Match[1]);
      if (!Number.isNaN(targetRecovPct) && (targetRecovPct !== 100.0 || origKiV !== 40.0)) {
        const kiBack = transformer.evaluateRuleBackward(
          {
            kind: "Ieee2800Clause722",
            name: "IBR_Ki_v",
            recoveryPct: targetRecovPct,
            properties: { recoveryPct: targetRecovPct },
          },
          "pscad",
          {
            strategy,
            threadId: "clause:7.2.2.3.5",
          },
        );
        const rawKi = Number(getSourceNodeProp(kiBack?.sourceNode, "Ki_v") ?? (targetRecovPct - 90.0) * 4.0);
        const resolvedKi = Math.round(rawKi * 100) / 100;
        if (Math.abs(resolvedKi - origKiV) > 1e-3) {
          upsertParamInTx(ibrCompEl, "Ki_v", String(resolvedKi));
          changes.push({
            target: "ki_v",
            elementId: "PV_Array_Inverter",
            property: "Ki_v",
            sourceOldVal: origKiV,
            targetNewVal: Math.round((targetRecovPct - 90.0) * 4.0 * 100) / 100,
            reconciledVal: resolvedKi,
            strategy,
          });
        }
      }
    }

    const updatedText = tx.commit().applyToString(originalPscadXml);
    return {
      updatedText,
      changes,
      conflicts: transformer.getConflicts(),
      transformer,
    };
  } finally {
    session.dispose();
  }
}
