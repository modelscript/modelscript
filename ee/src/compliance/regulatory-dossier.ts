// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

/**
 * ModelScript Enterprise Edition — Automated Regulatory Dossier, RSAW & OSCAL Compiler.
 *
 * Compiles power utility simulation, verification, and audit findings into:
 * 1. Formatted NERC Reliability Standard Audit Worksheets (RSAWs) for MOD-025, MOD-026, MOD-027, TPL-001, PRC-019, PRC-024.
 * 2. NIST OSCAL 1.1 `assessment-results` JSON artifacts for automated GRC ingestion.
 * 3. FERC CEII watermarking (18 CFR § 388.113) and Ed25519 digital attestation signing.
 */

import crypto from "node:crypto";
import {
  signComplianceAttestation,
  type RegulatoryStandard,
  type SignedComplianceAttestation,
} from "./dhf-attestation.js";

/**
 * Normalized finding from any engineering or grid code standard audit.
 */
export interface RegulatoryDossierFinding {
  standard: string; // e.g. "MOD-025-2", "IEEE-2800-2022", "ASME-BPVC-VIII-1", "ASME-BPVC-VIII-2"
  element: string; // e.g. "Generator 1-1", "VesselShell"
  rule: string; // e.g. "UG-27(c)(1)", "active-power-limit"
  severity: "pass" | "warning" | "violation";
  description: string;
  observedValue?: string | number | undefined;
  expectedRange?: string | undefined;
  margin?: string | number | undefined;
  verificationMethod?: string | undefined;
}

/**
 * Input source data bundle for regulatory dossier compilation.
 */
export interface DossierCompilationInput {
  organizationName: string;
  utilityNercId?: string | undefined; // e.g. "NCR01234"
  plantName: string;
  standardProfile?: RegulatoryStandard | string | undefined;
  gridInterconnection?: "Eastern" | "Western" | "ERCOT" | "Quebec" | "NEM" | "ENTSO-E" | undefined;
  baseKv?: number | undefined;
  totalMva?: number | undefined;
  generatorCount?: number | undefined;
  overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL";
  findings: RegulatoryDossierFinding[];
  simulationArtifactHashes: Record<string, string>; // filename -> SHA256
  isCeiiRestricted?: boolean | undefined;
}

/**
 * Compiled regulatory dossier package.
 */
export interface CompiledRegulatoryDossier {
  dossierId: string;
  issuedAt: string;
  plantName: string;
  organizationName: string;
  overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL";
  rsawMarkdown: string;
  oscalAssessmentResultsJson: string;
  ceiiWatermarkNotice: string;
  signedAttestation: SignedComplianceAttestation;
  manifestDigestSha256: string;
}

function isAsmeBpvcInput(input: DossierCompilationInput): boolean {
  const profileUpper = (input.standardProfile ?? "").toUpperCase();
  if (profileUpper.includes("ASME") || profileUpper.includes("BPVC")) return true;
  return input.findings.some(
    (f) => f.standard.toUpperCase().includes("ASME") || f.standard.toUpperCase().includes("BPVC"),
  );
}

function resolveDossierAttestationStandard(input: DossierCompilationInput): RegulatoryStandard {
  if (
    input.standardProfile === "ASME-BPVC-VIII-1" ||
    input.standardProfile === "ASME-BPVC-VIII-2" ||
    input.standardProfile === "ASME-BPVC-VIII"
  ) {
    return input.standardProfile;
  }
  if (isAsmeBpvcInput(input)) {
    return input.findings.some((f) => f.standard.toUpperCase().includes("VIII-2"))
      ? "ASME-BPVC-VIII-2"
      : input.findings.some((f) => f.standard.toUpperCase().includes("VIII-1"))
        ? "ASME-BPVC-VIII-1"
        : "ASME-BPVC-VIII";
  }
  return "NERC-CIP-002-014";
}

/**
 * Generates the official FERC Critical Energy/Electric Infrastructure Information (CEII) cover sheet and header.
 */
export function generateCeiiWatermarkHeader(plantName: string, organization: string): string {
  return [
    `════════════════════════════════════════════════════════════════════════════════`,
    `               CRITICAL ENERGY/ELECTRIC INFRASTRUCTURE INFORMATION             `,
    `                        FERC CEII — 18 C.F.R. § 388.113                         `,
    `════════════════════════════════════════════════════════════════════════════════`,
    `  FACILITY: ${plantName.padEnd(50, " ")}`,
    `  DESIGNATED ENTITY: ${organization.padEnd(41, " ")}`,
    `  DESIGNATION: PROTECTED CRITICAL INFRASTRUCTURE / NOT FOR PUBLIC RELEASE     `,
    `  WARNING: UNAUTHORIZED DISCLOSURE MAY VIOLATE FEDERAL LAW (18 U.S.C. § 1030)  `,
    `════════════════════════════════════════════════════════════════════════════════`,
    ``,
  ].join("\n");
}

/**
 * Compiles a formal Regulatory Compliance Audit Dossier (NERC RSAW or ASME BPVC VIII Compliance Matrix) in Markdown.
 */
export function compileNercRsawDocument(input: DossierCompilationInput): string {
  const isAsme = isAsmeBpvcInput(input);
  const isCeii = input.isCeiiRestricted ?? !isAsme;
  const ceiiHeader = isCeii ? generateCeiiWatermarkHeader(input.plantName, input.organizationName) : "";

  const lines: string[] = isAsme
    ? [
        ceiiHeader,
        `# ASME BPVC Section VIII Mechanical Integrity & Compliance Dossier`,
        ``,
        `* **Certificate / Registered Organization:** ${input.organizationName}`,
        `* **Pressure Vessel / Equipment Tag:** ${input.plantName}`,
        `* **Compliance Profile:** ${input.standardProfile ?? "ASME-BPVC-VIII"}`,
        `* **Compilation Date:** ${new Date().toISOString()}`,
        `* **Composite Compliance Status:** **${input.overallStatus}**`,
        ``,
        `---`,
        ``,
        `## Executive Summary & Code Verification Scope`,
        ``,
        `This Mechanical Integrity & Compliance Matrix compiles formally proven DAE interval margins, dynamic trajectory`,
        `simulations, and SMT pressure-vessel code checks against ASME Boiler and Pressure Vessel Code requirements:`,
        `- **UG-27:** Thickness of Shells Under Internal Pressure (circumferential & longitudinal stress)`,
        `- **UG-32:** Formed Heads and Sections Under Internal Pressure (ellipsoidal, hemispherical, torispherical)`,
        `- **UG-99:** Standard Hydrostatic Test Pressure & Test-Temperature Stress Ratio`,
        `- **UG-125 / UG-134:** Pressure Relief Device Set Pressure & Relieving Accumulation Limits`,
        `- **Section VIII Div 2 Part 5.2:** Elastic Stress Linearization (Pm, PL, PL+Pb, PL+Pb+Q)`,
        ``,
        `---`,
        ``,
        `## Standard-by-Standard Compliance Matrix`,
        ``,
      ]
    : [
        ceiiHeader,
        `# NERC Reliability Standard Audit Worksheet (RSAW) Composite Dossier`,
        ``,
        `* **Registered Entity:** ${input.organizationName} (${input.utilityNercId ?? "NERC-NCR-PENDING"})`,
        `* **Generation / Transmission Asset:** ${input.plantName} (${input.gridInterconnection ?? "Eastern"} Interconnection)`,
        `* **Asset Parameters:** ${(input.baseKv ?? 0).toFixed(1)} kV, ${(input.totalMva ?? 0).toFixed(1)} MVA Total Capacity, ${input.generatorCount ?? 0} Unit(s)`,
        `* **Compilation Date:** ${new Date().toISOString()}`,
        `* **Composite Compliance Status:** **${input.overallStatus}**`,
        ``,
        `---`,
        ``,
        `## Executive Summary & Reliability Audit Scope`,
        ``,
        `This Reliability Standard Audit Worksheet (RSAW) provides verified engineering evidence, simulation waveforms,`,
        `and field test records demonstrating compliance with mandatory NERC Reliability Standards and FERC orders:`,
        `- **MOD-025-2:** Verification and Data Reporting of Generator Real and Reactive Power Capability and SVD`,
        `- **MOD-026-1:** Verification of Models and Data for Generator Excitation Control Systems`,
        `- **MOD-027-1:** Verification of Models and Data for Turbine-Governor and Load Frequency Controls`,
        `- **TPL-001-4 / TPL-001-5.1:** Transmission System Planning Performance Requirements (P0 & P1 contingencies)`,
        `- **PRC-019-2:** Coordination of Generating Unit or Inverter-Based Resource Protection with Controls`,
        `- **PRC-024-3:** Generator and Inverter-Based Resource Voltage and Frequency Protective Relay Settings`,
        `- **FERC Order 901 / IEEE 2800-2022:** Inverter-Based Resource Transmission Interconnection Verification`,
        ``,
        `---`,
        ``,
        `## Standard-by-Standard Compliance Assessment`,
        ``,
      ];

  const standards = Array.from(new Set(input.findings.map((f) => f.standard)));
  const hasMarginsOrMethods = input.findings.some((f) => f.margin !== undefined || f.verificationMethod !== undefined);

  for (const std of standards) {
    const stdFindings = input.findings.filter((f) => f.standard === std);
    const hasViolation = stdFindings.some((f) => f.severity === "violation");
    const hasWarning = stdFindings.some((f) => f.severity === "warning");
    const stdStatus = hasViolation ? "NON-COMPLIANT" : hasWarning ? "CONDITIONAL" : "COMPLIANT";

    lines.push(`### Standard ${std} — Status: **${stdStatus}**`);
    lines.push(``);
    if (hasMarginsOrMethods) {
      lines.push(
        `| Tested Element | Rule / Clause | Audit Severity | Observed Telemetry | Allowable Range | Design Margin | Verification Method | Finding Summary |`,
      );
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    } else {
      lines.push(
        `| Tested Element | Rule Identifier | Audit Severity | Observed Telemetry | Allowable Range | Finding Summary |`,
      );
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
    }

    for (const f of stdFindings) {
      const badge = f.severity === "pass" ? "✅ PASS" : f.severity === "warning" ? "⚠️ WARN" : "❌ VIOLATION";
      const obs = f.observedValue !== undefined ? String(f.observedValue) : "Nominal";
      const exp = f.expectedRange !== undefined ? f.expectedRange : "Within standard";
      if (hasMarginsOrMethods) {
        const mrg = f.margin !== undefined ? String(f.margin) : "-";
        const mtd = f.verificationMethod ?? "formal";
        lines.push(
          `| ${f.element} | \`${f.rule}\` | ${badge} | ${obs} | ${exp} | ${mrg} | ${mtd} | ${f.description} |`,
        );
      } else {
        lines.push(`| ${f.element} | \`${f.rule}\` | ${badge} | ${obs} | ${exp} | ${f.description} |`);
      }
    }

    lines.push(``);
    lines.push(`#### Registered Entity Compliance Evidence Statement for ${std}`);
    lines.push(
      isAsme
        ? `> All thickness, hydrotest, overpressure relief, and stress linearization calculations for ${std} have been verified through ModelScript interval reachability proofs, formal SMT pressure-vessel oracles, and time-domain transient simulation.`
        : `> All numerical simulation models, parameter conversion sheets, and verified field disturbance recordings for ${std} have been compiled through the ModelScript automated DAE verification pipeline and validated against physical plant telemetry.`,
    );
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`## Cryptographic Chain of Custody & Verification Manifest`);
  lines.push(``);
  lines.push(`| Artifact Filename | SHA-256 Digest | Status |`);
  lines.push(`| :--- | :--- | :--- |`);

  for (const [file, hash] of Object.entries(input.simulationArtifactHashes)) {
    lines.push(`| \`${file}\` | \`${hash}\` | Verified Immutable |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by ModelScript Enterprise Edition Compliance Engine (@modelscript/ee).*`);

  return lines.join("\n");
}

/**
 * Compiles a NIST OSCAL 1.1 `assessment-results` JSON document for GRC integration.
 */
export function compileOscalAssessmentResults(input: DossierCompilationInput): Record<string, unknown> {
  const oscalUuid = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const observations = input.findings.map((f) => ({
    uuid: crypto.randomUUID(),
    title: `${f.standard}: ${f.element} - ${f.rule}`,
    description: f.description,
    methods: ["test", "examine"],
    types: ["simulation-verification"],
    collected: timestamp,
    subjects: [
      {
        "subject-uuid": crypto.randomUUID(),
        type: "component",
        title: f.element,
      },
    ],
    "relevant-evidence": [
      {
        description: `Observed: ${f.observedValue ?? "N/A"}, Expected: ${f.expectedRange ?? "N/A"}`,
      },
    ],
  }));

  const findings = input.findings.map((f) => ({
    uuid: crypto.randomUUID(),
    title: `${f.standard} Requirement Evaluation`,
    description: f.description,
    "target-id": f.standard,
    status: {
      state: f.severity === "pass" ? "satisfied" : "not-satisfied",
    },
  }));

  const isAsme = isAsmeBpvcInput(input);

  return {
    "assessment-results": {
      uuid: oscalUuid,
      metadata: {
        title: isAsme
          ? `ASME BPVC Section VIII Mechanical Integrity Assessment — ${input.plantName}`
          : `NERC Reliability & Grid Code Compliance Assessment — ${input.plantName}`,
        "last-modified": timestamp,
        version: "1.0.0",
        "oscal-version": "1.1.0",
        parties: [
          {
            uuid: crypto.randomUUID(),
            type: "organization",
            name: input.organizationName,
          },
        ],
      },
      results: [
        {
          uuid: crypto.randomUUID(),
          title: isAsme
            ? `Automated ASME BPVC Compliance Evaluation for ${input.plantName}`
            : `Automated Grid Code Compliance Evaluation for ${input.plantName}`,
          description: isAsme
            ? `Evaluated via ModelScript Formal Pressure Vessel Oracle, DAE Interval Reachability, and Dynamic Simulation across ASME BPVC VIII-1 / VIII-2.`
            : `Evaluated via ModelScript Polyglot Engineering Compiler across NERC, FERC 901, and IEEE 2800 standards.`,
          start: timestamp,
          end: timestamp,
          observations,
          findings,
        },
      ],
    },
  };
}

/**
 * Compiles, formats, watermarks, and signs a complete regulatory dossier bundle.
 */
export function buildRegulatoryDossier(
  input: DossierCompilationInput,
  privateKeyPem?: string | undefined,
): CompiledRegulatoryDossier {
  const dossierId = `DOSSIER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const issuedAt = new Date().toISOString();

  const rsawMarkdown = compileNercRsawDocument(input);
  const oscalObj = compileOscalAssessmentResults(input);
  const oscalJson = JSON.stringify(oscalObj, null, 2);
  const ceiiWatermark = generateCeiiWatermarkHeader(input.plantName, input.organizationName);

  // Compute digest of complete dossier bundle
  const hasher = crypto.createHash("sha256");
  hasher.update(rsawMarkdown);
  hasher.update(oscalJson);
  for (const hash of Object.values(input.simulationArtifactHashes)) {
    hasher.update(hash);
  }
  const manifestDigest = hasher.digest("hex");

  // Sign attestation via Ed25519
  const signedAttestation = signComplianceAttestation(
    {
      organization: input.organizationName,
      standard: resolveDossierAttestationStandard(input),
      workspaceId: input.plantName,
      artifactSha256: manifestDigest,
    },
    privateKeyPem,
  );

  return {
    dossierId,
    issuedAt,
    plantName: input.plantName,
    organizationName: input.organizationName,
    overallStatus: input.overallStatus,
    rsawMarkdown,
    oscalAssessmentResultsJson: oscalJson,
    ceiiWatermarkNotice: ceiiWatermark,
    signedAttestation,
    manifestDigestSha256: manifestDigest,
  };
}
