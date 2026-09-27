// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cross-Domain Digital Thread Diagnostic Provider for LSP.
 *
 * Emits real-time language server diagnostics when cross-domain constraints diverge
 * (e.g., CAD mass vs. Modelica mass, unverified SysML requirements, or stale simulation caches).
 */

export interface ThreadDiagnostic {
  domain: string;
  elementName: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  length?: number;
  source: "modelscript-digital-thread";
  code?: string;
  threadId?: string | number;
  slot?: number;
  sourceDomain?: string;
  sourceValue?: number;
  targetDomain?: string;
  targetValue?: number;
  simplexConsensus?: number;
  unit?: string;
}

export interface AlignedDomainElement {
  domain: string;
  name: string;
  line?: number;
  column?: number;
  properties?: Record<string, any>;
  status?: "synced" | "stale" | "conflict" | "unverified";
}

export class ThreadDiagnosticsProvider {
  /**
   * Evaluates cross-domain consistency across aligned digital thread projections.
   *
   * @param threadId - Unique digital thread alignment identifier.
   * @param domainElements - Aligned domain projections across SysML, Modelica, CAD, etc.
   * @param tolerance - Relative numerical tolerance for physics parameter divergence.
   * @param conflict - Optional Formal Semantic Theory Coordinator conflict clause.
   * @param targetDomain - Optional target domain filter ("all", specific domain like "modelica", or undefined for primary).
   */
  static diagnoseThread(
    threadId: string | number,
    domainElements: AlignedDomainElement[],
    tolerance: number = 0.05, // 5% tolerance
    conflict?: { explanation?: string; culpritEntities?: string[] },
    targetDomain?: string,
  ): ThreadDiagnostic[] {
    const diagnostics: ThreadDiagnostic[] = [];

    // 0. Check Formal Semantic Theory Coordinator conflict clause
    if (conflict) {
      let targetElements: AlignedDomainElement[] = [];
      if (targetDomain && targetDomain.toLowerCase() !== "all") {
        const match = domainElements.filter((e) => e.domain.toLowerCase() === targetDomain.toLowerCase());
        targetElements = match.length > 0 ? match : [];
      } else if (targetDomain === "all") {
        targetElements = domainElements;
      } else {
        const primary = domainElements.find((e) => e.domain === "sysml2" || e.domain === "sysml") || domainElements[0];
        if (primary) targetElements = [primary];
      }

      for (const elem of targetElements) {
        const culprit =
          conflict.culpritEntities?.find(
            (c) =>
              c.toLowerCase().includes(elem.name.toLowerCase()) ||
              elem.name.toLowerCase().includes(c.toLowerCase()) ||
              (elem.properties && c in elem.properties),
          ) ||
          conflict.culpritEntities?.[0] ||
          elem.name ||
          String(threadId);

        diagnostics.push({
          domain: elem.domain,
          elementName: culprit,
          severity: "error",
          code: "THREAD_THEORY_CONFLICT",
          threadId,
          slot: typeof threadId === "number" ? threadId : undefined,
          message: `[Digital Thread Theory Conflict] ${conflict.explanation || "Formal theory contradiction detected."}`,
          line: elem.line ?? 1,
          column: elem.column ?? 1,
          source: "modelscript-digital-thread",
        });
      }
    }

    const sysmlElem = domainElements.find((e) => e.domain === "sysml2" || e.domain === "sysml");
    const modelicaElem = domainElements.find((e) => e.domain === "modelica");
    const cadElem = domainElements.find((e) => e.domain === "cad" || e.domain === "step");
    const reqElem = domainElements.find((e) => e.domain === "requirements" || e.domain === "reqif");

    // 1. Check CAD vs Modelica Mass / Inertia divergence
    if (cadElem?.properties && modelicaElem?.properties) {
      const cadMass = Number(cadElem.properties["mass"]);
      const moMass = Number(modelicaElem.properties["mass"] ?? modelicaElem.properties["m"]);

      if (!isNaN(cadMass) && !isNaN(moMass) && cadMass > 0 && moMass > 0) {
        const diffRel = Math.abs(cadMass - moMass) / moMass;
        if (diffRel > tolerance) {
          const consensus = (cadMass + moMass) / 2;
          diagnostics.push({
            domain: "modelica",
            elementName: modelicaElem.name,
            severity: "warning",
            code: "THREAD_DIVERGENCE",
            threadId,
            sourceDomain: "cad",
            sourceValue: cadMass,
            targetDomain: "modelica",
            targetValue: moMass,
            simplexConsensus: consensus,
            unit: "kg",
            message: `[Digital Thread] Mass divergence: Modelica parameter mass (${moMass} kg) differs from CAD STEP geometry (${cadMass} kg) by ${(diffRel * 100).toFixed(1)}%. Physics-simplex consensus: ${consensus.toFixed(2)} kg.`,
            line: modelicaElem.line ?? 1,
            column: modelicaElem.column ?? 1,
            source: "modelscript-digital-thread",
          });
        }
      }
    }

    // 2. Check SysML v2 vs Modelica parameter divergence (mass, voltage, etc.)
    if (sysmlElem?.properties && modelicaElem?.properties) {
      for (const [propKey, sysmlValRaw] of Object.entries(sysmlElem.properties)) {
        const sysmlVal = Number(sysmlValRaw);
        const moValRaw = modelicaElem.properties[propKey];
        const moVal = Number(moValRaw);
        if (!isNaN(sysmlVal) && !isNaN(moVal) && sysmlVal > 0 && moVal > 0) {
          const diffRel = Math.abs(sysmlVal - moVal) / Math.max(sysmlVal, moVal);
          if (diffRel > tolerance) {
            const consensus = (sysmlVal + moVal) / 2;
            const unit = propKey.toLowerCase().includes("volt")
              ? "V"
              : propKey.toLowerCase().includes("mass")
                ? "kg"
                : "";
            diagnostics.push({
              domain: "modelica",
              elementName: modelicaElem.name,
              severity: "error",
              code: "THREAD_CONFLICT",
              threadId,
              sourceDomain: "sysml2",
              sourceValue: sysmlVal,
              targetDomain: "modelica",
              targetValue: moVal,
              simplexConsensus: consensus,
              unit,
              message: `[Digital Thread Conflict] Parameter '${propKey}' divergence: Modelica (${moVal}${unit ? " " + unit : ""}) conflicts with SysML v2 source (${sysmlVal}${unit ? " " + unit : ""}). SMT physics-simplex consensus: ${consensus.toFixed(2)}${unit ? " " + unit : ""}.`,
              line: modelicaElem.line ?? 1,
              column: modelicaElem.column ?? 1,
              source: "modelscript-digital-thread",
            });
            diagnostics.push({
              domain: "sysml2",
              elementName: sysmlElem.name,
              severity: "error",
              code: "THREAD_CONFLICT",
              threadId,
              sourceDomain: "sysml2",
              sourceValue: sysmlVal,
              targetDomain: "modelica",
              targetValue: moVal,
              simplexConsensus: consensus,
              unit,
              message: `[Digital Thread Conflict] Parameter '${propKey}' divergence: SysML v2 source (${sysmlVal}${unit ? " " + unit : ""}) conflicts with Modelica (${moVal}${unit ? " " + unit : ""}). SMT physics-simplex consensus: ${consensus.toFixed(2)}${unit ? " " + unit : ""}.`,
              line: sysmlElem.line ?? 1,
              column: sysmlElem.column ?? 1,
              source: "modelscript-digital-thread",
            });
          }
        }
      }
    }

    // 2. Check Requirement verification status
    if (reqElem) {
      if (reqElem.status === "unverified") {
        diagnostics.push({
          domain: "sysml2",
          elementName: reqElem.name,
          severity: "info",
          message: `[Digital Thread] Requirement '${reqElem.name}' is satisfied by architecture but lacks an automated dynamic simulation verification harness.`,
          line: reqElem.line ?? 1,
          column: reqElem.column ?? 1,
          source: "modelscript-digital-thread",
        });
      } else if (reqElem.status === "conflict") {
        diagnostics.push({
          domain: "sysml2",
          elementName: reqElem.name,
          severity: "error",
          message: `[Digital Thread] Requirement '${reqElem.name}' is VIOLATED by current simulation results.`,
          line: reqElem.line ?? 1,
          column: reqElem.column ?? 1,
          source: "modelscript-digital-thread",
        });
      }
    }

    // 3. Stale alignment check
    for (const elem of domainElements) {
      if (elem.status === "stale") {
        diagnostics.push({
          domain: elem.domain,
          elementName: elem.name,
          severity: "warning",
          message: `[Digital Thread] Upstream dependencies changed. Domain projection '${elem.domain}:${elem.name}' is stale and pending re-synchronization.`,
          line: elem.line ?? 1,
          column: elem.column ?? 1,
          source: "modelscript-digital-thread",
        });
      }
    }

    return diagnostics;
  }
}
