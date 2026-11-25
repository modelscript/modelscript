// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Polyglot Digital Thread & Semantic Theory Coordinator Orchestration.
 *
 * Used by the VitePress Web Showcase, ModelScript CLI (`msx verify --coordinator`),
 * and VS Code LSP multi-file workspace coordinator so all three surfaces share
 * identical N-file artifact discovery, Nelson-Oppen theory propagation, and
 * `DigitalThreadHypergraph` status computation.
 */

import type { SysmlRequirement } from "../formal/requirement_binder.js";
import type { ConflictClause, SemanticTheoryCoordinator, SharedEquality } from "../formal/theory_coordinator.js";
import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "./thread_hypergraph.js";

export interface CoordinatorDiagnosticLike {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface DigitalThreadDocument {
  uri?: string | undefined;
  fileName: string;
  lang: string;
  content: string;
  namespaceFqn: string;
  threadDomain: ThreadDomain;
}

export interface DigitalThreadDirectiveLinkLike {
  paneIndex: number;
  fileName: string;
  line: number;
  directiveKind: string;
  sourceExpr: string;
  targetExpr: string;
}

export interface CoordinatedVariableLinkLike {
  canonicalFqn: string;
  status: "SAT" | "UNSAT" | "CONFLICT" | "UNKNOWN";
  valueFormatted: string;
}

export interface ResolvedDigitalThreadWorkspace {
  scenarioId: string;
  documents: DigitalThreadDocument[];
  /** Indexes into `documents` by domain role, discovered dynamically from file types & directives. */
  roleIndex: {
    sysml: number;
    modelica: number;
    scad: number;
    fea: number;
    cfd: number;
    urdf: number;
    step: number;
    powerRms: number;
    powerEmt: number;
    telemetry: number;
  };
  hypergraph: DigitalThreadHypergraph;
  threadSlot: number;
}

const LANG_BY_EXT: { ext: string; lang: string; domain: ThreadDomain; fallbackNs: string }[] = [
  { ext: ".sysml", lang: "sysml", domain: ThreadDomain.SysML2, fallbackNs: "SysML2::System" },
  { ext: ".mo", lang: "modelica", domain: ThreadDomain.Modelica, fallbackNs: "Modelica::Plant" },
  { ext: ".scad", lang: "scad", domain: ThreadDomain.CAD, fallbackNs: "CAD::Part" },
  { ext: ".inp", lang: "fea", domain: ThreadDomain.FEA, fallbackNs: "FEA::Deck" },
  { ext: ".bdf", lang: "fea", domain: ThreadDomain.FEA, fallbackNs: "FEA::Deck" },
  { ext: ".cfd", lang: "cfd", domain: ThreadDomain.CFD, fallbackNs: "CFD::Case" },
  { ext: ".foam", lang: "cfd", domain: ThreadDomain.CFD, fallbackNs: "CFD::Case" },
  { ext: ".urdf", lang: "xml", domain: ThreadDomain.CAD, fallbackNs: "URDF::Robot" },
  { ext: ".step", lang: "step", domain: ThreadDomain.GDT, fallbackNs: "STEP::PMI" },
  { ext: ".stp", lang: "step", domain: ThreadDomain.GDT, fallbackNs: "STEP::PMI" },
  { ext: ".raw", lang: "psse", domain: ThreadDomain.PowerRMS, fallbackNs: "PSSE::Powerflow" },
  { ext: ".dyr", lang: "psse", domain: ThreadDomain.PowerRMS, fallbackNs: "PSSE::Dynamics" },
  { ext: ".seq", lang: "psse", domain: ThreadDomain.PowerRMS, fallbackNs: "PSSE::Sequence" },
  { ext: ".pscx", lang: "pscad", domain: ThreadDomain.PowerEMT, fallbackNs: "PSCAD::Network" },
  { ext: ".dss", lang: "opendss", domain: ThreadDomain.PowerEMT, fallbackNs: "OpenDSS::Corridor" },
  { ext: ".olr", lang: "oneliner", domain: ThreadDomain.PowerEMT, fallbackNs: "OneLiner::Protection" },
  { ext: ".p3743", lang: "p3743", domain: ThreadDomain.PowerEMT, fallbackNs: "P3743::EMT" },
  { ext: ".cfg", lang: "comtrade", domain: ThreadDomain.Telemetry, fallbackNs: "COMTRADE::Config" },
  { ext: ".dat", lang: "comtrade", domain: ThreadDomain.Telemetry, fallbackNs: "COMTRADE::Waveform" },
  { ext: ".cff", lang: "comtrade", domain: ThreadDomain.Telemetry, fallbackNs: "COMTRADE::Combined" },
  { ext: ".soe", lang: "comfede", domain: ThreadDomain.Telemetry, fallbackNs: "COMFEDE::SOE" },
];

/**
 * Discovers domain roles and builds a `DigitalThreadHypergraph` dynamically from
 * an arbitrary N-file workspace (CLI file list, VS Code open documents, or 4-pane web showcase).
 */
export function resolveDigitalThreadWorkspace(
  files: {
    uri?: string;
    fileName: string;
    content: string;
    lang?: string;
    namespaceFqn?: string;
    threadDomain?: ThreadDomain;
  }[],
  explicitScenarioId?: string,
): ResolvedDigitalThreadWorkspace {
  const roleIndex = {
    sysml: -1,
    modelica: -1,
    scad: -1,
    fea: -1,
    cfd: -1,
    urdf: -1,
    step: -1,
    powerRms: -1,
    powerEmt: -1,
    telemetry: -1,
  };

  const documents: DigitalThreadDocument[] = files.map((f, idx) => {
    const lower = f.fileName.toLowerCase();
    const matched = LANG_BY_EXT.find((e) => lower.endsWith(e.ext));
    const lang = f.lang ?? matched?.lang ?? "txt";
    const threadDomain = f.threadDomain ?? matched?.domain ?? ThreadDomain.SysML2;
    const baseStem =
      f.fileName
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "Model";
    const namespaceFqn =
      f.namespaceFqn ?? (matched ? `${matched.fallbackNs.split("::")[0]}::${baseStem}` : `Domain::${baseStem}`);

    if (lang === "sysml" && roleIndex.sysml < 0) roleIndex.sysml = idx;
    else if (lang === "modelica" && roleIndex.modelica < 0) roleIndex.modelica = idx;
    else if (lang === "scad" && roleIndex.scad < 0) roleIndex.scad = idx;
    else if (lang === "fea" && roleIndex.fea < 0) roleIndex.fea = idx;
    else if (lang === "cfd" && roleIndex.cfd < 0) roleIndex.cfd = idx;
    else if ((lang === "xml" || lower.endsWith(".urdf")) && roleIndex.urdf < 0) roleIndex.urdf = idx;
    else if (lang === "step" && roleIndex.step < 0) roleIndex.step = idx;
    else if (threadDomain === ThreadDomain.PowerRMS && roleIndex.powerRms < 0) roleIndex.powerRms = idx;
    else if (threadDomain === ThreadDomain.PowerEMT && roleIndex.powerEmt < 0) roleIndex.powerEmt = idx;
    else if (threadDomain === ThreadDomain.Telemetry && roleIndex.telemetry < 0) roleIndex.telemetry = idx;

    return {
      uri: f.uri,
      fileName: f.fileName,
      lang,
      content: f.content,
      namespaceFqn,
      threadDomain,
    };
  });

  const scenarioId =
    explicitScenarioId ??
    (roleIndex.powerEmt >= 0 || roleIndex.powerRms >= 0
      ? "grid-emt-interconnection"
      : roleIndex.cfd >= 0
        ? "ev-battery-coldplate"
        : roleIndex.step >= 0 || roleIndex.urdf >= 0
          ? "robotics-gdt-tolerance"
          : "aerospace-actuator");

  const hypergraph = new DigitalThreadHypergraph(Math.max(16, documents.length * 4));
  const threadSlot = hypergraph.createThread(1001, 1, ThreadRelation.Verifies);
  documents.forEach((doc, idx) => {
    hypergraph.bindDomainNode(threadSlot, doc.threadDomain, (idx + 1) * 10);
  });

  return {
    scenarioId,
    documents,
    roleIndex,
    hypergraph,
    threadSlot,
  };
}

export interface RunCoordinatorLoopParams<TDiag extends CoordinatorDiagnosticLike> {
  coordinator: SemanticTheoryCoordinator;
  hypergraph: DigitalThreadHypergraph;
  threadSlot: number;
  panes: { lang: string; namespaceFqn: string }[];
  codes: string[];
  sysmlReqs: SysmlRequirement[];
  directiveLinks: DigitalThreadDirectiveLinkLike[];
  variableLinks: CoordinatedVariableLinkLike[];
  conflicts: ConflictClause[];
  paneDiagnostics: TDiag[][];
  lintSyntaxForLang: (code: string, lang: string) => TDiag[];
}

export interface RunCoordinatorLoopResult {
  isSat: boolean;
  iterations: number;
  sharedEqualities: SharedEquality[];
}

/**
 * Shared Nelson-Oppen theory assertion & `DigitalThreadHypergraph` status loop.
 * Used identically across Web Showcase, ModelScript CLI, and VS Code LSP.
 */
export function runDigitalThreadAssertionLoop<TDiag extends CoordinatorDiagnosticLike>(
  params: RunCoordinatorLoopParams<TDiag>,
): RunCoordinatorLoopResult {
  const {
    coordinator,
    hypergraph,
    threadSlot,
    panes,
    codes,
    sysmlReqs,
    directiveLinks,
    variableLinks,
    conflicts,
    paneDiagnostics,
    lintSyntaxForLang,
  } = params;

  const fallbackPkg = panes[0]?.namespaceFqn?.split("::").pop() ?? "SysML";
  for (const req of sysmlReqs) {
    const reqPkg = req.packageName ?? fallbackPkg;
    const attrSuffix = req.targetAttribute.includes(".") ? req.targetAttribute.split(".").pop()! : req.targetAttribute;
    const canonicalAttrFqn = req.subjectName
      ? `SysML2::${reqPkg}::${req.subjectName}.${attrSuffix}`
      : `SysML2::${reqPkg}::${req.targetAttribute}`;
    coordinator.assertLiteral({
      predicate: "bound",
      args: [canonicalAttrFqn, req.operator, req.limitValue],
      domain: "constraint",
    });
  }

  for (const dLink of directiveLinks) {
    if (dLink.directiveKind === "@twin" || dLink.directiveKind === "annotation(twin)") {
      const srcFqn = dLink.sourceExpr.includes("::")
        ? dLink.sourceExpr
        : `${panes[dLink.paneIndex]?.namespaceFqn ?? "Domain"}::${dLink.sourceExpr}`;
      const dstFqn = dLink.targetExpr.includes("::")
        ? dLink.targetExpr
        : `${panes[dLink.paneIndex]?.namespaceFqn ?? "Domain"}::${dLink.targetExpr}`;
      coordinator.assertLiteral({
        predicate: "equal",
        args: [srcFqn, dstFqn],
        domain: "constraint",
      });
    }
  }

  for (const vLink of variableLinks) {
    const numMatch = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(vLink.valueFormatted.trim());
    if (numMatch) {
      const evaluatedVal = Number.parseFloat(numMatch[1]!);
      if (Number.isFinite(evaluatedVal)) {
        coordinator.assertLiteral({
          predicate: "bound",
          args: [vLink.canonicalFqn, "==", evaluatedVal],
          domain: "constraint",
        });
      }
    }
  }

  const satRes = coordinator.checkSat();
  if (!satRes.isSat && satRes.conflict) {
    const alreadyPresent = conflicts.some(
      (c) => c.explanation === satRes.conflict!.explanation && c.theoryName === satRes.conflict!.theoryName,
    );
    if (!alreadyPresent) {
      conflicts.push(satRes.conflict);
    }
  }

  panes.forEach((p, idx) => {
    const code = codes[idx];
    if (code === undefined) return;
    for (const d of lintSyntaxForLang(code, p.lang)) {
      paneDiagnostics[idx]?.push(d);
    }
  });

  const isSat = conflicts.length === 0 && satRes.isSat;

  if (isSat) {
    hypergraph.recordTheorySat(threadSlot, satRes.sharedEqualities);
  } else if (conflicts[0]) {
    hypergraph.recordTheoryConflict(threadSlot, conflicts[0]);
  }

  return {
    isSat,
    iterations: Math.max(2, satRes.iterations || 3),
    sharedEqualities: satRes.sharedEqualities,
  };
}

export * from "./generic_digital_thread.js";
export * from "./polyglot_coordinator_factory.js";
