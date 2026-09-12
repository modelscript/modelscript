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
  source: "modelscript-digital-thread";
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
   */
  static diagnoseThread(
    threadId: string,
    domainElements: AlignedDomainElement[],
    tolerance: number = 0.05, // 5% tolerance
  ): ThreadDiagnostic[] {
    const diagnostics: ThreadDiagnostic[] = [];

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
          diagnostics.push({
            domain: "modelica",
            elementName: modelicaElem.name,
            severity: "warning",
            message: `[Digital Thread] Mass divergence: Modelica parameter mass (${moMass} kg) differs from CAD STEP geometry (${cadMass} kg) by ${(diffRel * 100).toFixed(1)}%. Run parameter inversion to synchronize.`,
            line: modelicaElem.line ?? 1,
            column: modelicaElem.column ?? 1,
            source: "modelscript-digital-thread",
          });
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
