// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Automated NERC Reliability Standards Compliance Auditor for PSS/E Cases.
 *
 * Implements automated validation and formal audit report generation for:
 * - NERC MOD-025-2: Real and Reactive Power Capability Verification (D-curve limits, reactive span)
 * - NERC MOD-026-1: Generator Excitation Control System & Voltage Regulator Verification (.dyr models)
 * - NERC MOD-027-1: Turbine-Governor Frequency Control & Droop Verification (3%-5% droop, deadbands)
 * - NERC TPL-001-4 / TPL-001-5.1: Transmission System Planning Performance (P0 normal & P1 contingency)
 */

import { analyzeN1Contingencies, solvePowerFlow } from "../solver/ac-powerflow.js";
import type { PsseCase, PsseDyrRecord } from "../types.js";

export type NercStandardId = "MOD-025-2" | "MOD-026-1" | "MOD-027-1" | "TPL-001-4";

export type ComplianceSeverity = "pass" | "warning" | "violation";

export interface NercFinding {
  standard: NercStandardId;
  element: string;
  severity: ComplianceSeverity;
  rule: string;
  description: string;
  observedValue?: string | number | undefined;
  expectedRange?: string | undefined;
}

export interface Mod025GeneratorResult {
  busNumber: number;
  genId: string;
  busName: string;
  pgMw: number;
  qgMvar: number;
  pMaxMw: number;
  pMinMw: number;
  qMaxMvar: number;
  qMinMvar: number;
  reactiveSpanMvar: number;
  powerFactor: number;
  severity: ComplianceSeverity;
  notes: string[];
}

export interface Mod026ExciterResult {
  busNumber: number;
  genId: string;
  model: string;
  ka?: number | undefined;
  ta?: number | undefined;
  tr?: number | undefined;
  vrmax?: number | undefined;
  vrmin?: number | undefined;
  severity: ComplianceSeverity;
  notes: string[];
}

export interface Mod027GovernorResult {
  busNumber: number;
  genId: string;
  model: string;
  droopR?: number | undefined;
  deadbandHz?: number | undefined;
  t1Sec?: number | undefined;
  severity: ComplianceSeverity;
  notes: string[];
}

export interface Tpl001PlanningResult {
  p0Converged: boolean;
  p0VoltageViolations: number;
  p0ThermalOverloads: number;
  p1TotalContingencies: number;
  p1Violations: number;
  p1Warnings: number;
  p1CascadingRisks: number;
  severity: ComplianceSeverity;
  notes: string[];
}

export interface NercComplianceAuditReport {
  timestamp: string;
  caseTitle: string;
  sbaseMva: number;
  overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL";
  summary: {
    totalChecks: number;
    passedChecks: number;
    warnings: number;
    violations: number;
  };
  mod025: {
    generators: Mod025GeneratorResult[];
    severity: ComplianceSeverity;
  };
  mod026: {
    exciters: Mod026ExciterResult[];
    severity: ComplianceSeverity;
  };
  mod027: {
    governors: Mod027GovernorResult[];
    severity: ComplianceSeverity;
  };
  tpl001: Tpl001PlanningResult;
  findings: NercFinding[];
  markdownReport: string;
}

export interface NercAuditOptions {
  includeContingencies?: boolean | undefined;
  caseTitle?: string | undefined;
  vMinNormal?: number | undefined;
  vMaxNormal?: number | undefined;
  vMinEmergency?: number | undefined;
  vMaxEmergency?: number | undefined;
  maxBranchLoadingNormal?: number | undefined;
  maxBranchLoadingEmergency?: number | undefined;
  droopMin?: number | undefined; // Standard: 0.03 (3%)
  droopMax?: number | undefined; // Standard: 0.05 (5%)
}

/**
 * Audits a PSS/E base case and associated dynamic models for NERC compliance.
 */
export function auditNercCompliance(psseCase: PsseCase, options: NercAuditOptions = {}): NercComplianceAuditReport {
  const caseTitle = options.caseTitle || psseCase.title1 || "PSS/E Grid Model";
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const findings: NercFinding[] = [];

  // 1. Solve base case power flow for steady-state checks
  const baseSol = solvePowerFlow(psseCase);

  // 2. MOD-025-2 Generator Real & Reactive Power Capability Verification
  const mod025Gens: Mod025GeneratorResult[] = [];
  let mod025Severity: ComplianceSeverity = "pass";

  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue; // Skip out-of-service generators
    const bus = psseCase.buses.get(gen.i);
    const busName = bus ? bus.name.trim() : `Bus ${gen.i}`;
    const notes: string[] = [];
    let genSev: ComplianceSeverity = "pass";

    const pMax = gen.pt;
    const pMin = gen.pb;
    const qMax = gen.qt;
    const qMin = gen.qb;
    const qSpan = qMax - qMin;

    const apparentMva = Math.sqrt(gen.pg * gen.pg + gen.qg * gen.qg);
    const pf = apparentMva > 1e-3 ? Math.abs(gen.pg) / apparentMva : 1.0;

    // Real power limits check
    if (gen.pg > pMax + 0.1) {
      genSev = "violation";
      notes.push(`Active generation ${gen.pg.toFixed(1)} MW exceeds Pmax ${pMax.toFixed(1)} MW.`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "violation",
        rule: "active-power-limit",
        description: `Active power output exceeds registered maximum capability.`,
        observedValue: `${gen.pg.toFixed(1)} MW`,
        expectedRange: `≤ ${pMax.toFixed(1)} MW`,
      });
    } else if (gen.pg < pMin - 0.1 && pMin > 0) {
      genSev = "warning";
      notes.push(`Active generation ${gen.pg.toFixed(1)} MW below Pmin ${pMin.toFixed(1)} MW.`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "warning",
        rule: "active-power-minimum",
        description: `Active power output below minimum operating limit.`,
        observedValue: `${gen.pg.toFixed(1)} MW`,
        expectedRange: `≥ ${pMin.toFixed(1)} MW`,
      });
    }

    // Reactive power capability span
    if (qSpan <= 0) {
      genSev = "violation";
      notes.push(`Invalid reactive capability: Qmax (${qMax.toFixed(1)}) <= Qmin (${qMin.toFixed(1)}).`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "violation",
        rule: "reactive-capability-envelope",
        description: `Reactive power limits inverted or degenerate (Qmax <= Qmin).`,
        observedValue: `Qmin=${qMin.toFixed(1)}, Qmax=${qMax.toFixed(1)}`,
        expectedRange: `Qmax > Qmin`,
      });
    } else if (qSpan < 0.2 * Math.max(10, Math.abs(pMax))) {
      if (genSev !== "violation") genSev = "warning";
      notes.push(`Restricted reactive span (${qSpan.toFixed(1)} Mvar) may limit voltage support.`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "warning",
        rule: "reactive-span-margin",
        description: `Narrow reactive capability margin.`,
        observedValue: `${qSpan.toFixed(1)} Mvar`,
        expectedRange: `≥ ${(0.2 * Math.abs(pMax)).toFixed(1)} Mvar`,
      });
    }

    // Reactive operating limits
    if (gen.qg > qMax + 0.5) {
      genSev = "violation";
      notes.push(`Reactive output ${gen.qg.toFixed(1)} Mvar exceeds Qmax ${qMax.toFixed(1)} Mvar.`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "violation",
        rule: "reactive-power-limit",
        description: `Reactive output exceeds maximum capability.`,
        observedValue: `${gen.qg.toFixed(1)} Mvar`,
        expectedRange: `≤ ${qMax.toFixed(1)} Mvar`,
      });
    } else if (gen.qg < qMin - 0.5) {
      genSev = "violation";
      notes.push(`Reactive output ${gen.qg.toFixed(1)} Mvar below Qmin ${qMin.toFixed(1)} Mvar.`);
      findings.push({
        standard: "MOD-025-2",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "violation",
        rule: "reactive-power-minimum",
        description: `Reactive output exceeds absorption capability.`,
        observedValue: `${gen.qg.toFixed(1)} Mvar`,
        expectedRange: `≥ ${qMin.toFixed(1)} Mvar`,
      });
    }

    if (genSev === "violation") mod025Severity = "violation";
    else if (genSev === "warning" && mod025Severity !== "violation") mod025Severity = "warning";

    mod025Gens.push({
      busNumber: gen.i,
      genId: gen.id,
      busName,
      pgMw: gen.pg,
      qgMvar: gen.qg,
      pMaxMw: pMax,
      pMinMw: pMin,
      qMaxMvar: qMax,
      qMinMvar: qMin,
      reactiveSpanMvar: qSpan,
      powerFactor: Number(pf.toFixed(3)),
      severity: genSev,
      notes,
    });
  }

  // 3. MOD-026-1 Generator Excitation Control Model Verification (.dyr)
  const mod026Exciters: Mod026ExciterResult[] = [];
  let mod026Severity: ComplianceSeverity = "pass";
  const dyrRecords = psseCase.dyr?.records ?? [];

  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const exciterRecord = findDyrRecord(dyrRecords, "exciter", gen.i, gen.id);
    const notes: string[] = [];
    let excSev: ComplianceSeverity = "pass";

    if (!exciterRecord) {
      // Check if machine is classical GENCLS (exempt or flagged as unmodeled AVR)
      const gencls = findDyrRecord(dyrRecords, "generator", gen.i, gen.id);
      if (gencls?.model === "GENCLS") {
        notes.push("Classical machine without excitation system model (GENCLS).");
        excSev = "warning";
      } else {
        notes.push("Missing dynamic excitation control system model in DYR.");
        excSev = "violation";
      }
      findings.push({
        standard: "MOD-026-1",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: excSev,
        rule: "missing-excitation-model",
        description: `Generator lacks a dynamic excitation system / AVR model.`,
      });

      mod026Exciters.push({
        busNumber: gen.i,
        genId: gen.id,
        model: "NONE",
        severity: excSev,
        notes,
      });
    } else {
      const ka = getParam(exciterRecord, ["KA", "K"]);
      const ta = getParam(exciterRecord, ["TA"]);
      const tr = getParam(exciterRecord, ["TR"]);
      const vrmax = getParam(exciterRecord, ["VRMAX", "EMAX", "VMAX"]);
      const vrmin = getParam(exciterRecord, ["VRMIN", "EMIN", "VMIN"]);

      if (ka !== undefined && (ka <= 0 || ka > 1000)) {
        excSev = "violation";
        notes.push(`Unusual or inverted regulator gain KA = ${ka}.`);
        findings.push({
          standard: "MOD-026-1",
          element: `Exciter ${gen.i}-${gen.id} (${exciterRecord.model})`,
          severity: "violation",
          rule: "regulator-gain-bounds",
          description: `Voltage regulator gain KA is out of acceptable bounds.`,
          observedValue: ka,
          expectedRange: "10 ≤ KA ≤ 500",
        });
      }

      if (tr !== undefined && tr < 0) {
        excSev = "violation";
        notes.push(`Negative transducer filter time constant TR = ${tr}s.`);
        findings.push({
          standard: "MOD-026-1",
          element: `Exciter ${gen.i}-${gen.id} (${exciterRecord.model})`,
          severity: "violation",
          rule: "transducer-time-constant",
          description: `Transducer time constant TR must be non-negative.`,
          observedValue: `${tr} s`,
          expectedRange: "TR ≥ 0",
        });
      }

      if (vrmax !== undefined && vrmin !== undefined && vrmax <= vrmin) {
        excSev = "violation";
        notes.push(`Inverted regulator output limits: VRMAX (${vrmax}) <= VRMIN (${vrmin}).`);
        findings.push({
          standard: "MOD-026-1",
          element: `Exciter ${gen.i}-${gen.id} (${exciterRecord.model})`,
          severity: "violation",
          rule: "regulator-limit-inversion",
          description: `Regulator ceiling limit VRMAX must be greater than floor limit VRMIN.`,
        });
      }

      mod026Exciters.push({
        busNumber: gen.i,
        genId: gen.id,
        model: exciterRecord.model,
        ka,
        ta,
        tr,
        vrmax,
        vrmin,
        severity: excSev,
        notes,
      });
    }

    if (excSev === "violation") mod026Severity = "violation";
    else if (excSev === "warning" && mod026Severity !== "violation") mod026Severity = "warning";
  }

  // 4. MOD-027-1 Turbine-Governor Frequency Control & Droop Verification (.dyr)
  const mod027Governors: Mod027GovernorResult[] = [];
  let mod027Severity: ComplianceSeverity = "pass";
  const droopMin = options.droopMin ?? 0.03; // 3% standard NERC droop
  const droopMax = options.droopMax ?? 0.05; // 5% standard NERC droop

  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const govRecord = findDyrRecord(dyrRecords, "governor", gen.i, gen.id);
    const notes: string[] = [];
    let govSev: ComplianceSeverity = "pass";

    if (!govRecord) {
      notes.push("Missing turbine-governor frequency control model in DYR.");
      govSev = "warning";
      findings.push({
        standard: "MOD-027-1",
        element: `Generator ${gen.i}-${gen.id}`,
        severity: "warning",
        rule: "missing-governor-model",
        description: `Unit lacks a dynamic turbine-governor frequency response model.`,
      });

      mod027Governors.push({
        busNumber: gen.i,
        genId: gen.id,
        model: "NONE",
        severity: govSev,
        notes,
      });
    } else {
      const droopR = getParam(govRecord, ["R", "DROOP"]);
      const deadband = getParam(govRecord, ["DB1", "DB", "DEADBAND"]);
      const t1 = getParam(govRecord, ["T1", "TG"]);

      if (droopR !== undefined) {
        if (droopR <= 0 || droopR > 0.15) {
          govSev = "violation";
          notes.push(`Invalid speed droop R = ${(droopR * 100).toFixed(2)}% (must be 3% - 5%).`);
          findings.push({
            standard: "MOD-027-1",
            element: `Governor ${gen.i}-${gen.id} (${govRecord.model})`,
            severity: "violation",
            rule: "droop-setting-range",
            description: `Permanent droop is non-positive or excessively sluggish.`,
            observedValue: `${(droopR * 100).toFixed(2)}%`,
            expectedRange: "3.0% ≤ R ≤ 5.0%",
          });
        } else if (droopR < droopMin || droopR > droopMax) {
          govSev = "warning";
          notes.push(`Droop R = ${(droopR * 100).toFixed(2)}% deviates from standard 3%-5% range.`);
          findings.push({
            standard: "MOD-027-1",
            element: `Governor ${gen.i}-${gen.id} (${govRecord.model})`,
            severity: "warning",
            rule: "droop-tolerance",
            description: `Droop setting slightly outside nominal NERC 3%-5% standard.`,
            observedValue: `${(droopR * 100).toFixed(2)}%`,
            expectedRange: "3.0% - 5.0%",
          });
        }
      }

      if (deadband !== undefined && deadband > 0.0006) {
        // 0.036 Hz at 60 Hz = 0.0006 p.u.
        if ((govSev as ComplianceSeverity) !== "violation") govSev = "warning";
        notes.push(`Frequency deadband ${(deadband * 60).toFixed(3)} Hz exceeds standard 0.036 Hz.`);
        findings.push({
          standard: "MOD-027-1",
          element: `Governor ${gen.i}-${gen.id} (${govRecord.model})`,
          severity: "warning",
          rule: "deadband-limit",
          description: `Governor deadband exceeds NERC frequency response requirement (36 mHz).`,
          observedValue: `${(deadband * 60).toFixed(3)} Hz`,
          expectedRange: "≤ 0.036 Hz",
        });
      }

      mod027Governors.push({
        busNumber: gen.i,
        genId: gen.id,
        model: govRecord.model,
        droopR,
        deadbandHz: deadband !== undefined ? deadband * 60 : undefined,
        t1Sec: t1,
        severity: govSev,
        notes,
      });
    }

    if (govSev === "violation") mod027Severity = "violation";
    else if (govSev === "warning" && mod027Severity !== "violation") mod027Severity = "warning";
  }

  // 5. TPL-001-4 Steady-State Planning Performance Verification (P0 & P1)
  const vMinNorm = options.vMinNormal ?? 0.95;
  const vMaxNorm = options.vMaxNormal ?? 1.05;
  const maxLoadNorm = options.maxBranchLoadingNormal ?? 100.0;

  let p0VoltageViolations = 0;
  let p0ThermalOverloads = 0;
  let tplSeverity: ComplianceSeverity = "pass";
  const tplNotes: string[] = [];

  // Check P0 normal system voltages
  for (const b of baseSol.buses) {
    const nvlo = psseCase.buses.get(b.busNumber)?.nvlo ?? vMinNorm;
    const nvhi = psseCase.buses.get(b.busNumber)?.nvhi ?? vMaxNorm;
    if (b.vm < nvlo || b.vm > nvhi) {
      p0VoltageViolations++;
      findings.push({
        standard: "TPL-001-4",
        element: `Bus ${b.busNumber} (${b.name})`,
        severity: "violation",
        rule: "p0-voltage-range",
        description: `P0 normal voltage outside permissible range.`,
        observedValue: `${b.vm.toFixed(4)} p.u.`,
        expectedRange: `${nvlo.toFixed(2)} - ${nvhi.toFixed(2)} p.u.`,
      });
    }
  }

  // Check P0 normal thermal ratings
  for (const br of baseSol.branches) {
    if (br.loadingPercent !== undefined && br.loadingPercent > maxLoadNorm) {
      p0ThermalOverloads++;
      findings.push({
        standard: "TPL-001-4",
        element: `Branch ${br.fromBus}->${br.toBus} (${br.ckt})`,
        severity: "violation",
        rule: "p0-thermal-rating",
        description: `P0 normal line flow exceeds continuous thermal rating (Rate A).`,
        observedValue: `${br.loadingPercent.toFixed(1)}%`,
        expectedRange: `≤ ${maxLoadNorm.toFixed(1)}%`,
      });
    }
  }

  if (p0VoltageViolations > 0 || p0ThermalOverloads > 0) {
    tplSeverity = "violation";
    tplNotes.push(`P0 normal system has ${p0VoltageViolations} voltage and ${p0ThermalOverloads} thermal violations.`);
  }

  // Run P1 Contingency Assessment if requested (default: true)
  let p1Total = 0;
  let p1Violations = 0;
  let p1Warnings = 0;
  let p1Cascading = 0;

  if (options.includeContingencies !== false) {
    const n1Res = analyzeN1Contingencies(psseCase);
    p1Total = n1Res.totalContingencies;
    p1Violations = n1Res.violationCount;
    p1Warnings = n1Res.warningCount;

    for (const c of n1Res.contingencies) {
      if (c.maxBranchLoadingPct >= 125.0) {
        p1Cascading++;
        findings.push({
          standard: "TPL-001-4",
          element: c.contingencyId,
          severity: "violation",
          rule: "p1-cascading-threshold",
          description: `Post-contingency loading exceeds cascading tripping threshold (125%).`,
          observedValue: `${c.maxBranchLoadingPct.toFixed(1)}% on ${c.maxLoadedBranch || "branch"}`,
          expectedRange: `< 125%`,
        });
      }
    }

    if (p1Violations > 0) {
      tplSeverity = "violation";
      tplNotes.push(`P1 contingency screening identified ${p1Violations} violations (${p1Cascading} cascading risks).`);
    } else if (p1Warnings > 0 && tplSeverity !== "violation") {
      tplSeverity = "warning";
      tplNotes.push(`P1 contingency screening identified ${p1Warnings} monitored warnings.`);
    }
  }

  const tplResult: Tpl001PlanningResult = {
    p0Converged: baseSol.converged,
    p0VoltageViolations,
    p0ThermalOverloads,
    p1TotalContingencies: p1Total,
    p1Violations,
    p1Warnings,
    p1CascadingRisks: p1Cascading,
    severity: tplSeverity,
    notes: tplNotes,
  };

  // 6. Overall Status Determination
  const violations = findings.filter((f) => f.severity === "violation").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const totalChecks = mod025Gens.length + mod026Exciters.length + mod027Governors.length + (p1Total > 0 ? p1Total : 1);
  const passedChecks = Math.max(0, totalChecks - violations - warnings);

  let overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL" = "COMPLIANT";
  if (violations > 0) {
    overallStatus = "NON-COMPLIANT";
  } else if (warnings > 0) {
    overallStatus = "CONDITIONAL";
  }

  const report: NercComplianceAuditReport = {
    timestamp: new Date().toISOString(),
    caseTitle,
    sbaseMva: sbase,
    overallStatus,
    summary: {
      totalChecks,
      passedChecks,
      warnings,
      violations,
    },
    mod025: {
      generators: mod025Gens,
      severity: mod025Severity,
    },
    mod026: {
      exciters: mod026Exciters,
      severity: mod026Severity,
    },
    mod027: {
      governors: mod027Governors,
      severity: mod027Severity,
    },
    tpl001: tplResult,
    findings,
    markdownReport: "",
  };

  report.markdownReport = formatNercMarkdownReport(report);
  return report;
}

/**
 * Finds a matching dynamic model record by category and bus/id.
 */
function findDyrRecord(
  records: PsseDyrRecord[],
  category: "generator" | "exciter" | "governor",
  bus: number,
  id: string,
): PsseDyrRecord | undefined {
  return records.find((r) => r.category === category && r.ibus === bus && (r.id === id || r.id === "*"));
}

/**
 * Retrieves a numeric parameter value from a DYR record by name.
 */
function getParam(record: PsseDyrRecord, names: string[]): number | undefined {
  if (!record.namedParams) return undefined;
  for (const name of names) {
    if (name in record.namedParams) {
      return record.namedParams[name];
    }
  }
  return undefined;
}

/**
 * Formats a NERC Compliance Audit Report into an executive-ready Markdown package.
 */
export function formatNercMarkdownReport(rep: NercComplianceAuditReport): string {
  const lines: string[] = [];

  const statusBadge =
    rep.overallStatus === "COMPLIANT"
      ? "✅ **COMPLIANT**"
      : rep.overallStatus === "CONDITIONAL"
        ? "⚠️ **CONDITIONAL**"
        : "❌ **NON-COMPLIANT**";

  lines.push(`# NERC Reliability Standards Compliance Audit Certification`);
  lines.push(`**Power System Model:** \`${rep.caseTitle}\` | **System Base:** \`${rep.sbaseMva} MVA\``);
  lines.push(`**Audit Timestamp:** \`${rep.timestamp}\` | **Certification Status:** ${statusBadge}`);
  lines.push("");

  lines.push(`## 1. Executive Summary`);
  lines.push(`| Standard | Title | Status | Checks | Violations |`);
  lines.push(`| :--- | :--- | :---: | :---: | :---: |`);
  lines.push(
    `| **MOD-025-2** | Generator Real & Reactive Capability Verification | ${badge(rep.mod025.severity)} | ${rep.mod025.generators.length} | ${countSev(rep.findings, "MOD-025-2", "violation")} |`,
  );
  lines.push(
    `| **MOD-026-1** | Generator Excitation Control Model Verification | ${badge(rep.mod026.severity)} | ${rep.mod026.exciters.length} | ${countSev(rep.findings, "MOD-026-1", "violation")} |`,
  );
  lines.push(
    `| **MOD-027-1** | Turbine-Governor Frequency Control & Droop | ${badge(rep.mod027.severity)} | ${rep.mod027.governors.length} | ${countSev(rep.findings, "MOD-027-1", "violation")} |`,
  );
  lines.push(
    `| **TPL-001-4** | Transmission System Planning Performance (P0 & P1) | ${badge(rep.tpl001.severity)} | ${rep.tpl001.p1TotalContingencies + 1} | ${countSev(rep.findings, "TPL-001-4", "violation")} |`,
  );
  lines.push("");

  // Audit Findings Table
  lines.push(`## 2. Compliance Findings & Audit Exceptions`);
  if (rep.findings.length === 0) {
    lines.push(`*All standards passed without warnings or violations.*`);
  } else {
    lines.push(`| Standard | Element | Severity | Rule | Finding Details |`);
    lines.push(`| :--- | :--- | :---: | :--- | :--- |`);
    for (const f of rep.findings) {
      lines.push(
        `| **${f.standard}** | \`${f.element}\` | ${badge(f.severity)} | \`${f.rule}\` | ${f.description} (Observed: \`${f.observedValue ?? "N/A"}\`) |`,
      );
    }
  }
  lines.push("");

  // MOD-025 Table
  lines.push(`## 3. MOD-025-2 Generator Real & Reactive Capability Data`);
  lines.push(`| Bus | Gen | Name | Pgen (MW) | Pmax | Qgen (Mvar) | Qmin | Qmax | Qspan | Status |`);
  lines.push(`| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
  for (const g of rep.mod025.generators) {
    lines.push(
      `| ${g.busNumber} | ${g.genId} | ${g.busName} | ${g.pgMw.toFixed(1)} | ${g.pMaxMw.toFixed(1)} | ${g.qgMvar.toFixed(1)} | ${g.qMinMvar.toFixed(1)} | ${g.qMaxMvar.toFixed(1)} | ${g.reactiveSpanMvar.toFixed(1)} | ${badge(g.severity)} |`,
    );
  }
  lines.push("");

  // MOD-026 & MOD-027 Tables
  lines.push(`## 4. MOD-026-1 & MOD-027-1 Dynamic Controls & Droop Verification`);
  lines.push(`| Bus | Gen | Exciter Model | KA Gain | Governor Model | Droop R (%) | Deadband (mHz) | Status |`);
  lines.push(`| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
  for (let i = 0; i < rep.mod025.generators.length; i++) {
    const gen = rep.mod025.generators[i]!;
    const exc = rep.mod026.exciters.find((e) => e.busNumber === gen.busNumber && e.genId === gen.genId);
    const gov = rep.mod027.governors.find((g) => g.busNumber === gen.busNumber && g.genId === gen.genId);
    const droopStr = gov?.droopR !== undefined ? `${(gov.droopR * 100).toFixed(2)}%` : "N/A";
    const dbStr = gov?.deadbandHz !== undefined ? `${(gov.deadbandHz * 1000).toFixed(1)}` : "N/A";
    const sev = exc?.severity === "violation" || gov?.severity === "violation" ? "violation" : "pass";

    lines.push(
      `| ${gen.busNumber} | ${gen.genId} | \`${exc?.model ?? "NONE"}\` | ${exc?.ka?.toFixed(1) ?? "N/A"} | \`${gov?.model ?? "NONE"}\` | ${droopStr} | ${dbStr} | ${badge(sev)} |`,
    );
  }
  lines.push("");

  // TPL-001 Planning Performance
  lines.push(`## 5. TPL-001-4 Steady-State Planning Performance Summary`);
  lines.push(`- **P0 Normal Base Case:** ${rep.tpl001.p0Converged ? "Converged" : "Diverged"}`);
  lines.push(`  - Bus Voltage Violations: **${rep.tpl001.p0VoltageViolations}**`);
  lines.push(`  - Continuous Thermal Overloads (>100% Rate A): **${rep.tpl001.p0ThermalOverloads}**`);
  lines.push(`- **P1 Single Contingency Screening:**`);
  lines.push(`  - Total Evaluated Contingencies: **${rep.tpl001.p1TotalContingencies}**`);
  lines.push(`  - Unacceptable Contingencies: **${rep.tpl001.p1Violations}**`);
  lines.push(`  - Cascading Outage Risks (>125% loading): **${rep.tpl001.p1CascadingRisks}**`);
  lines.push("");

  lines.push(`---`);
  lines.push(`*Generated by ModelScript Power Systems Engineering Engine (@modelscript/psse)*`);

  return lines.join("\n");
}

function badge(severity: ComplianceSeverity): string {
  switch (severity) {
    case "pass":
      return "✅ Pass";
    case "warning":
      return "⚠️ Warning";
    case "violation":
      return "❌ Violation";
  }
}

function countSev(findings: NercFinding[], standard: NercStandardId, severity: ComplianceSeverity): number {
  return findings.filter((f) => f.standard === standard && f.severity === severity).length;
}
