// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — NIST OSCAL 1.1.x & NIST SP 800-82 CPS Compliance Linter Rules (M8201–M8208).
 *
 * Conforms to ModelScript diagnostic conventions:
 * 1. Single quotes around identifiers ('${id}').
 * 2. Period-terminated diagnostic messages.
 * 3. Exact error codes M8201–M8208 and rule identifiers.
 */

import { MANDATORY_OT_ICS_CONTROLS, getBuiltInControl, resolveBuiltInProfileHref } from "../catalogs/index.js";
import { extractReferencedParamIds } from "../resolver/index.js";
import type {
  OscalControl,
  OscalDiagnostic,
  OscalDocument,
  OscalGroup,
  OscalPoamItem,
  OscalSourceRange,
} from "../types.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OscalErrorCode = {
  INVALID_UUID: {
    code: "M8201",
    rule: "oscal-invalid-uuid",
    severity: "error" as const,
    malformedMessage: (uuid: string, elementKind: string) =>
      `Malformed UUID '${uuid}' on OSCAL element '${elementKind}'. Expected RFC 4122 UUID format.`,
    duplicateMessage: (uuid: string, elementKind: string) =>
      `Duplicate UUID '${uuid}' detected on OSCAL element '${elementKind}'. All UUIDs within an OSCAL document must be unique.`,
  },
  UNRESOLVED_CONTROL_ID: {
    code: "M8202",
    rule: "oscal-unresolved-control-id",
    severity: "error" as const,
    message: (controlId: string) =>
      `Referenced control '${controlId}' does not exist in the catalog or built-in NIST SP 800-53 / 800-82 baseline.`,
  },
  UNSET_REQUIRED_PARAMETER: {
    code: "M8203",
    rule: "oscal-unset-required-parameter",
    severity: "warning" as const,
    message: (paramId: string, contextName: string) =>
      `Required parameter '${paramId}' in '${contextName}' has no value assigned in 'set-parameter'.`,
  },
  UNIMPLEMENTED_BASELINE_CONTROL: {
    code: "M8204",
    rule: "oscal-unimplemented-baseline-control",
    severity: "error" as const,
    message: (controlId: string, profileHref: string) =>
      `Control '${controlId}' required by baseline profile '${profileHref}' is missing an 'implemented-requirement' in 'control-implementation'.`,
  },
  ORPHANED_BY_COMPONENT: {
    code: "M8205",
    rule: "oscal-orphaned-by-component",
    severity: "error" as const,
    message: (componentUuid: string, controlId: string) =>
      `Implementation 'by-component' in control '${controlId}' references component UUID '${componentUuid}' which is not declared in 'system-implementation.components'.`,
  },
  CPS_UNMAPPED_ARCHITECTURE_BLOCK: {
    code: "M8206",
    rule: "oscal-cps-unmapped-architecture-block",
    severity: "warning" as const,
    message: (blockName: string) =>
      `Architectural component '${blockName}' from linked SysML v2 / AutomationML model is missing from 'system-implementation.components'.`,
  },
  OT_ICS_OVERLAY_VIOLATION: {
    code: "M8207",
    rule: "oscal-ot-ics-overlay-violation",
    severity: "error" as const,
    message: (componentTitle: string, componentType: string, missingControls: string) =>
      `OT/ICS component '${componentTitle}' (type '${componentType}') is missing mandatory NIST SP 800-82 controls: '${missingControls}'.`,
  },
  UNMITIGATED_HIGH_FINDING: {
    code: "M8208",
    rule: "oscal-unmitigated-high-finding",
    severity: "error" as const,
    message: (findingTitle: string, severity: string, controlId: string) =>
      `Open '${severity}' finding '${findingTitle}' on control '${controlId}' lacks a linked remediation entry in POA&M.`,
  },
  MISSING_ASSESSMENT_OBJECTIVE: {
    code: "M8209",
    rule: "oscal-missing-assessment-objective",
    severity: "warning" as const,
    message: (statementId: string) =>
      `Control implementation statement '${statementId}' lacks an assessment objective link.`,
  },
  UNMAPPED_AUTHORIZATION_BOUNDARY: {
    code: "M8210",
    rule: "oscal-unmapped-authorization-boundary",
    severity: "error" as const,
    message: (componentId: string) =>
      `Component '${componentId}' within authorization boundary lacks declared responsible roles.`,
  },
  DEPRECATED_CRYPTOGRAPHIC_HASH: {
    code: "M8211",
    rule: "oscal-deprecated-cryptographic-hash",
    severity: "error" as const,
    message: (algorithm: string) =>
      `Cryptographic verification algorithm '${algorithm}' in asset baseline is deprecated (use SHA-256 or SHA-3).`,
  },
  UNRESOLVED_PARTY_UUID: {
    code: "M8212",
    rule: "oscal-unresolved-party-uuid",
    severity: "error" as const,
    message: (partyUuid: string) =>
      `Responsible party references unknown party UUID '${partyUuid}'.`,
  },
  EXPIRED_POAM_MILESTONE: {
    code: "M8213",
    rule: "oscal-expired-poam-milestone",
    severity: "warning" as const,
    message: (itemId: string, date: string) =>
      `POA&M item '${itemId}' milestone date '${date}' is in the past without completion flag.`,
  },
};

export interface OscalLintOptions {
  externalArchComponents?: string[] | undefined;
  catalogs?: OscalDocument[] | undefined;
  profiles?: OscalDocument[] | undefined;
  poamItems?: OscalPoamItem[] | undefined;
}

function collectLocalControls(doc: OscalDocument, map: Map<string, OscalControl>): void {
  const visit = (controls: OscalControl[]) => {
    for (const c of controls) {
      map.set(c.id.toLowerCase(), c);
      if (c.controls) visit(c.controls);
    }
  };
  if (doc.controls) visit(doc.controls);
  if (doc.groups) {
    const visitGroups = (groups: OscalGroup[]) => {
      for (const g of groups) {
        if (g.controls) visit(g.controls);
        if (g.groups) visitGroups(g.groups);
      }
    };
    visitGroups(doc.groups);
  }
}

export function lintOscalDocument(doc: OscalDocument, options?: OscalLintOptions): OscalDiagnostic[] {
  const diagnostics: OscalDiagnostic[] = [];
  const defaultRange: OscalSourceRange = doc.range;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. M8201: Invalid or duplicate UUIDs across document elements
  // ───────────────────────────────────────────────────────────────────────────
  const seenUuids = new Set<string>();
  const checkUuid = (uuid: string | undefined, elementKind: string, range?: OscalSourceRange) => {
    const targetRange = range ?? doc.uuidRange ?? defaultRange;
    if (!uuid || !UUID_REGEX.test(uuid)) {
      diagnostics.push({
        code: OscalErrorCode.INVALID_UUID.code,
        rule: OscalErrorCode.INVALID_UUID.rule,
        severity: OscalErrorCode.INVALID_UUID.severity,
        message: OscalErrorCode.INVALID_UUID.malformedMessage(uuid ?? "", elementKind),
        range: targetRange,
      });
      return;
    }
    const norm = uuid.toLowerCase();
    if (seenUuids.has(norm)) {
      diagnostics.push({
        code: OscalErrorCode.INVALID_UUID.code,
        rule: OscalErrorCode.INVALID_UUID.rule,
        severity: OscalErrorCode.INVALID_UUID.severity,
        message: OscalErrorCode.INVALID_UUID.duplicateMessage(uuid, elementKind),
        range: targetRange,
      });
    } else {
      seenUuids.add(norm);
    }
  };

  checkUuid(doc.uuid, doc.kind, doc.uuidRange);

  if (doc.components) {
    for (const comp of doc.components) {
      checkUuid(comp.uuid, `component:${comp.title}`, comp.range);
    }
  }
  if (doc.systemImplementation?.components) {
    for (const comp of doc.systemImplementation.components) {
      checkUuid(comp.uuid, `component:${comp.title}`, comp.range);
    }
  }
  if (doc.systemImplementation?.inventoryItems) {
    for (const item of doc.systemImplementation.inventoryItems) {
      checkUuid(item.uuid, "inventory-item", item.range);
    }
  }
  if (doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      checkUuid(ir.uuid, `implemented-requirement:${ir.controlId}`, ir.range);
      if (ir.byComponents) {
        for (const bc of ir.byComponents) {
          checkUuid(bc.uuid, `by-component:${ir.controlId}`, bc.range);
        }
      }
    }
  }
  if (doc.findings) {
    for (const f of doc.findings) {
      checkUuid(f.uuid, `finding:${f.title}`, f.range);
    }
  }
  if (doc.poamItems) {
    for (const p of doc.poamItems) {
      checkUuid(p.uuid, `poam-item:${p.title}`, p.range);
    }
  }

  // Build control lookup map from document + custom catalogs + built-in NIST catalog
  const localControls = new Map<string, OscalControl>();
  collectLocalControls(doc, localControls);
  if (options?.catalogs) {
    for (const cat of options.catalogs) {
      collectLocalControls(cat, localControls);
    }
  }

  const resolveControl = (controlId: string): OscalControl | undefined => {
    return localControls.get(controlId.toLowerCase()) ?? getBuiltInControl(controlId);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 2. M8202: Unresolved Control IDs
  // ───────────────────────────────────────────────────────────────────────────
  const checkControlExists = (controlId: string, range?: OscalSourceRange) => {
    if (!controlId || !resolveControl(controlId)) {
      diagnostics.push({
        code: OscalErrorCode.UNRESOLVED_CONTROL_ID.code,
        rule: OscalErrorCode.UNRESOLVED_CONTROL_ID.rule,
        severity: OscalErrorCode.UNRESOLVED_CONTROL_ID.severity,
        message: OscalErrorCode.UNRESOLVED_CONTROL_ID.message(controlId),
        range: range ?? defaultRange,
      });
    }
  };

  if (doc.imports) {
    for (const imp of doc.imports) {
      if (imp.includeControls) {
        for (const cid of imp.includeControls) {
          checkControlExists(cid, imp.range);
        }
      }
    }
  }
  if (doc.modify?.alters) {
    for (const alt of doc.modify.alters) {
      checkControlExists(alt.controlId, alt.range);
    }
  }
  if (doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      checkControlExists(ir.controlId, ir.range);
    }
  }
  if (doc.components) {
    for (const comp of doc.components) {
      if (comp.controlImplementations) {
        for (const ci of comp.controlImplementations) {
          for (const ir of ci.implementedRequirements) {
            checkControlExists(ir.controlId, ir.range);
          }
        }
      }
    }
  }
  if (doc.findings) {
    for (const f of doc.findings) {
      if (f.targetControlId) {
        checkControlExists(f.targetControlId, f.range);
      }
    }
  }
  if (doc.poamItems) {
    for (const p of doc.poamItems) {
      if (p.targetControlId) {
        checkControlExists(p.targetControlId, p.range);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. M8203: Unset Required Parameter
  // ───────────────────────────────────────────────────────────────────────────
  const assignedParams = new Map<string, string>();
  const recordSetParams = (
    setParams: { paramId: string; values: string[]; range?: OscalSourceRange | undefined }[] | undefined,
    contextName: string,
  ) => {
    if (!setParams) return;
    for (const sp of setParams) {
      const nonEmpty = sp.values.filter((v) => v.trim() !== "");
      if (nonEmpty.length === 0) {
        diagnostics.push({
          code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
          rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
          severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
          message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(sp.paramId, contextName),
          range: sp.range ?? defaultRange,
        });
      } else {
        assignedParams.set(sp.paramId.toLowerCase(), nonEmpty.join(", "));
      }
    }
  };

  recordSetParams(doc.modify?.setParameters, doc.kind);
  recordSetParams(doc.controlImplementation?.setParameters, "control-implementation");
  if (doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      recordSetParams(ir.setParameters, `control:${ir.controlId}`);
      if (ir.byComponents) {
        for (const bc of ir.byComponents) {
          recordSetParams(bc.setParameters, `by-component:${ir.controlId}`);
        }
      }
    }
  }

  // Check controls declared in document for unset parameters
  const checkDocControlsForUnsetParams = (controls: OscalControl[]) => {
    for (const ctrl of controls) {
      const localParamValues = new Set<string>();
      if (ctrl.params) {
        for (const p of ctrl.params) {
          const hasDefault = p.values && p.values.some((v) => v.trim() !== "");
          const hasAssigned = assignedParams.has(p.id.toLowerCase());
          if (hasDefault || hasAssigned) {
            localParamValues.add(p.id.toLowerCase());
          } else {
            diagnostics.push({
              code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
              rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
              severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
              message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(p.id, ctrl.id),
              range: p.range ?? ctrl.range ?? defaultRange,
            });
          }
        }
      }
      if (ctrl.parts) {
        for (const pt of ctrl.parts) {
          if (pt.prose) {
            for (const refParamId of extractReferencedParamIds(pt.prose)) {
              const normRef = refParamId.toLowerCase();
              const alreadyFlagged = ctrl.params?.some(
                (p) =>
                  p.id.toLowerCase() === normRef &&
                  !(p.values && p.values.some((v) => v.trim() !== "")) &&
                  !assignedParams.has(normRef),
              );
              if (!alreadyFlagged && !localParamValues.has(normRef) && !assignedParams.has(normRef)) {
                diagnostics.push({
                  code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
                  rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
                  severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
                  message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(refParamId, ctrl.id),
                  range: pt.range ?? ctrl.range ?? defaultRange,
                });
              }
            }
          }
        }
      }
      if (ctrl.controls) {
        checkDocControlsForUnsetParams(ctrl.controls);
      }
    }
  };

  if (doc.controls) checkDocControlsForUnsetParams(doc.controls);
  if (doc.groups) {
    for (const g of doc.groups) {
      if (g.controls) checkDocControlsForUnsetParams(g.controls);
    }
  }

  // Check profile / SSP references to catalog controls that have unset required parameters
  if (doc.kind === "profile" && doc.imports) {
    for (const imp of doc.imports) {
      for (const cid of imp.includeControls ?? []) {
        const ctrl = resolveControl(cid);
        if (ctrl?.params) {
          for (const p of ctrl.params) {
            const hasDefault = p.values && p.values.some((v) => v.trim() !== "");
            if (!hasDefault && !assignedParams.has(p.id.toLowerCase())) {
              diagnostics.push({
                code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
                rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
                severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
                message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(p.id, ctrl.id),
                range: imp.range ?? defaultRange,
              });
            }
          }
        }
      }
    }
  }

  if (doc.kind === "system-security-plan" && doc.controlImplementation?.implementedRequirements) {
    for (const ir of doc.controlImplementation.implementedRequirements) {
      const ctrl = resolveControl(ir.controlId);
      if (ctrl?.params) {
        for (const p of ctrl.params) {
          const hasDefault = p.values && p.values.some((v) => v.trim() !== "");
          if (!hasDefault && !assignedParams.has(p.id.toLowerCase())) {
            diagnostics.push({
              code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
              rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
              severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
              message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(p.id, ir.controlId),
              range: ir.range ?? defaultRange,
            });
          }
        }
      }
      if (ir.description) {
        for (const refParamId of extractReferencedParamIds(ir.description)) {
          if (!assignedParams.has(refParamId.toLowerCase())) {
            diagnostics.push({
              code: OscalErrorCode.UNSET_REQUIRED_PARAMETER.code,
              rule: OscalErrorCode.UNSET_REQUIRED_PARAMETER.rule,
              severity: OscalErrorCode.UNSET_REQUIRED_PARAMETER.severity,
              message: OscalErrorCode.UNSET_REQUIRED_PARAMETER.message(refParamId, ir.controlId),
              range: ir.range ?? defaultRange,
            });
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. M8204: Unimplemented Baseline Control in SSP
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.kind === "system-security-plan" && doc.importProfile?.href) {
    const profileHref = doc.importProfile.href;
    let requiredControls: string[] = [];

    const matchedProfile = options?.profiles?.find((pr) => pr.uuid === profileHref || profileHref.includes(pr.uuid));
    if (matchedProfile?.imports) {
      for (const imp of matchedProfile.imports) {
        if (imp.includeControls) {
          requiredControls.push(...imp.includeControls);
        }
      }
    } else {
      requiredControls = resolveBuiltInProfileHref(profileHref).requiredControlIds;
    }

    const implementedSet = new Set(
      (doc.controlImplementation?.implementedRequirements ?? []).map((ir) => ir.controlId.toLowerCase()),
    );

    for (const reqControlId of requiredControls) {
      if (!implementedSet.has(reqControlId.toLowerCase())) {
        diagnostics.push({
          code: OscalErrorCode.UNIMPLEMENTED_BASELINE_CONTROL.code,
          rule: OscalErrorCode.UNIMPLEMENTED_BASELINE_CONTROL.rule,
          severity: OscalErrorCode.UNIMPLEMENTED_BASELINE_CONTROL.severity,
          message: OscalErrorCode.UNIMPLEMENTED_BASELINE_CONTROL.message(reqControlId, profileHref),
          range: doc.importProfile.range ?? defaultRange,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. M8205: Orphaned by-component UUID in SSP
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.kind === "system-security-plan") {
    const declaredComponentUuids = new Set<string>();
    for (const comp of doc.systemImplementation?.components ?? []) {
      declaredComponentUuids.add(comp.uuid.toLowerCase());
    }
    for (const comp of doc.components ?? []) {
      declaredComponentUuids.add(comp.uuid.toLowerCase());
    }

    for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
      for (const bc of ir.byComponents ?? []) {
        if (!declaredComponentUuids.has(bc.componentUuid.toLowerCase())) {
          diagnostics.push({
            code: OscalErrorCode.ORPHANED_BY_COMPONENT.code,
            rule: OscalErrorCode.ORPHANED_BY_COMPONENT.rule,
            severity: OscalErrorCode.ORPHANED_BY_COMPONENT.severity,
            message: OscalErrorCode.ORPHANED_BY_COMPONENT.message(bc.componentUuid, ir.controlId),
            range: bc.range ?? ir.range ?? defaultRange,
          });
        }
      }
      for (const st of ir.statements ?? []) {
        for (const bc of st.byComponents ?? []) {
          if (!declaredComponentUuids.has(bc.componentUuid.toLowerCase())) {
            diagnostics.push({
              code: OscalErrorCode.ORPHANED_BY_COMPONENT.code,
              rule: OscalErrorCode.ORPHANED_BY_COMPONENT.rule,
              severity: OscalErrorCode.ORPHANED_BY_COMPONENT.severity,
              message: OscalErrorCode.ORPHANED_BY_COMPONENT.message(bc.componentUuid, ir.controlId),
              range: bc.range ?? st.range ?? ir.range ?? defaultRange,
            });
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. M8206: Unmapped CPS / SysML v2 / AutomationML Architecture Block
  // ───────────────────────────────────────────────────────────────────────────
  const externalArchComponents = [...(options?.externalArchComponents ?? [])];
  if (doc.metadata.props) {
    for (const prop of doc.metadata.props) {
      if (prop.name === "linked-architecture-block" || prop.name === "sysml-block" || prop.name === "aml-component") {
        externalArchComponents.push(prop.value);
      }
    }
  }

  if (externalArchComponents.length > 0) {
    const sspComponents = doc.systemImplementation?.components ?? doc.components ?? [];
    const mappedNames = new Set<string>();
    for (const comp of sspComponents) {
      mappedNames.add(comp.title.toLowerCase());
      mappedNames.add(comp.uuid.toLowerCase());
      for (const p of comp.props ?? []) {
        mappedNames.add(p.value.toLowerCase());
      }
    }

    for (const blockName of externalArchComponents) {
      if (!mappedNames.has(blockName.toLowerCase())) {
        diagnostics.push({
          code: OscalErrorCode.CPS_UNMAPPED_ARCHITECTURE_BLOCK.code,
          rule: OscalErrorCode.CPS_UNMAPPED_ARCHITECTURE_BLOCK.rule,
          severity: OscalErrorCode.CPS_UNMAPPED_ARCHITECTURE_BLOCK.severity,
          message: OscalErrorCode.CPS_UNMAPPED_ARCHITECTURE_BLOCK.message(blockName),
          range: doc.metadata.range ?? defaultRange,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. M8207: OT / ICS Overlay Violation (NIST SP 800-82 Rev 3)
  // ───────────────────────────────────────────────────────────────────────────
  const allComponents = [...(doc.systemImplementation?.components ?? []), ...(doc.components ?? [])];
  const otComponents = allComponents.filter((c) => c.type === "plc" || c.type === "ied" || c.type === "ot-controller");

  if (otComponents.length > 0) {
    for (const otComp of otComponents) {
      const coveredControls = new Set<string>();

      if (doc.controlImplementation?.implementedRequirements) {
        for (const ir of doc.controlImplementation.implementedRequirements) {
          const cid = ir.controlId.toLowerCase();
          if (!ir.byComponents || ir.byComponents.length === 0) {
            coveredControls.add(cid);
          } else if (ir.byComponents.some((bc) => bc.componentUuid.toLowerCase() === otComp.uuid.toLowerCase())) {
            coveredControls.add(cid);
          }
        }
      }

      if (otComp.controlImplementations) {
        for (const ci of otComp.controlImplementations) {
          for (const ir of ci.implementedRequirements) {
            coveredControls.add(ir.controlId.toLowerCase());
          }
        }
      }

      const missingMandatory = MANDATORY_OT_ICS_CONTROLS.filter((mc) => !coveredControls.has(mc));
      if (missingMandatory.length > 0) {
        diagnostics.push({
          code: OscalErrorCode.OT_ICS_OVERLAY_VIOLATION.code,
          rule: OscalErrorCode.OT_ICS_OVERLAY_VIOLATION.rule,
          severity: OscalErrorCode.OT_ICS_OVERLAY_VIOLATION.severity,
          message: OscalErrorCode.OT_ICS_OVERLAY_VIOLATION.message(
            otComp.title,
            otComp.type,
            missingMandatory.join(", "),
          ),
          range: otComp.range ?? defaultRange,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. M8208: Unmitigated High / Critical Finding without Linked POA&M
  // ───────────────────────────────────────────────────────────────────────────
  const allPoamItems = [...(doc.poamItems ?? []), ...(options?.poamItems ?? [])];
  if (doc.findings && doc.findings.length > 0) {
    for (const finding of doc.findings) {
      if ((finding.severity === "high" || finding.severity === "critical") && finding.status === "open") {
        const hasPoam = allPoamItems.some(
          (poam) =>
            (poam.relatedFindingUuid && poam.relatedFindingUuid.toLowerCase() === finding.uuid.toLowerCase()) ||
            (poam.targetControlId && poam.targetControlId.toLowerCase() === finding.targetControlId.toLowerCase()),
        );
        if (!hasPoam) {
          diagnostics.push({
            code: OscalErrorCode.UNMITIGATED_HIGH_FINDING.code,
            rule: OscalErrorCode.UNMITIGATED_HIGH_FINDING.rule,
            severity: OscalErrorCode.UNMITIGATED_HIGH_FINDING.severity,
            message: OscalErrorCode.UNMITIGATED_HIGH_FINDING.message(
              finding.title,
              finding.severity,
              finding.targetControlId,
            ),
            range: finding.range ?? defaultRange,
          });
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. M8209: Control implementation statement lacking assessment objective link
  // ───────────────────────────────────────────────────────────────────────────
  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    for (const st of ir.statements ?? []) {
      const hasDesc = Boolean(st.description && st.description.trim().length > 0);
      const hasByComp = Boolean(st.byComponents && st.byComponents.length > 0);
      if (!hasDesc && !hasByComp) {
        diagnostics.push({
          code: OscalErrorCode.MISSING_ASSESSMENT_OBJECTIVE.code,
          rule: OscalErrorCode.MISSING_ASSESSMENT_OBJECTIVE.rule,
          severity: OscalErrorCode.MISSING_ASSESSMENT_OBJECTIVE.severity,
          message: OscalErrorCode.MISSING_ASSESSMENT_OBJECTIVE.message(st.statementId),
          range: st.range ?? ir.range ?? defaultRange,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 10. M8210: Component within authorization boundary lacking responsible roles
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.kind === "system-security-plan" && doc.systemCharacteristics?.authorizationBoundary) {
    for (const comp of doc.systemImplementation?.components ?? []) {
      const hasRespRoles = Boolean(comp.responsibleRoles && comp.responsibleRoles.length > 0);
      const hasRoleProp = Boolean(comp.props?.some((p) => p.name === "responsible-role" || p.name === "role-id"));
      if (!hasRespRoles && !hasRoleProp) {
        diagnostics.push({
          code: OscalErrorCode.UNMAPPED_AUTHORIZATION_BOUNDARY.code,
          rule: OscalErrorCode.UNMAPPED_AUTHORIZATION_BOUNDARY.rule,
          severity: OscalErrorCode.UNMAPPED_AUTHORIZATION_BOUNDARY.severity,
          message: OscalErrorCode.UNMAPPED_AUTHORIZATION_BOUNDARY.message(comp.title || comp.uuid),
          range: comp.range ?? defaultRange,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 11. M8211: Deprecated cryptographic verification hash algorithm
  // ───────────────────────────────────────────────────────────────────────────
  const DEPRECATED_HASHES = new Set(["MD5", "SHA-1", "SHA1", "DES", "3DES", "RC4"]);
  const HASH_PROP_NAMES = new Set(["hash-algorithm", "algorithm", "crypto-hash", "checksum-algorithm"]);
  const checkPropsForDeprecatedHash = (
    props: { name: string; value: string; range?: OscalSourceRange | undefined }[] | undefined,
    fallback: OscalSourceRange,
  ) => {
    if (!props) return;
    for (const prop of props) {
      if (HASH_PROP_NAMES.has(prop.name.toLowerCase()) && DEPRECATED_HASHES.has(prop.value.trim().toUpperCase())) {
        diagnostics.push({
          code: OscalErrorCode.DEPRECATED_CRYPTOGRAPHIC_HASH.code,
          rule: OscalErrorCode.DEPRECATED_CRYPTOGRAPHIC_HASH.rule,
          severity: OscalErrorCode.DEPRECATED_CRYPTOGRAPHIC_HASH.severity,
          message: OscalErrorCode.DEPRECATED_CRYPTOGRAPHIC_HASH.message(prop.value.trim()),
          range: prop.range ?? fallback,
        });
      }
    }
  };
  checkPropsForDeprecatedHash(doc.metadata.props, doc.metadata.range ?? defaultRange);
  for (const comp of allComponents) {
    checkPropsForDeprecatedHash(comp.props, comp.range ?? defaultRange);
  }
  for (const item of doc.systemImplementation?.inventoryItems ?? []) {
    checkPropsForDeprecatedHash(item.props, item.range ?? defaultRange);
  }
  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    checkPropsForDeprecatedHash(ir.props, ir.range ?? defaultRange);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 12. M8212: Responsible party references unknown party UUID
  // ───────────────────────────────────────────────────────────────────────────
  const declaredPartyUuids = new Set((doc.metadata.parties ?? []).map((p) => p.uuid.toLowerCase()));
  if (doc.metadata.responsibleParties) {
    for (const rp of doc.metadata.responsibleParties) {
      for (const pUuid of rp.partyUuids) {
        if (!declaredPartyUuids.has(pUuid.toLowerCase())) {
          diagnostics.push({
            code: OscalErrorCode.UNRESOLVED_PARTY_UUID.code,
            rule: OscalErrorCode.UNRESOLVED_PARTY_UUID.rule,
            severity: OscalErrorCode.UNRESOLVED_PARTY_UUID.severity,
            message: OscalErrorCode.UNRESOLVED_PARTY_UUID.message(pUuid),
            range: doc.metadata.range ?? defaultRange,
          });
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 13. M8213: Expired POA&M milestone date without completion flag
  // ───────────────────────────────────────────────────────────────────────────
  const nowMs = Date.now();
  for (const poam of allPoamItems) {
    if (poam.status !== "closed" && poam.milestones) {
      for (const ms of poam.milestones) {
        if (ms.dueDate) {
          const dueMs = Date.parse(ms.dueDate);
          if (!Number.isNaN(dueMs) && dueMs < nowMs) {
            diagnostics.push({
              code: OscalErrorCode.EXPIRED_POAM_MILESTONE.code,
              rule: OscalErrorCode.EXPIRED_POAM_MILESTONE.rule,
              severity: OscalErrorCode.EXPIRED_POAM_MILESTONE.severity,
              message: OscalErrorCode.EXPIRED_POAM_MILESTONE.message(poam.title || poam.uuid, ms.dueDate),
              range: poam.range ?? defaultRange,
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
