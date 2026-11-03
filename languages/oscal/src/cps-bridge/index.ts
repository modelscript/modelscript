// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Continuous ATO (cATO) & Cyber-Physical Systems (CPS) Architecture Bridge.
 *
 * Cross-verifies engineering architecture models (SysML v2, AutomationML, PLCopen, Modelica)
 * against NIST OSCAL System Security Plans (SSPs) and NIST SP 800-82 Rev 3 OT/ICS overlays.
 */

import { MANDATORY_OT_ICS_CONTROLS } from "../catalogs/index.js";
import { lintOscalDocument } from "../lints/rules.js";
import type {
  OscalByComponent,
  OscalComponent,
  OscalComponentType,
  OscalDiagnostic,
  OscalDocument,
  OscalPoamItem,
} from "../types.js";

export interface CpsArchitectureComponent {
  name: string;
  kind: string;
  isSafetyCritical?: boolean | undefined;
  networkPorts?: string[] | undefined;
}

export interface CpsMappedComponentStatus {
  archName: string;
  oscalComponentUuid: string;
  oscalType: OscalComponentType;
  implementedControls: string[];
  missingMandatoryControls: string[];
}

export interface CpsComplianceAuditReport {
  compliant: boolean;
  coveragePercentage: number;
  mappedComponents: CpsMappedComponentStatus[];
  unmappedArchitectureComponents: string[];
  otOverlayViolations: { componentName: string; missingControls: string[] }[];
  synthesizedComponents: OscalComponent[];
  synthesizedByComponents: { controlId: string; byComponent: OscalByComponent }[];
  synthesizedPoamItems: OscalPoamItem[];
  diagnostics: OscalDiagnostic[];
}

function deterministicUuid(seed: string, index: number): string {
  let h1 = 0x811c9dc5 ^ index;
  let h2 = 0xc9dc5118 ^ (index * 31);
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  const idxHex = (index & 0xffff).toString(16).padStart(4, "0");
  return `${hex1}-${idxHex}-4${hex2.slice(1, 4)}-8${hex2.slice(4, 7)}-${hex1}${hex2.slice(0, 4)}`;
}

function inferOscalComponentType(kind: string, isSafetyCritical?: boolean): OscalComponentType {
  const lower = kind.toLowerCase();
  if (lower.includes("plc")) return "plc";
  if (lower.includes("ied") || lower.includes("relay")) return "ied";
  if (lower.includes("controller") || lower.includes("rtu") || lower.includes("dcs") || Boolean(isSafetyCritical)) {
    return "ot-controller";
  }
  if (lower.includes("hardware") || lower.includes("actuator") || lower.includes("sensor")) {
    return "hardware";
  }
  return "software";
}

/**
 * Performs continuous ATO (cATO) compliance verification between engineering architecture
 * components (SysML v2 / AutomationML) and an OSCAL System Security Plan (`OscalDocument`).
 */
export function auditCpsArchitectureCompliance(
  sspDoc: OscalDocument,
  sysmlOrAmlComponents: CpsArchitectureComponent[],
): CpsComplianceAuditReport {
  const sspComponents = [...(sspDoc.systemImplementation?.components ?? []), ...(sspDoc.components ?? [])];

  const mappedComponents: CpsMappedComponentStatus[] = [];
  const unmappedArchitectureComponents: string[] = [];
  const otOverlayViolations: { componentName: string; missingControls: string[] }[] = [];
  const synthesizedComponents: OscalComponent[] = [];
  const synthesizedByComponents: { controlId: string; byComponent: OscalByComponent }[] = [];
  const synthesizedPoamItems: OscalPoamItem[] = [];

  let uuidCounter = 1;
  let compliantArchCount = 0;

  for (const archComp of sysmlOrAmlComponents) {
    const matchedOscal = sspComponents.find(
      (c) =>
        c.title.toLowerCase() === archComp.name.toLowerCase() ||
        c.uuid.toLowerCase() === archComp.name.toLowerCase() ||
        (c.props ?? []).some((p) => p.value.toLowerCase() === archComp.name.toLowerCase()),
    );

    const inferredType = inferOscalComponentType(archComp.kind, archComp.isSafetyCritical);
    const requiresOtControls =
      Boolean(archComp.isSafetyCritical) ||
      inferredType === "plc" ||
      inferredType === "ied" ||
      inferredType === "ot-controller" ||
      matchedOscal?.type === "plc" ||
      matchedOscal?.type === "ied" ||
      matchedOscal?.type === "ot-controller";

    const requiredControls = new Set<string>();
    if (requiresOtControls) {
      for (const mc of MANDATORY_OT_ICS_CONTROLS) {
        requiredControls.add(mc);
      }
    }
    if (archComp.networkPorts && archComp.networkPorts.length > 0) {
      requiredControls.add("sc-7");
      requiredControls.add("cm-7");
    }

    if (!matchedOscal) {
      unmappedArchitectureComponents.push(archComp.name);
      const draftCompUuid = deterministicUuid(`comp:${archComp.name}`, uuidCounter++);
      synthesizedComponents.push({
        uuid: draftCompUuid,
        title: archComp.name,
        type: inferredType,
        description: `Auto-synthesized OSCAL component for CPS architecture block '${archComp.name}' (${archComp.kind}).`,
        status: "under-development",
      });

      const missingList = Array.from(requiredControls);
      for (const ctrlId of missingList) {
        synthesizedByComponents.push({
          controlId: ctrlId,
          byComponent: {
            componentUuid: draftCompUuid,
            uuid: deterministicUuid(`bycomp:${archComp.name}:${ctrlId}`, uuidCounter++),
            description: `Draft implementation of '${ctrlId}' for CPS component '${archComp.name}'.`,
            implementationStatus: "planned",
          },
        });
      }

      synthesizedPoamItems.push({
        uuid: deterministicUuid(`poam:unmapped:${archComp.name}`, uuidCounter++),
        title: `Map CPS architecture component '${archComp.name}' into SSP`,
        description: `Component '${archComp.name}' (${archComp.kind}) exists in the engineering architecture model but is missing from the OSCAL System Security Plan.`,
        targetControlId: "cm-8",
        status: "open",
      });
      continue;
    }

    // Component is mapped in SSP; check its implemented controls
    const implementedControls = new Set<string>();
    for (const ir of sspDoc.controlImplementation?.implementedRequirements ?? []) {
      const cid = ir.controlId.toLowerCase();
      if (!ir.byComponents || ir.byComponents.length === 0) {
        implementedControls.add(cid);
      } else if (ir.byComponents.some((bc) => bc.componentUuid.toLowerCase() === matchedOscal.uuid.toLowerCase())) {
        implementedControls.add(cid);
      }
    }

    const missingMandatoryControls = Array.from(requiredControls).filter((rc) => !implementedControls.has(rc));

    mappedComponents.push({
      archName: archComp.name,
      oscalComponentUuid: matchedOscal.uuid,
      oscalType: matchedOscal.type,
      implementedControls: Array.from(implementedControls),
      missingMandatoryControls,
    });

    if (missingMandatoryControls.length === 0) {
      compliantArchCount++;
    } else {
      otOverlayViolations.push({
        componentName: archComp.name,
        missingControls: missingMandatoryControls,
      });

      for (const ctrlId of missingMandatoryControls) {
        synthesizedByComponents.push({
          controlId: ctrlId,
          byComponent: {
            componentUuid: matchedOscal.uuid,
            uuid: deterministicUuid(`bycomp:${matchedOscal.uuid}:${ctrlId}`, uuidCounter++),
            description: `Remediate missing NIST SP 800-82 control '${ctrlId}' on component '${archComp.name}'.`,
            implementationStatus: "planned",
          },
        });

        synthesizedPoamItems.push({
          uuid: deterministicUuid(`poam:${archComp.name}:${ctrlId}`, uuidCounter++),
          title: `Implement mandatory OT control '${ctrlId}' on '${archComp.name}'`,
          description: `CPS component '${archComp.name}' is missing required control '${ctrlId}'.`,
          targetControlId: ctrlId,
          status: "open",
        });
      }
    }
  }

  const diagnostics = lintOscalDocument(sspDoc, {
    externalArchComponents: sysmlOrAmlComponents.map((c) => c.name),
  });

  const totalArch = sysmlOrAmlComponents.length;
  const coveragePercentage = totalArch === 0 ? 100 : Math.round((compliantArchCount / totalArch) * 10000) / 100;

  const compliant =
    unmappedArchitectureComponents.length === 0 &&
    otOverlayViolations.length === 0 &&
    diagnostics.every((d) => d.severity !== "error");

  return {
    compliant,
    coveragePercentage,
    mappedComponents,
    unmappedArchitectureComponents,
    otOverlayViolations,
    synthesizedComponents,
    synthesizedByComponents,
    synthesizedPoamItems,
    diagnostics,
  };
}
