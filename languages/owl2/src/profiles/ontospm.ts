// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/owl2 — OntoSPM / LapOntoSPM Surgical Process Modeling Profile (M9901–M9910).
 *
 * Formal ontological representation and pre-flight surgical safety verification for
 * computer-assisted surgery (CAS), laparoscopic/robotic procedures, surgical phases,
 * instrument-tissue interactions, and Critical View of Safety (CVS) checkpoints.
 */

export interface OntoSpmSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type SurgicalActionVerb =
  | "Incision"
  | "Dissection"
  | "Traction"
  | "Clipping"
  | "Cutting"
  | "Transection"
  | "Coagulation"
  | "Suturing"
  | "Suction"
  | "Irrigation"
  | "Inspection"
  | "Resection"
  | "Hemostasis"
  | "Closure";

export type SurgicalInstrumentCategory =
  | "Scalpel"
  | "Dissector"
  | "Grasper"
  | "ClipApplier"
  | "Scissors"
  | "BipolarForceps"
  | "MonopolarHook"
  | "NeedleDriver"
  | "SuctionIrrigator"
  | "Endoscope"
  | "UltrasonicShears"
  | "Stapler";

export interface OntoSpmInstrument {
  id: string;
  name: string;
  category: SurgicalInstrumentCategory;
  energyModality: "Mechanical" | "Monopolar" | "Bipolar" | "Ultrasonic" | "Optical";
  range: OntoSpmSourceRange;
}

export interface OntoSpmAnatomicalStructure {
  id: string;
  name: string;
  tissueType: "Organ" | "Artery" | "Vein" | "BileDuct" | "Nerve" | "ConnectiveTissue" | "Tumor" | "Bone";
  isCriticalNeuroVascular: boolean;
  range: OntoSpmSourceRange;
}

export interface OntoSpmSafetyCheckpoint {
  id: string;
  name: string;
  phaseId: string;
  stepOrder: number;
  verified: boolean;
  targetStructures: string[];
  range: OntoSpmSourceRange;
}

export interface OntoSpmStep {
  id: string;
  name: string;
  phaseId: string;
  order: number;
  action: SurgicalActionVerb;
  instrumentId: string;
  targetStructureId: string;
  durationSec: number;
  proximityToCriticalMm?: number | undefined;
  requiredCheckpointId?: string | undefined;
  autonomyLevel?: 0 | 1 | 2 | 3 | 4 | 5 | undefined;
  range: OntoSpmSourceRange;
}

export interface OntoSpmPhase {
  id: string;
  name: string;
  phaseCategory: "Preparation" | "Exposure" | "Dissection" | "Resection" | "Reconstruction" | "Hemostasis" | "Closure";
  nextPhaseIds: string[];
  range: OntoSpmSourceRange;
}

export interface OntoSpmProcedure {
  id: string;
  name: string;
  ontologyIri: string;
  phases: OntoSpmPhase[];
  steps: OntoSpmStep[];
  instruments: OntoSpmInstrument[];
  structures: OntoSpmAnatomicalStructure[];
  checkpoints: OntoSpmSafetyCheckpoint[];
  uri?: string | undefined;
}

export interface OntoSpmDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: OntoSpmSourceRange;
}

export const OntoSpmErrorCode = {
  MISSING_CRITICAL_SAFETY_VIEW: {
    code: "M9901",
    rule: "ontospm-missing-critical-safety-view",
    severity: "error" as const,
    message: (stepId: string, action: string, targetId: string, checkpointId: string) =>
      `Irreversible surgical step '${stepId}' ('${action}' on '${targetId}') executes without a verified safety checkpoint '${checkpointId}' (Critical View of Safety).`,
  },
  INSTRUMENT_ACTION_INCOMPATIBILITY: {
    code: "M9902",
    rule: "ontospm-instrument-action-incompatibility",
    severity: "error" as const,
    message: (stepId: string, instrumentId: string, category: string, action: string) =>
      `Surgical step '${stepId}' pairs instrument '${instrumentId}' ('${category}') with incompatible surgical action '${action}'.`,
  },
  PHASE_TRANSITION_CYCLE: {
    code: "M9903",
    rule: "ontospm-phase-transition-cycle",
    severity: "error" as const,
    message: (phaseId: string) => `Surgical workflow contains a cyclic phase transition involving phase '${phaseId}'.`,
  },
  UNRESOLVED_ANATOMICAL_TARGET: {
    code: "M9904",
    rule: "ontospm-unresolved-anatomical-target",
    severity: "error" as const,
    message: (stepId: string, targetId: string) =>
      `Surgical step '${stepId}' references undeclared anatomical structure '${targetId}'.`,
  },
  UNRESOLVED_INSTRUMENT_REFERENCE: {
    code: "M9905",
    rule: "ontospm-unresolved-instrument-reference",
    severity: "error" as const,
    message: (stepId: string, instrumentId: string) =>
      `Surgical step '${stepId}' references undeclared surgical instrument '${instrumentId}'.`,
  },
  MISSING_HEMOSTASIS_OR_CLOSURE: {
    code: "M9906",
    rule: "ontospm-missing-hemostasis-or-closure",
    severity: "warning" as const,
    message: (procedureId: string) =>
      `Invasive surgical procedure '${procedureId}' lacks a terminal 'Hemostasis' or 'Closure' phase.`,
  },
  THERMAL_SPREAD_HAZARD_NEAR_NERVE: {
    code: "M9907",
    rule: "ontospm-bipolar-monopolar-energized-near-nerve",
    severity: "error" as const,
    message: (stepId: string, instrumentId: string, structureId: string, distMm: number) =>
      `Step '${stepId}' energizes monopolar instrument '${instrumentId}' at ${distMm} mm from critical neurovascular structure '${structureId}' (minimum safe thermal margin is 5.0 mm).`,
  },
  NON_POSITIVE_STEP_DURATION: {
    code: "M9908",
    rule: "ontospm-non-positive-step-duration",
    severity: "error" as const,
    message: (stepId: string, durationSec: number) =>
      `Surgical step '${stepId}' specifies a non-positive expected duration (${durationSec} s).`,
  },
  UNREACHABLE_SURGICAL_PHASE: {
    code: "M9909",
    rule: "ontospm-unreachable-surgical-phase",
    severity: "warning" as const,
    message: (phaseId: string, procedureId: string) =>
      `Surgical phase '${phaseId}' is unreachable from the initial phase of procedure '${procedureId}'.`,
  },
  DUPLICATE_ENTITY_IRI: {
    code: "M9910",
    rule: "ontospm-duplicate-entity-iri",
    severity: "error" as const,
    message: (entityId: string) => `Duplicate OntoSPM entity identifier '${entityId}' declared in surgical procedure.`,
  },
} as const;

const COMPATIBLE_INSTRUMENTS: Record<SurgicalActionVerb, ReadonlySet<SurgicalInstrumentCategory>> = {
  Incision: new Set(["Scalpel", "MonopolarHook", "Scissors", "UltrasonicShears"]),
  Dissection: new Set(["Dissector", "MonopolarHook", "Scissors", "UltrasonicShears", "BipolarForceps", "Grasper"]),
  Traction: new Set(["Grasper", "Dissector"]),
  Clipping: new Set(["ClipApplier", "Stapler"]),
  Cutting: new Set(["Scissors", "Scalpel", "UltrasonicShears", "Stapler", "MonopolarHook"]),
  Transection: new Set(["Scissors", "Scalpel", "UltrasonicShears", "Stapler"]),
  Coagulation: new Set(["BipolarForceps", "MonopolarHook", "UltrasonicShears"]),
  Suturing: new Set(["NeedleDriver", "Stapler"]),
  Suction: new Set(["SuctionIrrigator"]),
  Irrigation: new Set(["SuctionIrrigator"]),
  Inspection: new Set(["Endoscope", "Grasper", "Dissector"]),
  Resection: new Set(["Scalpel", "Scissors", "MonopolarHook", "UltrasonicShears", "Stapler"]),
  Hemostasis: new Set([
    "BipolarForceps",
    "MonopolarHook",
    "ClipApplier",
    "UltrasonicShears",
    "NeedleDriver",
    "SuctionIrrigator",
  ]),
  Closure: new Set(["NeedleDriver", "Stapler", "ClipApplier"]),
};

const IRREVERSIBLE_HIGH_RISK_ACTIONS = new Set<SurgicalActionVerb>(["Clipping", "Cutting", "Transection", "Resection"]);

function makeRange(text: string, startOffset: number, endOffset: number): OntoSpmSourceRange {
  const clampedStart = Math.max(0, Math.min(startOffset, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endOffset, text.length));
  let startLine = 1;
  let startColumn = 1;
  for (let i = 0; i < clampedStart; i++) {
    if (text[i] === "\n") {
      startLine++;
      startColumn = 1;
    } else {
      startColumn++;
    }
  }
  let endLine = startLine;
  let endColumn = startColumn;
  for (let i = clampedStart; i < clampedEnd; i++) {
    if (text[i] === "\n") {
      endLine++;
      endColumn = 1;
    } else {
      endColumn++;
    }
  }
  return {
    startLine,
    startColumn,
    endLine,
    endColumn,
    startOffset: clampedStart,
    endOffset: clampedEnd,
  };
}

function getAttr(tagText: string, attrName: string): string | undefined {
  const lower = tagText.toLowerCase();
  const target = `${attrName.toLowerCase()}=`;
  let searchFrom = 0;
  while (searchFrom < tagText.length) {
    const idx = lower.indexOf(target, searchFrom);
    if (idx === -1) return undefined;
    const prev = idx > 0 ? tagText[idx - 1] : " ";
    if (prev && !/[\s<]/.test(prev)) {
      searchFrom = idx + target.length;
      continue;
    }
    const quoteIdx = idx + target.length;
    const quoteChar = tagText[quoteIdx];
    if (quoteChar !== '"' && quoteChar !== "'") {
      searchFrom = quoteIdx;
      continue;
    }
    const endQuote = tagText.indexOf(quoteChar, quoteIdx + 1);
    if (endQuote === -1) return undefined;
    return tagText.slice(quoteIdx + 1, endQuote);
  }
  return undefined;
}

/**
 * Parses an OntoSPM / LapOntoSPM surgical process specification in XML or OWL2 Functional Syntax.
 */
export function parseOntoSpm(text: string, uri?: string): OntoSpmProcedure {
  const phases: OntoSpmPhase[] = [];
  const steps: OntoSpmStep[] = [];
  const instruments: OntoSpmInstrument[] = [];
  const structures: OntoSpmAnatomicalStructure[] = [];
  const checkpoints: OntoSpmSafetyCheckpoint[] = [];

  let procId = "Procedure_1";
  let procName = "SurgicalProcedure";
  let ontologyIri = "http://ontospm.org/lap/cholecystectomy";

  const trimmed = text.trim();

  // XML format: <SurgicalProcedure ...>
  if (trimmed.startsWith("<")) {
    let cursor = 0;
    while (cursor < text.length) {
      const openIdx = text.indexOf("<", cursor);
      if (openIdx === -1) break;
      if (text.startsWith("<!--", openIdx)) {
        const closeComment = text.indexOf("-->", openIdx + 4);
        cursor = closeComment === -1 ? text.length : closeComment + 3;
        continue;
      }
      if (text.startsWith("</", openIdx) || text.startsWith("<?", openIdx)) {
        const closeBracket = text.indexOf(">", openIdx + 2);
        cursor = closeBracket === -1 ? text.length : closeBracket + 1;
        continue;
      }
      const closeIdx = text.indexOf(">", openIdx);
      if (closeIdx === -1) break;

      const tagContent = text.slice(openIdx + 1, closeIdx);
      const tagName = (tagContent.split(/[\s/>]/)[0] ?? "").trim();
      const range = makeRange(text, openIdx, closeIdx + 1);

      if (tagName === "SurgicalProcedure" || tagName === "OntoSpmProcedure") {
        procId = getAttr(tagContent, "id") ?? procId;
        procName = getAttr(tagContent, "name") ?? procId;
        ontologyIri = getAttr(tagContent, "iri") ?? ontologyIri;
      } else if (tagName === "Phase" || tagName === "SurgicalPhase") {
        const id = getAttr(tagContent, "id") ?? `Phase_${phases.length + 1}`;
        const name = getAttr(tagContent, "name") ?? id;
        const category = (getAttr(tagContent, "category") ?? "Dissection") as OntoSpmPhase["phaseCategory"];
        const nextRaw = getAttr(tagContent, "next") ?? "";
        const nextPhaseIds = nextRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        phases.push({ id, name, phaseCategory: category, nextPhaseIds, range });
      } else if (tagName === "Instrument" || tagName === "SurgicalInstrument") {
        const id = getAttr(tagContent, "id") ?? `Inst_${instruments.length + 1}`;
        const name = getAttr(tagContent, "name") ?? id;
        const category = (getAttr(tagContent, "category") ?? "Grasper") as SurgicalInstrumentCategory;
        const energyModality = (getAttr(tagContent, "energy") ?? "Mechanical") as OntoSpmInstrument["energyModality"];
        instruments.push({ id, name, category, energyModality, range });
      } else if (tagName === "AnatomicalStructure" || tagName === "Structure") {
        const id = getAttr(tagContent, "id") ?? `Struct_${structures.length + 1}`;
        const name = getAttr(tagContent, "name") ?? id;
        const tissueType = (getAttr(tagContent, "tissueType") ?? "Organ") as OntoSpmAnatomicalStructure["tissueType"];
        const criticalAttr = getAttr(tagContent, "critical");
        const isCriticalNeuroVascular =
          criticalAttr === "true" || tissueType === "Nerve" || tissueType === "Artery" || tissueType === "BileDuct";
        structures.push({ id, name, tissueType, isCriticalNeuroVascular, range });
      } else if (tagName === "SafetyCheckpoint" || tagName === "Checkpoint") {
        const id = getAttr(tagContent, "id") ?? `Chk_${checkpoints.length + 1}`;
        const name = getAttr(tagContent, "name") ?? id;
        const phaseId = getAttr(tagContent, "phaseId") ?? "";
        const stepOrder = Number(getAttr(tagContent, "stepOrder") ?? "0");
        const verified = (getAttr(tagContent, "verified") ?? "true") === "true";
        const targetsRaw = getAttr(tagContent, "targets") ?? "";
        const targetStructures = targetsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        checkpoints.push({ id, name, phaseId, stepOrder, verified, targetStructures, range });
      } else if (tagName === "Step" || tagName === "SurgicalStep") {
        const id = getAttr(tagContent, "id") ?? `Step_${steps.length + 1}`;
        const name = getAttr(tagContent, "name") ?? id;
        const phaseId = getAttr(tagContent, "phaseId") ?? phases[phases.length - 1]?.id ?? "Phase_1";
        const order = Number(getAttr(tagContent, "order") ?? String(steps.length + 1));
        const action = (getAttr(tagContent, "action") ?? "Dissection") as SurgicalActionVerb;
        const instrumentId = getAttr(tagContent, "instrument") ?? "";
        const targetStructureId = getAttr(tagContent, "target") ?? "";
        const durationSec = Number(getAttr(tagContent, "durationSec") ?? "30");
        const proxAttr = getAttr(tagContent, "proximityMm");
        const reqChk = getAttr(tagContent, "requiresCheckpoint");
        const loaAttr = getAttr(tagContent, "autonomyLevel");
        steps.push({
          id,
          name,
          phaseId,
          order,
          action,
          instrumentId,
          targetStructureId,
          durationSec,
          ...(proxAttr !== undefined ? { proximityToCriticalMm: Number(proxAttr) } : {}),
          ...(reqChk !== undefined ? { requiredCheckpointId: reqChk } : {}),
          ...(loaAttr !== undefined ? { autonomyLevel: Number(loaAttr) as 0 | 1 | 2 | 3 | 4 | 5 } : {}),
          range,
        });
      }

      cursor = closeIdx + 1;
    }
  } else {
    // OWL2 Functional Syntax assertions: ClassAssertion(spm:Phase :Phase1) etc.
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (const line of lines) {
      const lineRange = makeRange(text, offset, offset + line.length);
      const t = line.trim();
      if (t.startsWith("Ontology(")) {
        const iriMatch = t.slice("Ontology(".length).split(/[\s)]/)[0];
        if (iriMatch) ontologyIri = iriMatch.replace(/^<|>$/g, "");
      } else if (t.startsWith("ClassAssertion(")) {
        const inner = t.slice("ClassAssertion(".length, t.endsWith(")") ? -1 : undefined).trim();
        const parts = inner.split(/\s+/);
        const cls = parts[0] ?? "";
        const ind = (parts[1] ?? "").replace(/^:/, "");
        if (cls.endsWith("SurgicalProcedure") && ind) {
          procId = ind;
          procName = ind;
        } else if (cls.endsWith("Phase") && ind) {
          const cat: OntoSpmPhase["phaseCategory"] = cls.includes("Closure")
            ? "Closure"
            : cls.includes("Hemostasis")
              ? "Hemostasis"
              : cls.includes("Preparation")
                ? "Preparation"
                : "Dissection";
          phases.push({ id: ind, name: ind, phaseCategory: cat, nextPhaseIds: [], range: lineRange });
        } else if (cls.endsWith("Instrument") && ind) {
          instruments.push({
            id: ind,
            name: ind,
            category: "Grasper",
            energyModality: "Mechanical",
            range: lineRange,
          });
        } else if (cls.endsWith("Structure") && ind) {
          structures.push({
            id: ind,
            name: ind,
            tissueType: "Organ",
            isCriticalNeuroVascular: false,
            range: lineRange,
          });
        }
      }
      offset += line.length + 1;
    }
  }

  return {
    id: procId,
    name: procName,
    ontologyIri,
    phases,
    steps,
    instruments,
    structures,
    checkpoints,
    ...(uri !== undefined ? { uri } : {}),
  };
}

/**
 * Runs pre-flight OntoSPM surgical process verification rules (M9901–M9910).
 */
export function lintOntoSpmProcedure(proc: OntoSpmProcedure): OntoSpmDiagnostic[] {
  const diagnostics: OntoSpmDiagnostic[] = [];

  // M9910: Duplicate entity IDs
  const seenIds = new Set<string>();
  const checkDuplicate = (id: string, range: OntoSpmSourceRange) => {
    if (seenIds.has(id)) {
      diagnostics.push({
        code: OntoSpmErrorCode.DUPLICATE_ENTITY_IRI.code,
        rule: OntoSpmErrorCode.DUPLICATE_ENTITY_IRI.rule,
        severity: OntoSpmErrorCode.DUPLICATE_ENTITY_IRI.severity,
        message: OntoSpmErrorCode.DUPLICATE_ENTITY_IRI.message(id),
        range,
      });
    } else {
      seenIds.add(id);
    }
  };

  for (const p of proc.phases) checkDuplicate(p.id, p.range);
  for (const s of proc.steps) checkDuplicate(s.id, s.range);
  for (const i of proc.instruments) checkDuplicate(i.id, i.range);
  for (const a of proc.structures) checkDuplicate(a.id, a.range);
  for (const c of proc.checkpoints) checkDuplicate(c.id, c.range);

  const instrumentMap = new Map<string, OntoSpmInstrument>();
  for (const i of proc.instruments) if (!instrumentMap.has(i.id)) instrumentMap.set(i.id, i);
  const structureMap = new Map<string, OntoSpmAnatomicalStructure>();
  for (const a of proc.structures) if (!structureMap.has(a.id)) structureMap.set(a.id, a);
  const checkpointMap = new Map<string, OntoSpmSafetyCheckpoint>();
  for (const c of proc.checkpoints) if (!checkpointMap.has(c.id)) checkpointMap.set(c.id, c);
  const phaseMap = new Map<string, OntoSpmPhase>();
  for (const p of proc.phases) if (!phaseMap.has(p.id)) phaseMap.set(p.id, p);

  // M9903: Phase transition cycle detection
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reportedCycle = new Set<string>();

  const dfsCycle = (phaseId: string): void => {
    visiting.add(phaseId);
    const phase = phaseMap.get(phaseId);
    if (phase) {
      for (const nextId of phase.nextPhaseIds) {
        if (visiting.has(nextId)) {
          if (!reportedCycle.has(nextId)) {
            reportedCycle.add(nextId);
            const targetPhase = phaseMap.get(nextId) ?? phase;
            diagnostics.push({
              code: OntoSpmErrorCode.PHASE_TRANSITION_CYCLE.code,
              rule: OntoSpmErrorCode.PHASE_TRANSITION_CYCLE.rule,
              severity: OntoSpmErrorCode.PHASE_TRANSITION_CYCLE.severity,
              message: OntoSpmErrorCode.PHASE_TRANSITION_CYCLE.message(nextId),
              range: targetPhase.range,
            });
          }
        } else if (!visited.has(nextId) && phaseMap.has(nextId)) {
          dfsCycle(nextId);
        }
      }
    }
    visiting.delete(phaseId);
    visited.add(phaseId);
  };

  for (const p of proc.phases) {
    if (!visited.has(p.id)) {
      dfsCycle(p.id);
    }
  }

  // M9909: Unreachable surgical phase from initial phase
  if (proc.phases.length > 1) {
    const reachable = new Set<string>();
    const rootPhase = proc.phases[0]!;
    const queue = [rootPhase.id];
    reachable.add(rootPhase.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const p = phaseMap.get(curr);
      if (p) {
        for (const nxt of p.nextPhaseIds) {
          if (!reachable.has(nxt) && phaseMap.has(nxt)) {
            reachable.add(nxt);
            queue.push(nxt);
          }
        }
      }
    }
    for (const p of proc.phases) {
      if (!reachable.has(p.id)) {
        diagnostics.push({
          code: OntoSpmErrorCode.UNREACHABLE_SURGICAL_PHASE.code,
          rule: OntoSpmErrorCode.UNREACHABLE_SURGICAL_PHASE.rule,
          severity: OntoSpmErrorCode.UNREACHABLE_SURGICAL_PHASE.severity,
          message: OntoSpmErrorCode.UNREACHABLE_SURGICAL_PHASE.message(p.id, proc.id),
          range: p.range,
        });
      }
    }
  }

  // M9906: Missing Hemostasis or Closure phase in invasive procedure
  const hasInvasive =
    proc.phases.some((p) => p.phaseCategory === "Dissection" || p.phaseCategory === "Resection") ||
    proc.steps.some((s) => s.action === "Incision" || s.action === "Dissection" || s.action === "Resection");
  const hasClosing =
    proc.phases.some((p) => p.phaseCategory === "Hemostasis" || p.phaseCategory === "Closure") ||
    proc.steps.some((s) => s.action === "Hemostasis" || s.action === "Closure");
  if (hasInvasive && !hasClosing && proc.phases.length > 0) {
    diagnostics.push({
      code: OntoSpmErrorCode.MISSING_HEMOSTASIS_OR_CLOSURE.code,
      rule: OntoSpmErrorCode.MISSING_HEMOSTASIS_OR_CLOSURE.rule,
      severity: OntoSpmErrorCode.MISSING_HEMOSTASIS_OR_CLOSURE.severity,
      message: OntoSpmErrorCode.MISSING_HEMOSTASIS_OR_CLOSURE.message(proc.id),
      range: proc.phases[proc.phases.length - 1]!.range,
    });
  }

  // Step-level checks
  for (const step of proc.steps) {
    // M9908: Non-positive step duration
    if (step.durationSec <= 0) {
      diagnostics.push({
        code: OntoSpmErrorCode.NON_POSITIVE_STEP_DURATION.code,
        rule: OntoSpmErrorCode.NON_POSITIVE_STEP_DURATION.rule,
        severity: OntoSpmErrorCode.NON_POSITIVE_STEP_DURATION.severity,
        message: OntoSpmErrorCode.NON_POSITIVE_STEP_DURATION.message(step.id, step.durationSec),
        range: step.range,
      });
    }

    // M9905: Unresolved instrument reference
    const inst = instrumentMap.get(step.instrumentId);
    if (!inst) {
      diagnostics.push({
        code: OntoSpmErrorCode.UNRESOLVED_INSTRUMENT_REFERENCE.code,
        rule: OntoSpmErrorCode.UNRESOLVED_INSTRUMENT_REFERENCE.rule,
        severity: OntoSpmErrorCode.UNRESOLVED_INSTRUMENT_REFERENCE.severity,
        message: OntoSpmErrorCode.UNRESOLVED_INSTRUMENT_REFERENCE.message(step.id, step.instrumentId),
        range: step.range,
      });
    } else {
      // M9902: Instrument-action incompatibility
      const allowed = COMPATIBLE_INSTRUMENTS[step.action];
      if (allowed && !allowed.has(inst.category)) {
        diagnostics.push({
          code: OntoSpmErrorCode.INSTRUMENT_ACTION_INCOMPATIBILITY.code,
          rule: OntoSpmErrorCode.INSTRUMENT_ACTION_INCOMPATIBILITY.rule,
          severity: OntoSpmErrorCode.INSTRUMENT_ACTION_INCOMPATIBILITY.severity,
          message: OntoSpmErrorCode.INSTRUMENT_ACTION_INCOMPATIBILITY.message(
            step.id,
            inst.id,
            inst.category,
            step.action,
          ),
          range: step.range,
        });
      }
    }

    // M9904: Unresolved anatomical target
    const struct = structureMap.get(step.targetStructureId);
    if (!struct) {
      diagnostics.push({
        code: OntoSpmErrorCode.UNRESOLVED_ANATOMICAL_TARGET.code,
        rule: OntoSpmErrorCode.UNRESOLVED_ANATOMICAL_TARGET.rule,
        severity: OntoSpmErrorCode.UNRESOLVED_ANATOMICAL_TARGET.severity,
        message: OntoSpmErrorCode.UNRESOLVED_ANATOMICAL_TARGET.message(step.id, step.targetStructureId),
        range: step.range,
      });
    } else {
      // M9907: Monopolar energy near critical neurovascular structure (< 5.0 mm)
      if (
        inst &&
        inst.energyModality === "Monopolar" &&
        struct.isCriticalNeuroVascular &&
        step.proximityToCriticalMm !== undefined &&
        step.proximityToCriticalMm < 5.0
      ) {
        diagnostics.push({
          code: OntoSpmErrorCode.THERMAL_SPREAD_HAZARD_NEAR_NERVE.code,
          rule: OntoSpmErrorCode.THERMAL_SPREAD_HAZARD_NEAR_NERVE.rule,
          severity: OntoSpmErrorCode.THERMAL_SPREAD_HAZARD_NEAR_NERVE.severity,
          message: OntoSpmErrorCode.THERMAL_SPREAD_HAZARD_NEAR_NERVE.message(
            step.id,
            inst.id,
            struct.id,
            step.proximityToCriticalMm,
          ),
          range: step.range,
        });
      }

      // M9901: Missing or unverified Critical View of Safety before irreversible action on critical structure
      if (IRREVERSIBLE_HIGH_RISK_ACTIONS.has(step.action) && struct.isCriticalNeuroVascular) {
        const reqChkId = step.requiredCheckpointId ?? "CriticalViewOfSafety";
        const chk =
          checkpointMap.get(reqChkId) ??
          proc.checkpoints.find((c) => c.targetStructures.includes(struct.id) && c.stepOrder <= step.order);
        if (!chk || !chk.verified || chk.stepOrder > step.order) {
          diagnostics.push({
            code: OntoSpmErrorCode.MISSING_CRITICAL_SAFETY_VIEW.code,
            rule: OntoSpmErrorCode.MISSING_CRITICAL_SAFETY_VIEW.rule,
            severity: OntoSpmErrorCode.MISSING_CRITICAL_SAFETY_VIEW.severity,
            message: OntoSpmErrorCode.MISSING_CRITICAL_SAFETY_VIEW.message(step.id, step.action, struct.id, reqChkId),
            range: step.range,
          });
        }
      }
    }
  }

  return diagnostics;
}

export interface SurgicalWorkflowSummary {
  procedureId: string;
  totalExpectedDurationSec: number;
  phaseCount: number;
  stepCount: number;
  verifiedCheckpointCount: number;
  maxAutonomyLevel: number;
  criticalPathPhases: string[];
}

export function analyzeSurgicalWorkflow(proc: OntoSpmProcedure): SurgicalWorkflowSummary {
  const totalExpectedDurationSec = proc.steps.reduce((acc, s) => acc + Math.max(0, s.durationSec), 0);
  const verifiedCheckpointCount = proc.checkpoints.filter((c) => c.verified).length;
  const maxAutonomyLevel = proc.steps.reduce((max, s) => Math.max(max, s.autonomyLevel ?? 0), 0);
  return {
    procedureId: proc.id,
    totalExpectedDurationSec,
    phaseCount: proc.phases.length,
    stepCount: proc.steps.length,
    verifiedCheckpointCount,
    maxAutonomyLevel,
    criticalPathPhases: proc.phases.map((p) => p.id),
  };
}

export function ontoSpmToOwl2Functional(proc: OntoSpmProcedure): string {
  const lines: string[] = [
    `Prefix(:=<${proc.ontologyIri}#>)`,
    `Prefix(spm:=<http://ontospm.org/core#>)`,
    `Prefix(owl:=<http://www.w3.org/2002/07/owl#>)`,
    ``,
    `Ontology(<${proc.ontologyIri}>`,
    `  Declaration(NamedIndividual(:${proc.id}))`,
    `  ClassAssertion(spm:SurgicalProcedure :${proc.id})`,
  ];

  for (const p of proc.phases) {
    lines.push(`  Declaration(NamedIndividual(:${p.id}))`);
    lines.push(`  ClassAssertion(spm:${p.phaseCategory}Phase :${p.id})`);
    for (const nxt of p.nextPhaseIds) {
      lines.push(`  ObjectPropertyAssertion(spm:precedesPhase :${p.id} :${nxt})`);
    }
  }

  for (const inst of proc.instruments) {
    lines.push(`  Declaration(NamedIndividual(:${inst.id}))`);
    lines.push(`  ClassAssertion(spm:${inst.category} :${inst.id})`);
  }

  for (const struct of proc.structures) {
    lines.push(`  Declaration(NamedIndividual(:${struct.id}))`);
    lines.push(`  ClassAssertion(spm:${struct.tissueType} :${struct.id})`);
  }

  for (const step of proc.steps) {
    lines.push(`  Declaration(NamedIndividual(:${step.id}))`);
    lines.push(`  ClassAssertion(spm:${step.action}Action :${step.id})`);
    lines.push(`  ObjectPropertyAssertion(spm:belongsToPhase :${step.id} :${step.phaseId})`);
    if (step.instrumentId) {
      lines.push(`  ObjectPropertyAssertion(spm:usesInstrument :${step.id} :${step.instrumentId})`);
    }
    if (step.targetStructureId) {
      lines.push(`  ObjectPropertyAssertion(spm:actsOnStructure :${step.id} :${step.targetStructureId})`);
    }
  }

  lines.push(`)`);
  return lines.join("\n") + "\n";
}
