// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Automated Certification & Compliance Matrix Generator.
 *
 * Implements rigorous, auditable safety compliance matrices linking regulatory requirements
 * (ISO 26262 ASIL-D, RTCA DO-178C DAL-A, SAE ARP4754A) across the 16-domain digital thread:
 *   Standard Clause -> SysML v2 Requirement -> Modelica Dynamic Model -> 3D CAE Deck -> Physical Test Evidence.
 */

import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "@modelscript/runtime";

export type SafetyIntegrityLevel =
  | "ASIL_A"
  | "ASIL_B"
  | "ASIL_C"
  | "ASIL_D"
  | "DAL_A"
  | "DAL_B"
  | "DAL_C"
  | "DAL_D"
  | "QM";

export interface ComplianceTraceItem {
  id: string;
  standardClause: string; // e.g. "ISO 26262-4:2018 Cl. 6.4.3 (Freedom from Interference)"
  title: string;
  safetyLevel: SafetyIntegrityLevel;
  sysmlRequirementId: string;
  allocatedComponent: string;
  modelicaModelRef?: string;
  caeDeckRef?: string;
  verificationMethod: "FormalProof" | "SimulationRobustness" | "PhysicalTelemetryTest" | "FaultInjectionFTA";
  verificationArtifactRef: string;
  verificationStatus: "VERIFIED" | "FAILED" | "PENDING";
  evidenceHash?: string;
  signOffEngineer?: string;
  timestamp?: string;
}

export interface ComplianceSummary {
  standardName: string;
  totalRequirements: number;
  verifiedCount: number;
  failedCount: number;
  pendingCount: number;
  compliancePercentage: number;
  isFullyCertified: boolean;
  asilBreakdown: Record<string, { total: number; verified: number }>;
}

export class ComplianceMatrixGenerator {
  private items = new Map<string, ComplianceTraceItem>();
  public readonly standardName: string;

  constructor(standardName: string = "ISO 26262 / DO-178C") {
    this.standardName = standardName;
  }

  public addItem(item: ComplianceTraceItem): void {
    this.items.set(item.id, item);
  }

  public getItem(id: string): ComplianceTraceItem | undefined {
    return this.items.get(id);
  }

  public getAllItems(): ComplianceTraceItem[] {
    return Array.from(this.items.values());
  }

  public computeSummary(): ComplianceSummary {
    const all = this.getAllItems();
    let verified = 0;
    let failed = 0;
    let pending = 0;
    const asilBreakdown: Record<string, { total: number; verified: number }> = {};

    for (const item of all) {
      if (item.verificationStatus === "VERIFIED") verified++;
      else if (item.verificationStatus === "FAILED") failed++;
      else pending++;

      const lvl = item.safetyLevel;
      if (!asilBreakdown[lvl]) asilBreakdown[lvl] = { total: 0, verified: 0 };
      asilBreakdown[lvl]!.total++;
      if (item.verificationStatus === "VERIFIED") asilBreakdown[lvl]!.verified++;
    }

    const total = all.length;
    const pct = total > 0 ? (verified / total) * 100 : 100;

    return {
      standardName: this.standardName,
      totalRequirements: total,
      verifiedCount: verified,
      failedCount: failed,
      pendingCount: pending,
      compliancePercentage: parseFloat(pct.toFixed(1)),
      isFullyCertified: total > 0 && failed === 0 && pending === 0,
      asilBreakdown,
    };
  }

  /**
   * Generates an auditable Markdown matrix ready for export or review.
   */
  public generateMarkdownReport(): string {
    const summary = this.computeSummary();
    const rows = this.getAllItems();

    let md = `# Safety Certification & Compliance Matrix\n\n`;
    md += `**Standard:** ${summary.standardName}\n`;
    md += `**Compliance Score:** ${summary.compliancePercentage}% (${summary.verifiedCount}/${summary.totalRequirements} verified)\n`;
    md += `**Audit Status:** ${summary.isFullyCertified ? "PASSED (Certified)" : "DEFICIENCIES DETECTED"}\n\n`;

    md += `| ID | Clause | Level | SysML Req | Component | Method | Status | Evidence Hash |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const r of rows) {
      const statusIcon =
        r.verificationStatus === "VERIFIED" ? "[PASS]" : r.verificationStatus === "FAILED" ? "[FAIL]" : "[PENDING]";
      md += `| ${r.id} | ${r.standardClause} | ${r.safetyLevel} | ${r.sysmlRequirementId} | ${r.allocatedComponent} | ${r.verificationMethod} | ${statusIcon} | \`${r.evidenceHash?.slice(0, 8) || "N/A"}\` |\n`;
    }

    return md;
  }

  /**
   * Federates compliance items into the DigitalThreadHypergraph across Safety and Verification domains.
   */
  public federateToHypergraph(hypergraph: DigitalThreadHypergraph, startThreadId: number = 1000): number[] {
    const threadSlots: number[] = [];
    let curId = startThreadId;

    for (const item of this.getAllItems()) {
      const slot = hypergraph.createThread(curId++, 0, ThreadRelation.Verifies);

      // Numeric pseudo-hash for node IDs
      const safetyNodeId = Math.abs(this.hashString(item.id)) % 100000;
      const reqNodeId = Math.abs(this.hashString(item.sysmlRequirementId)) % 100000;
      const verifNodeId = Math.abs(this.hashString(item.verificationArtifactRef)) % 100000;

      hypergraph.bindDomainNode(slot, ThreadDomain.Safety, safetyNodeId);
      hypergraph.bindDomainNode(slot, ThreadDomain.Requirements, reqNodeId);
      hypergraph.bindDomainNode(slot, ThreadDomain.Verification, verifNodeId);

      threadSlots.push(slot);
    }

    return threadSlots;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
