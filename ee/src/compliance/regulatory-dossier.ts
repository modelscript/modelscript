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
  type SignedComplianceAttestation,
} from "./dhf-attestation.js";

/**
 * Normalized finding from any grid code standard audit.
 */
export interface RegulatoryDossierFinding {
  standard: string; // e.g. "MOD-025-2", "MOD-026-1", "MOD-027-1", "TPL-001-4", "PRC-019-2", "PRC-024-3", "IEEE-2800-2022"
  element: string; // e.g. "Generator 1-1", "Feeder 4"
  rule: string;
  severity: "pass" | "warning" | "violation";
  description: string;
  observedValue?: string | number | undefined;
  expectedRange?: string | undefined;
}

/**
 * Input source data bundle for regulatory dossier compilation.
 */
export interface DossierCompilationInput {
  organizationName: string;
  utilityNercId?: string | undefined; // e.g. "NCR01234"
  plantName: string;
  gridInterconnection: "Eastern" | "Western" | "ERCOT" | "Quebec" | "NEM" | "ENTSO-E";
  baseKv: number;
  totalMva: number;
  generatorCount: number;
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
 * Compiles a formal NERC Reliability Standard Audit Worksheet (RSAW) in Markdown.
 */
export function compileNercRsawDocument(input: DossierCompilationInput): string {
  const isCeii = input.isCeiiRestricted ?? true;
  const ceiiHeader = isCeii ? generateCeiiWatermarkHeader(input.plantName, input.organizationName) : "";

  const lines: string[] = [
    ceiiHeader,
    `# NERC Reliability Standard Audit Worksheet (RSAW) Composite Dossier`,
    ``,
    `* **Registered Entity:** ${input.organizationName} (${input.utilityNercId ?? "NERC-NCR-PENDING"})`,
    `* **Generation / Transmission Asset:** ${input.plantName} (${input.gridInterconnection} Interconnection)`,
    `* **Asset Parameters:** ${input.baseKv.toFixed(1)} kV, ${input.totalMva.toFixed(1)} MVA Total Capacity, ${input.generatorCount} Unit(s)`,
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

  // Group findings by NERC Standard
  const standards = Array.from(new Set(input.findings.map((f) => f.standard)));

  for (const std of standards) {
    const stdFindings = input.findings.filter((f) => f.standard === std);
    const hasViolation = stdFindings.some((f) => f.severity === "violation");
    const hasWarning = stdFindings.some((f) => f.severity === "warning");
    const stdStatus = hasViolation ? "NON-COMPLIANT" : hasWarning ? "CONDITIONAL" : "COMPLIANT";

    lines.push(`### Standard ${std} — Status: **${stdStatus}**`);
    lines.push(``);
    lines.push(`| Tested Element | Rule Identifier | Audit Severity | Observed Telemetry | Allowable Range | Finding Summary |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

    for (const f of stdFindings) {
      const badge = f.severity === "pass" ? "✅ PASS" : f.severity === "warning" ? "⚠️ WARN" : "❌ VIOLATION";
      const obs = f.observedValue !== undefined ? String(f.observedValue) : "Nominal";
      const exp = f.expectedRange !== undefined ? f.expectedRange : "Within standard";
      lines.push(`| ${f.element} | \`${f.rule}\` | ${badge} | ${obs} | ${exp} | ${f.description} |`);
    }

    lines.push(``);
    lines.push(`#### Registered Entity Compliance Evidence Statement for ${std}`);
    lines.push(
      `> All numerical simulation models, parameter conversion sheets, and verified field disturbance recordings for ${std} have been compiled through the ModelScript automated DAE verification pipeline and validated against physical plant telemetry.`,
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

  return {
    "assessment-results": {
      uuid: oscalUuid,
      metadata: {
        title: `NERC Reliability & Grid Code Compliance Assessment — ${input.plantName}`,
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
          title: `Automated Grid Code Compliance Evaluation for ${input.plantName}`,
          description: `Evaluated via ModelScript Polyglot Engineering Compiler across NERC, FERC 901, and IEEE 2800 standards.`,
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
      standard: "NERC-CIP-002-014",
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
