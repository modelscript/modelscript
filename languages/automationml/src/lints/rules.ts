// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — IEC 62714 CAEX Static Semantic Linter Rules.
 *
 * Implements diagnostic rules M8301–M8307:
 * - M8301 (aml-unresolved-base-class)
 * - M8302 (aml-inheritance-cycle)
 * - M8303 (aml-invalid-internal-link)
 * - M8304 (aml-port-direction-conflict)
 * - M8305 (aml-unsatisfied-role-requirement)
 * - M8306 (aml-broken-external-ref-uri)
 * - M8307 (aml-invalid-frame-transform)
 */

import type {
  AmlDiagnostic,
  AmlDocument,
  AmlExternalInterface,
  AmlInterfaceClass,
  AmlInternalElement,
  AmlRoleClass,
  AmlSourceRange,
  AmlSystemUnitClass,
} from "../types.js";

export const AmlErrorCode = {
  UNRESOLVED_BASE_CLASS: {
    code: "M8301",
    rule: "aml-unresolved-base-class",
    severity: "error" as const,
    message: (path: string, elementName: string) =>
      `Base class reference '${path}' in '${elementName}' does not resolve to a declared or standard AutomationML class.`,
  },
  INHERITANCE_CYCLE: {
    code: "M8302",
    rule: "aml-inheritance-cycle",
    severity: "error" as const,
    message: (className: string, cyclePath: string) =>
      `Circular inheritance detected in class '${className}': '${cyclePath}'.`,
  },
  INVALID_INTERNAL_LINK: {
    code: "M8303",
    rule: "aml-invalid-internal-link",
    severity: "error" as const,
    message: (linkName: string, partnerRef: string) =>
      `InternalLink '${linkName}' endpoint '${partnerRef}' does not resolve to a valid InternalElement and ExternalInterface.`,
  },
  PORT_DIRECTION_CONFLICT: {
    code: "M8304",
    rule: "aml-port-direction-conflict",
    severity: "error" as const,
    message: (linkName: string, detail: string) => `InternalLink '${linkName}' connects incompatible ports: ${detail}.`,
  },
  UNSATISFIED_ROLE_REQUIREMENT: {
    code: "M8305",
    rule: "aml-unsatisfied-role-requirement",
    severity: "error" as const,
    message: (elementName: string, rolePath: string, missingItem: string) =>
      `InternalElement '${elementName}' is missing required ${missingItem} mandated by RoleRequirement '${rolePath}'.`,
  },
  BROKEN_EXTERNAL_REF_URI: {
    code: "M8306",
    rule: "aml-broken-external-ref-uri",
    severity: "warning" as const,
    message: (interfaceName: string, elementName: string, uri: string) =>
      `External reference URI '${uri}' on interface '${interfaceName}' in '${elementName}' is empty or unresolved.`,
  },
  INVALID_FRAME_TRANSFORM: {
    code: "M8307",
    rule: "aml-invalid-frame-transform",
    severity: "error" as const,
    message: (elementName: string, reason: string) =>
      `Invalid 6-DOF Frame transformation on InternalElement '${elementName}': ${reason}.`,
  },
};

const STANDARD_AML_PREFIXES = [
  "automationmlbaseroleclasslib/",
  "automationmlinterfaceclasslib/",
  "automationmlbasesystemunitclasslib/",
  "automationmlcsroleclasslib/",
  "automationmldmiroleclasslib/",
  "automationmlbmiroleclasslib/",
  "automationmlcmiroleclasslib/",
  "automationmlfmiinterfaceclasslib/",
  "automationmlplcopenxmlinterfaceclasslib/",
  "automationmlcolladainterfaceclasslib/",
];

const STANDARD_AML_SHORT_NAMES = new Set([
  "automationmlbaserole",
  "automationmlbaseinterface",
  "automationmlbasesystemunit",
  "signalinterface",
  "plcopenxmlinterface",
  "logicinterface",
  "variableinterface",
  "colladainterface",
  "fmuinterface",
  "externaldataconnector",
  "communication",
  "order",
  "pprconnector",
  "product",
  "process",
  "resource",
  "structure",
  "mechatronicassembly",
  "baseunit",
  "frame",
]);

function isStandardAmlPath(path: string): boolean {
  const lower = path.trim().toLowerCase();
  if (!lower) return false;
  if (STANDARD_AML_SHORT_NAMES.has(lower)) return true;
  return STANDARD_AML_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function normalizeDataType(dt?: string): string | undefined {
  if (!dt) return undefined;
  const low = dt.trim().toLowerCase().replace(/^xs:/, "");
  if (low === "boolean" || low === "bool") return "BOOL";
  if (low === "double" || low === "float" || low === "decimal" || low === "real" || low === "lreal") {
    return "REAL";
  }
  if (
    low === "int" ||
    low === "integer" ||
    low === "short" ||
    low === "long" ||
    low === "byte" ||
    low === "dint" ||
    low === "uint"
  ) {
    return "INT";
  }
  if (low === "string") return "STRING";
  return low.toUpperCase();
}

export interface AmlLintOptions {
  availableUris?: string[] | undefined;
}

export function lintAutomationML(doc: AmlDocument, options?: AmlLintOptions): AmlDiagnostic[] {
  const diagnostics: AmlDiagnostic[] = [];

  // 1. Index declared SystemUnitClasses, RoleClasses, InterfaceClasses
  const sucMap = new Map<string, AmlSystemUnitClass>();
  const roleMap = new Map<string, AmlRoleClass>();
  const ifcMap = new Map<string, AmlInterfaceClass>();

  const registerSuc = (prefix: string, cls: AmlSystemUnitClass): void => {
    const fullPath = `${prefix}/${cls.name}`;
    sucMap.set(fullPath, cls);
    sucMap.set(cls.name, cls);
    for (const child of cls.children) {
      registerSuc(fullPath, child);
    }
  };
  for (const lib of doc.systemUnitClassLibs) {
    for (const cls of lib.classes) {
      registerSuc(lib.name, cls);
    }
  }

  const registerRole = (prefix: string, cls: AmlRoleClass): void => {
    const fullPath = `${prefix}/${cls.name}`;
    roleMap.set(fullPath, cls);
    roleMap.set(cls.name, cls);
    for (const child of cls.children) {
      registerRole(fullPath, child);
    }
  };
  for (const lib of doc.roleClassLibs) {
    for (const cls of lib.classes) {
      registerRole(lib.name, cls);
    }
  }

  const registerIfc = (prefix: string, cls: AmlInterfaceClass): void => {
    const fullPath = `${prefix}/${cls.name}`;
    ifcMap.set(fullPath, cls);
    ifcMap.set(cls.name, cls);
    for (const child of cls.children) {
      registerIfc(fullPath, child);
    }
  };
  for (const lib of doc.interfaceClassLibs) {
    for (const cls of lib.classes) {
      registerIfc(lib.name, cls);
    }
  }

  // 2. Check class hierarchies for unresolved base classes (M8301) and cycles (M8302)
  const checkClassHierarchy = <
    T extends { name: string; refBaseClassPath?: string | undefined; range: AmlSourceRange },
  >(
    classes: T[],
    map: Map<string, T>,
  ): void => {
    const reportedCycles = new Set<string>();
    for (const cls of classes) {
      if (!cls.refBaseClassPath) continue;
      if (!map.has(cls.refBaseClassPath) && !isStandardAmlPath(cls.refBaseClassPath)) {
        diagnostics.push({
          code: AmlErrorCode.UNRESOLVED_BASE_CLASS.code,
          rule: AmlErrorCode.UNRESOLVED_BASE_CLASS.rule,
          severity: AmlErrorCode.UNRESOLVED_BASE_CLASS.severity,
          message: AmlErrorCode.UNRESOLVED_BASE_CLASS.message(cls.refBaseClassPath, cls.name),
          range: cls.range,
        });
        continue;
      }

      // Cycle detection
      const chain: string[] = [cls.name];
      const visited = new Set<string>([cls.name]);
      let curr: T | undefined = map.get(cls.refBaseClassPath);
      while (curr) {
        chain.push(curr.name);
        if (visited.has(curr.name)) {
          if (curr.name === cls.name && !reportedCycles.has(cls.name)) {
            reportedCycles.add(cls.name);
            diagnostics.push({
              code: AmlErrorCode.INHERITANCE_CYCLE.code,
              rule: AmlErrorCode.INHERITANCE_CYCLE.rule,
              severity: AmlErrorCode.INHERITANCE_CYCLE.severity,
              message: AmlErrorCode.INHERITANCE_CYCLE.message(cls.name, chain.join(" -> ")),
              range: cls.range,
            });
          }
          break;
        }
        visited.add(curr.name);
        curr = curr.refBaseClassPath ? map.get(curr.refBaseClassPath) : undefined;
      }
    }
  };

  const uniqueSucs = Array.from(new Set(sucMap.values()));
  const uniqueRoles = Array.from(new Set(roleMap.values()));
  const uniqueIfcs = Array.from(new Set(ifcMap.values()));

  checkClassHierarchy(uniqueSucs, sucMap);
  checkClassHierarchy(uniqueRoles, roleMap);
  checkClassHierarchy(uniqueIfcs, ifcMap);

  // 3. Collect all InternalElements across all InstanceHierarchies
  const elementsById = new Map<string, AmlInternalElement>();
  const elementsByName = new Map<string, AmlInternalElement>();
  const interfacesByGlobalId = new Map<string, { element: AmlInternalElement; iface: AmlExternalInterface }>();
  const allElements: AmlInternalElement[] = [];

  const collectElements = (el: AmlInternalElement): void => {
    allElements.push(el);
    elementsById.set(el.id, el);
    elementsByName.set(el.name, el);
    for (const iface of el.interfaces) {
      interfacesByGlobalId.set(iface.id, { element: el, iface });
      interfacesByGlobalId.set(`${el.id}:${iface.name}`, { element: el, iface });
      interfacesByGlobalId.set(`${el.name}:${iface.name}`, { element: el, iface });
      interfacesByGlobalId.set(`${el.id}:${iface.id}`, { element: el, iface });
    }
    for (const child of el.children) {
      collectElements(child);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      collectElements(el);
    }
  }

  // 4. Validate each InternalElement
  const availableUriSet = options?.availableUris ? new Set(options.availableUris) : undefined;

  for (const el of allElements) {
    // M8301: Unresolved refBaseSystemUnitPath
    if (
      el.refBaseSystemUnitPath &&
      !sucMap.has(el.refBaseSystemUnitPath) &&
      !isStandardAmlPath(el.refBaseSystemUnitPath)
    ) {
      diagnostics.push({
        code: AmlErrorCode.UNRESOLVED_BASE_CLASS.code,
        rule: AmlErrorCode.UNRESOLVED_BASE_CLASS.rule,
        severity: AmlErrorCode.UNRESOLVED_BASE_CLASS.severity,
        message: AmlErrorCode.UNRESOLVED_BASE_CLASS.message(el.refBaseSystemUnitPath, el.name),
        range: el.range,
      });
    }

    // M8307: Invalid 6-DOF Frame transform
    if (el.frame) {
      const f = el.frame;
      const coords: [string, number][] = [
        ["x", f.x],
        ["y", f.y],
        ["z", f.z],
        ["rx", f.rx],
        ["ry", f.ry],
        ["rz", f.rz],
      ];
      const nonFinite = coords.find(([, val]) => !Number.isFinite(val));
      if (nonFinite) {
        diagnostics.push({
          code: AmlErrorCode.INVALID_FRAME_TRANSFORM.code,
          rule: AmlErrorCode.INVALID_FRAME_TRANSFORM.rule,
          severity: AmlErrorCode.INVALID_FRAME_TRANSFORM.severity,
          message: AmlErrorCode.INVALID_FRAME_TRANSFORM.message(
            el.name,
            `coordinate '${nonFinite[0]}' is non-finite (${String(nonFinite[1])})`,
          ),
          range: f.range ?? el.range,
        });
      } else if (Math.abs(f.rx) > 360 || Math.abs(f.ry) > 360 || Math.abs(f.rz) > 360) {
        diagnostics.push({
          code: AmlErrorCode.INVALID_FRAME_TRANSFORM.code,
          rule: AmlErrorCode.INVALID_FRAME_TRANSFORM.rule,
          severity: AmlErrorCode.INVALID_FRAME_TRANSFORM.severity,
          message: AmlErrorCode.INVALID_FRAME_TRANSFORM.message(
            el.name,
            `Euler orientation angles (rx=${f.rx}, ry=${f.ry}, rz=${f.rz}) exceed [-360, 360] deg bounds`,
          ),
          range: f.range ?? el.range,
        });
      }
    }

    // Gather element's own + inherited interfaces and attributes
    const baseSuc = el.refBaseSystemUnitPath ? sucMap.get(el.refBaseSystemUnitPath) : undefined;
    const presentIfNames = new Set<string>([
      ...el.interfaces.map((i) => i.name),
      ...(baseSuc ? baseSuc.interfaces.map((i) => i.name) : []),
    ]);
    const presentAttrNames = new Set<string>([
      ...el.attributes.map((a) => a.name),
      ...(baseSuc ? baseSuc.attributes.map((a) => a.name) : []),
    ]);

    // M8301 & M8305: RoleRequirements validation
    for (const rr of el.roleRequirements) {
      const roleClass = roleMap.get(rr.refBaseRoleClassPath);
      if (rr.refBaseRoleClassPath && !roleClass && !isStandardAmlPath(rr.refBaseRoleClassPath)) {
        diagnostics.push({
          code: AmlErrorCode.UNRESOLVED_BASE_CLASS.code,
          rule: AmlErrorCode.UNRESOLVED_BASE_CLASS.rule,
          severity: AmlErrorCode.UNRESOLVED_BASE_CLASS.severity,
          message: AmlErrorCode.UNRESOLVED_BASE_CLASS.message(rr.refBaseRoleClassPath, el.name),
          range: rr.range,
        });
      }

      const requiredIfs = new Set<string>([
        ...rr.requiredInterfaces,
        ...(roleClass ? roleClass.interfaces.map((i) => i.name) : []),
      ]);
      for (const reqIf of requiredIfs) {
        if (!presentIfNames.has(reqIf)) {
          diagnostics.push({
            code: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.code,
            rule: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.rule,
            severity: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.severity,
            message: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.message(
              el.name,
              rr.refBaseRoleClassPath,
              `interface '${reqIf}'`,
            ),
            range: rr.range,
          });
        }
      }

      const requiredAttrs = new Set<string>([
        ...rr.requiredAttributes,
        ...(roleClass ? roleClass.attributes.map((a) => a.name) : []),
      ]);
      for (const reqAttr of requiredAttrs) {
        if (!presentAttrNames.has(reqAttr)) {
          diagnostics.push({
            code: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.code,
            rule: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.rule,
            severity: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.severity,
            message: AmlErrorCode.UNSATISFIED_ROLE_REQUIREMENT.message(
              el.name,
              rr.refBaseRoleClassPath,
              `attribute '${reqAttr}'`,
            ),
            range: rr.range,
          });
        }
      }
    }

    // M8301 & M8306: ExternalInterface validation
    for (const iface of el.interfaces) {
      if (iface.refBaseClassPath && !ifcMap.has(iface.refBaseClassPath) && !isStandardAmlPath(iface.refBaseClassPath)) {
        diagnostics.push({
          code: AmlErrorCode.UNRESOLVED_BASE_CLASS.code,
          rule: AmlErrorCode.UNRESOLVED_BASE_CLASS.rule,
          severity: AmlErrorCode.UNRESOLVED_BASE_CLASS.severity,
          message: AmlErrorCode.UNRESOLVED_BASE_CLASS.message(iface.refBaseClassPath, `${el.name}.${iface.name}`),
          range: iface.range,
        });
      }

      if (iface.category === "PLCopenXML" || iface.category === "COLLADA") {
        const uriVal = iface.refUri?.trim() ?? "";
        if (!uriVal) {
          diagnostics.push({
            code: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.code,
            rule: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.rule,
            severity: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.severity,
            message: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.message(iface.name, el.name, "<empty>"),
            range: iface.range,
          });
        } else if (availableUriSet && !availableUriSet.has(uriVal)) {
          const stripped = uriVal.replace(/^file:\/\//, "").replace(/^\.\//, "");
          if (!availableUriSet.has(stripped)) {
            diagnostics.push({
              code: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.code,
              rule: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.rule,
              severity: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.severity,
              message: AmlErrorCode.BROKEN_EXTERNAL_REF_URI.message(iface.name, el.name, uriVal),
              range: iface.range,
            });
          }
        }
      }
    }

    // M8303 & M8304: InternalLinks validation
    for (const link of el.internalLinks) {
      const resolvePartner = (
        ref: string,
      ): { element: AmlInternalElement; iface: AmlExternalInterface } | undefined => {
        if (!ref) return undefined;
        const direct = interfacesByGlobalId.get(ref);
        if (direct) return direct;
        const sepIdx = ref.indexOf(":");
        if (sepIdx === -1) return undefined;
        const elKey = ref.slice(0, sepIdx).trim();
        const ifKey = ref.slice(sepIdx + 1).trim();
        const targetEl = elementsById.get(elKey) ?? elementsByName.get(elKey);
        if (!targetEl) return undefined;
        const targetIf = targetEl.interfaces.find((i) => i.name === ifKey || i.id === ifKey);
        if (!targetIf) return undefined;
        return { element: targetEl, iface: targetIf };
      };

      const sideA = resolvePartner(link.refPartnerSideA);
      const sideB = resolvePartner(link.refPartnerSideB);

      if (!sideA) {
        diagnostics.push({
          code: AmlErrorCode.INVALID_INTERNAL_LINK.code,
          rule: AmlErrorCode.INVALID_INTERNAL_LINK.rule,
          severity: AmlErrorCode.INVALID_INTERNAL_LINK.severity,
          message: AmlErrorCode.INVALID_INTERNAL_LINK.message(link.name, link.refPartnerSideA),
          range: link.range,
        });
      }
      if (!sideB) {
        diagnostics.push({
          code: AmlErrorCode.INVALID_INTERNAL_LINK.code,
          rule: AmlErrorCode.INVALID_INTERNAL_LINK.rule,
          severity: AmlErrorCode.INVALID_INTERNAL_LINK.severity,
          message: AmlErrorCode.INVALID_INTERNAL_LINK.message(link.name, link.refPartnerSideB),
          range: link.range,
        });
      }

      if (sideA && sideB) {
        const dirA = sideA.iface.direction;
        const dirB = sideB.iface.direction;

        if ((dirA === "Out" && dirB === "Out") || (dirA === "In" && dirB === "In")) {
          diagnostics.push({
            code: AmlErrorCode.PORT_DIRECTION_CONFLICT.code,
            rule: AmlErrorCode.PORT_DIRECTION_CONFLICT.rule,
            severity: AmlErrorCode.PORT_DIRECTION_CONFLICT.severity,
            message: AmlErrorCode.PORT_DIRECTION_CONFLICT.message(
              link.name,
              `'${link.refPartnerSideA}' (${dirA}) cannot drive '${link.refPartnerSideB}' (${dirB})`,
            ),
            range: link.range,
          });
        } else {
          const dtA = normalizeDataType(sideA.iface.dataType);
          const dtB = normalizeDataType(sideB.iface.dataType);
          if (dtA && dtB && dtA !== dtB) {
            diagnostics.push({
              code: AmlErrorCode.PORT_DIRECTION_CONFLICT.code,
              rule: AmlErrorCode.PORT_DIRECTION_CONFLICT.rule,
              severity: AmlErrorCode.PORT_DIRECTION_CONFLICT.severity,
              message: AmlErrorCode.PORT_DIRECTION_CONFLICT.message(
                link.name,
                `port data type mismatch between '${link.refPartnerSideA}' (${dtA}) and '${link.refPartnerSideB}' (${dtB})`,
              ),
              range: link.range,
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
