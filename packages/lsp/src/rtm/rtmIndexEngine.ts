// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import {
  STANDARD_MATRIX_PRESETS,
  type RtmAnalytics,
  type RtmDomain,
  type RtmElement,
  type RtmLink,
  type RtmLinkKind,
  type RtmMatrixPayload,
  type RtmPresetDefinition,
  type RtmVerificationEvidence,
} from "./rtmTypes.js";

/**
 * Builds and queries the multi-tier Digital Thread Traceability Matrix.
 */
export class RtmIndexEngine {
  /**
   * Returns all standard MBSE matrix preset definitions.
   */
  static getMatrixPresets(): RtmPresetDefinition[] {
    return STANDARD_MATRIX_PRESETS;
  }

  /**
   * Classifies a SymbolEntry into an RTM domain.
   */
  static classifyDomain(entry: SymbolEntry): RtmDomain | null {
    const rule = entry.ruleName ?? "";
    const resId = entry.resourceId ?? "";

    if (
      rule === "HazardDefinition" ||
      rule === "HazardUsage" ||
      entry.metadata?.defKind === "hazard" ||
      entry.metadata?.hazardId ||
      rule.toLowerCase().includes("hazard")
    ) {
      return "hazard";
    }

    if (
      rule === "RequirementDefinition" ||
      rule === "RequirementUsage" ||
      rule === "ConcernDefinition" ||
      rule === "ConcernUsage"
    ) {
      return "requirement";
    }

    if (
      rule === "VerificationCaseDefinition" ||
      rule === "VerificationCaseUsage" ||
      rule === "AnalysisCaseDefinition" ||
      rule === "AnalysisCaseUsage"
    ) {
      return "verification_case";
    }

    if (resId.endsWith(".mo") || rule === "ModelicaClass" || rule === "ClassDefinition") {
      return "modelica_physics";
    }

    if (rule === "PortDefinition" || rule === "PortUsage") {
      return "sysml_port";
    }

    if (
      rule === "ActionDefinition" ||
      rule === "ActionUsage" ||
      rule === "PerformActionUsage" ||
      rule === "ActivityDefinition" ||
      rule === "CalculationDefinition" ||
      rule === "CalculationUsage"
    ) {
      return "sysml_activity";
    }

    if (
      entry.metadata?.isPhysical ||
      entry.metadata?.category === "physical" ||
      rule === "PhysicalComponentDefinition" ||
      rule === "PhysicalComponentUsage" ||
      entry.name?.toLowerCase().startsWith("hw_") ||
      entry.name?.toLowerCase().startsWith("phy_")
    ) {
      return "physical_component";
    }

    if (rule === "PartDefinition" || rule === "PartUsage" || rule === "ItemDefinition" || rule === "ItemUsage") {
      return "sysml_logical";
    }

    return null;
  }

  /**
   * Extracts all RtmElements belonging to a specific domain from the SymbolIndex.
   */
  static extractElementsByDomain(index: SymbolIndex, domain: RtmDomain, uriFilter?: string): RtmElement[] {
    const elements: RtmElement[] = [];
    let seqId = 1;

    for (const entry of index.symbols.values()) {
      if (uriFilter && entry.resourceId && entry.resourceId !== uriFilter) continue;
      let elementDomain = this.classifyDomain(entry);

      // In allocation matrix, if physical_component is requested and no explicit physical components
      // are tagged, consider all PartUsage elements as allocatable targets
      if (domain === "physical_component" && !elementDomain) {
        if (entry.ruleName === "PartUsage" || entry.ruleName === "PartDefinition") {
          elementDomain = "physical_component";
        }
      }

      if (elementDomain !== domain) continue;

      const reqId =
        (entry.metadata?.id as string) ??
        (entry.metadata?.reqId as string) ??
        (domain === "requirement" ? `REQ-${String(seqId++).padStart(3, "0")}` : undefined);

      const hazardId =
        (entry.metadata?.hazardId as string) ??
        (entry.metadata?.id as string) ??
        (domain === "hazard" ? `HAZ-${String(seqId++).padStart(3, "0")}` : undefined);

      const text =
        (entry.metadata?.doc as string) ??
        (entry.metadata?.description as string) ??
        (entry.metadata?.text as string) ??
        "";

      let parentName = "";
      if (entry.parentId !== null) {
        const parent = index.symbols.get(entry.parentId);
        if (parent?.name) {
          parentName = parent.name;
        }
      }

      // Compute hierarchical package/container path for tree grouping
      const pathParts: string[] = [];
      let currParentId = entry.parentId;
      while (currParentId !== null) {
        const p = index.symbols.get(currParentId);
        if (p?.name) {
          pathParts.unshift(p.name);
        }
        currParentId = p ? p.parentId : null;
      }
      const packagePath = pathParts.join(".");

      let iso14971Data: any = undefined;
      if (domain === "hazard") {
        const sev = Number(entry.metadata?.severity ?? entry.metadata?.initialSeverity ?? 4);
        const prob = Number(entry.metadata?.probability ?? entry.metadata?.initialProbability ?? 3);
        const rpn = sev * prob;
        const resSev = Number(entry.metadata?.residualSeverity ?? Math.min(sev, 2));
        const resProb = Number(entry.metadata?.residualProbability ?? 1);
        const resRpn = resSev * resProb;
        iso14971Data = {
          hazardId: hazardId ?? entry.name,
          name: entry.name,
          description: text,
          initialSeverity: sev,
          initialProbability: prob,
          initialRpn: rpn,
          initialAcceptability: rpn >= 15 ? "Unacceptable" : rpn >= 8 ? "ALARP" : "Broadly Acceptable",
          residualSeverity: resSev,
          residualProbability: resProb,
          residualRpn: resRpn,
          residualAcceptability: resRpn >= 15 ? "Unacceptable" : resRpn >= 8 ? "ALARP" : "Broadly Acceptable",
          mitigationRequirementIds: entry.metadata?.mitigates
            ? [String(entry.metadata.mitigates)]
            : entry.metadata?.mitigatedBy
              ? [String(entry.metadata.mitigatedBy)]
              : [],
          status: entry.metadata?.mitigates || entry.metadata?.mitigatedBy ? "Mitigated" : "Unmitigated",
        };
      }

      elements.push({
        id: entry.id,
        qualifiedName: entry.name ?? `<anon_${entry.id}>`,
        name: entry.name ?? `<anon_${entry.id}>`,
        domain,
        type: entry.ruleName ?? entry.kind,
        uri: entry.resourceId ?? "",
        startByte: entry.startByte,
        endByte: entry.endByte,
        metadata: {
          reqId,
          hazardId,
          text,
          category: (entry.metadata?.category as string) ?? undefined,
          iso14971: iso14971Data,
          parentName: parentName || undefined,
          packagePath: packagePath || undefined,
          ...entry.metadata,
        },
      });
    }

    return elements.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Extracts all traceability links from the SymbolIndex.
   */
  static extractLinks(
    index: SymbolIndex,
    evidenceMap?: Map<string, RtmVerificationEvidence>,
    suspectMap?: Map<string, { isSuspect: boolean; reason?: string }>,
  ): { links: RtmLink[]; linkMap: Record<string, RtmLink> } {
    const links: RtmLink[] = [];
    const linkMap: Record<string, RtmLink> = {};

    for (const entry of index.symbols.values()) {
      const rule = entry.ruleName ?? "";
      let linkKind: RtmLinkKind | null = null;

      if (rule === "SatisfyRequirementUsage") linkKind = "satisfy";
      else if (rule === "VerifyRequirementUsage") linkKind = "verify";
      else if (rule === "AllocateDefinition" || rule === "AllocationUsage" || rule.includes("Allocate"))
        linkKind = "allocate";
      else if (rule === "ConnectionUsage" || rule === "BindingConnectorAsUsage" || rule.includes("Connect"))
        linkKind = "connect";
      else if (rule === "MitigateRequirementUsage" || rule.includes("Mitigate")) linkKind = "mitigate";
      else if (rule.includes("Refine")) linkKind = "refine";
      else if (rule.includes("Derive")) linkKind = "derive";

      // Also check Modelica/SysML metadata annotations for satisfies / verifies / mitigates / connects / allocates
      const metaSatisfies = entry.metadata?.satisfies as string | undefined;
      const metaVerifies = entry.metadata?.verifies as string | undefined;
      const metaMitigates = (entry.metadata?.mitigates ?? entry.metadata?.mitigatedBy) as string | undefined;
      const metaAllocates = (entry.metadata?.allocates ?? entry.metadata?.allocatedTo) as string | undefined;
      const metaConnects = (entry.metadata?.connects ?? entry.metadata?.connectedTo) as string | undefined;

      if (!linkKind && !metaSatisfies && !metaVerifies && !metaMitigates && !metaAllocates && !metaConnects) continue;

      let targetName = entry.name;
      let sourceName = "<unknown>";
      let sourceId = -1;
      let sourceUri = entry.resourceId ?? "";

      const children = (index.childrenOf.get(entry.id) ?? [])
        .map((cid) => index.symbols.get(cid))
        .filter(Boolean) as SymbolEntry[];
      const childRefs = children.filter((c) => c.kind === "Reference" || c.ruleName?.includes("Reference") || c.name);

      if ((linkKind === "connect" || linkKind === "allocate") && childRefs.length >= 2) {
        sourceName = childRefs[0]!.name ?? "<unknown>";
        sourceId = childRefs[0]!.id;
        targetName = childRefs[1]!.name ?? "<unknown>";
      } else if (entry.metadata?.source && entry.metadata?.target) {
        sourceName = String(entry.metadata.source);
        targetName = String(entry.metadata.target);
      } else if (metaSatisfies || metaVerifies || metaMitigates || metaAllocates || metaConnects) {
        linkKind = metaSatisfies
          ? "satisfy"
          : metaVerifies
            ? "verify"
            : metaMitigates
              ? "mitigate"
              : metaAllocates
                ? "allocate"
                : "connect";
        targetName = metaSatisfies ?? metaVerifies ?? metaMitigates ?? metaAllocates ?? metaConnects ?? "";
        sourceName = entry.name;
        sourceId = entry.id;
      } else {
        // Parent in SysML is the component or test case that owns the clause
        if (entry.parentId !== null) {
          const parent = index.symbols.get(entry.parentId);
          if (parent) {
            sourceName = parent.name ?? "<unknown>";
            sourceId = parent.id;
            sourceUri = parent.resourceId ?? sourceUri;
          }
        }
      }

      if (!targetName) continue;

      // Resolve target symbol ID
      let targetId = -1;
      let targetUri = "";
      const targetMatches = index.byName.get(targetName);
      if (targetMatches && targetMatches.length > 0) {
        for (const tid of targetMatches) {
          const t = index.symbols.get(tid);
          if (
            t &&
            (t.ruleName?.includes("Requirement") ||
              t.ruleName?.includes("Case") ||
              t.ruleName?.includes("Hazard") ||
              t.ruleName?.includes("Part") ||
              t.ruleName?.includes("Port"))
          ) {
            targetId = tid;
            targetUri = t.resourceId ?? "";
            break;
          }
        }
        if (targetId === -1) {
          targetId = targetMatches[0]!;
          targetUri = index.symbols.get(targetId)?.resourceId ?? "";
        }
      }

      const key = `${sourceName}|${targetName}`;
      const suspectInfo = suspectMap?.get(key);
      const evidence = evidenceMap?.get(targetName) ?? evidenceMap?.get(key);

      let status: RtmLink["status"] = "unverified";
      if (suspectInfo?.isSuspect) {
        status = "suspect";
      } else if (evidence) {
        status = evidence.isSatisfied ? "passed" : "failed";
      } else if (linkKind === "satisfy" || linkKind === "allocate" || linkKind === "mitigate") {
        status = "pending";
      }

      const link: RtmLink = {
        id: `${sourceName}->${targetName}`,
        linkKind,
        sourceId,
        sourceName,
        sourceUri,
        targetId,
        targetName,
        targetUri,
        status,
        evidence,
        isSuspect: suspectInfo?.isSuspect ?? false,
        suspectReason: suspectInfo?.reason,
        declarationUri: entry.resourceId ?? "",
        declarationStartByte: entry.startByte,
        declarationEndByte: entry.endByte,
      };

      links.push(link);
      linkMap[key] = link;
      linkMap[`${sourceId}|${targetId}`] = link;
    }

    return { links, linkMap };
  }

  /**
   * Computes holistic digital thread health metrics.
   */
  static computeAnalytics(
    allRequirements: RtmElement[],
    allComponents: RtmElement[],
    links: RtmLink[],
    allHazards: RtmElement[] = [],
  ): RtmAnalytics {
    const satisfiedReqNames = new Set<string>();
    const verifiedReqNames = new Set<string>();
    const connectedComponentNames = new Set<string>();
    const mitigatedHazardNames = new Set<string>();
    let suspectCount = 0;
    let failingCount = 0;

    for (const link of links) {
      if (link.linkKind === "satisfy") {
        satisfiedReqNames.add(link.targetName);
        connectedComponentNames.add(link.sourceName);
      }
      if (link.linkKind === "verify") {
        verifiedReqNames.add(link.targetName);
      }
      if (link.linkKind === "mitigate") {
        mitigatedHazardNames.add(link.sourceName);
        mitigatedHazardNames.add(link.targetName);
      }
      if (link.isSuspect) suspectCount++;
      if (link.status === "failed") failingCount++;
    }

    const orphanRequirements: string[] = [];
    for (const req of allRequirements) {
      if (!satisfiedReqNames.has(req.name)) {
        orphanRequirements.push(req.name);
      }
    }

    const unallocatedComponents: string[] = [];
    for (const comp of allComponents) {
      if (!connectedComponentNames.has(comp.name)) {
        unallocatedComponents.push(comp.name);
      }
    }

    const totalReqs = Math.max(allRequirements.length, 1);
    const satCount = satisfiedReqNames.size;
    const verCount = verifiedReqNames.size;

    // ISO 14971 Risk Analytics
    let unmitigatedHazardsCount = 0;
    let mitigatedHazardsCount = 0;
    let unacceptableResidualCount = 0;
    let totalRpnReduction = 0;

    for (const hazard of allHazards) {
      const isMitigated = mitigatedHazardNames.has(hazard.name);
      if (isMitigated) {
        mitigatedHazardsCount++;
      } else {
        unmitigatedHazardsCount++;
      }
      const iso = hazard.metadata?.iso14971;
      if (iso) {
        if (iso.residualAcceptability === "Unacceptable") {
          unacceptableResidualCount++;
        }
        if (iso.initialRpn && iso.residualRpn) {
          totalRpnReduction += iso.initialRpn - iso.residualRpn;
        }
      }
    }

    const avgRpnReduction =
      allHazards.length > 0 ? Math.round((totalRpnReduction / allHazards.length) * 10) / 10 : undefined;

    return {
      totalRequirements: allRequirements.length,
      satisfiedCount: satCount,
      satisfiedPercentage: Math.round((satCount / totalReqs) * 100),
      verifiedCount: verCount,
      verifiedPercentage: Math.round((verCount / totalReqs) * 100),
      orphanRequirements,
      unallocatedComponents,
      suspectLinkCount: suspectCount,
      failingLinkCount: failingCount,
      totalHazards: allHazards.length,
      mitigatedHazardsCount,
      unmitigatedHazardsCount,
      unacceptableResidualRiskCount: unacceptableResidualCount,
      averageRpnReduction: avgRpnReduction,
    };
  }

  /**
   * Generates a complete 2D matrix payload for the given row/col domains.
   */
  static buildMatrix(
    index: SymbolIndex,
    rowDomain: RtmDomain = "sysml_logical",
    colDomain: RtmDomain = "requirement",
    uriFilter?: string,
    evidenceMap?: Map<string, RtmVerificationEvidence>,
    suspectMap?: Map<string, { isSuspect: boolean; reason?: string }>,
  ): RtmMatrixPayload {
    const rows = this.extractElementsByDomain(index, rowDomain, uriFilter);
    const cols = this.extractElementsByDomain(index, colDomain, uriFilter);
    const { links, linkMap } = this.extractLinks(index, evidenceMap, suspectMap);

    const allRequirements =
      colDomain === "requirement" ? cols : this.extractElementsByDomain(index, "requirement", uriFilter);
    const allComponents =
      rowDomain === "sysml_logical" ? rows : this.extractElementsByDomain(index, "sysml_logical", uriFilter);
    const allHazards = this.extractElementsByDomain(index, "hazard", uriFilter);

    const analytics = this.computeAnalytics(allRequirements, allComponents, links, allHazards);

    return {
      rowDomain,
      colDomain,
      rows,
      cols,
      links: linkMap,
      analytics,
    };
  }
}
