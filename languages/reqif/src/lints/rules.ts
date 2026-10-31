// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Pre-Flight Diagnostic Rules (M7001–M7010).
 *
 * Implements static semantics and requirements engineering rule checks
 * with OpenModelica-style diagnostic formatting and 1-click Quick-Fix actions.
 */

import type { ReqIfDiagnostic, ReqIfDocument, ReqIfSpecHierarchy } from "../types.js";

export const ReqIfErrorCode = {
  DANGLING_RELATION: {
    code: 7001,
    rule: "dangling-requirement-relation",
    severity: "error" as const,
    message: (relId: string, missingId: string, role: "source" | "target") =>
      `Requirement relation '${relId}' references missing ${role} requirement '${missingId}'.`,
  },
  TYPE_ATTRIBUTE_MISMATCH: {
    code: 7002,
    rule: "type-attribute-mismatch",
    severity: "error" as const,
    message: (attrName: string, expectedType: string, actualValue: string) =>
      `Attribute '${attrName}' expected type '${expectedType}', but got value '${actualValue}'.`,
  },
  CIRCULAR_HIERARCHY: {
    code: 7003,
    rule: "circular-requirement-hierarchy",
    severity: "error" as const,
    message: (reqId: string, cyclePath: string) =>
      `Circular requirement hierarchy detected at '${reqId}' along cycle path [${cyclePath}].`,
  },
  UNVERIFIED_LEAF_REQUIREMENT: {
    code: 7004,
    rule: "unverified-leaf-requirement",
    severity: "warning" as const,
    message: (reqId: string) => `Leaf requirement '${reqId}' has no outgoing 'verifies' or 'satisfies' relation.`,
  },
  UNBOUNDED_FORMAL_CONTRACT: {
    code: 7005,
    rule: "unbounded-formal-contract",
    severity: "warning" as const,
    message: (reqId: string) =>
      `Requirement '${reqId}' is marked safety/functional but lacks a bounded mathematical contract.`,
  },
  DUPLICATE_SPEC_OBJECT_ID: {
    code: 7006,
    rule: "duplicate-spec-object-id",
    severity: "error" as const,
    message: (reqId: string) => `Duplicate requirement identifier '${reqId}' declared in specification.`,
  },
  MISSING_MANDATORY_ATTRIBUTE: {
    code: 7007,
    rule: "missing-mandatory-attribute",
    severity: "error" as const,
    message: (reqId: string, attrName: string) =>
      `Requirement '${reqId}' is missing mandatory attribute '${attrName}'.`,
  },
  EMPTY_SPECIFICATION: {
    code: 7008,
    rule: "empty-specification",
    severity: "warning" as const,
    message: (specId: string) => `Specification '${specId}' contains no requirement hierarchies.`,
  },
  UNRESOLVED_TYPE_REFERENCE: {
    code: 7009,
    rule: "unresolved-type-reference",
    severity: "error" as const,
    message: (elementId: string, typeRef: string) => `Element '${elementId}' references undefined type '${typeRef}'.`,
  },
  INVALID_CONTRACT_COMPARATOR: {
    code: 7010,
    rule: "invalid-contract-comparator",
    severity: "error" as const,
    message: (reqId: string, comp: string) => `Requirement '${reqId}' specifies invalid contract comparator '${comp}'.`,
  },
};

export function lintReqIf(doc: ReqIfDocument): ReqIfDiagnostic[] {
  const diagnostics: ReqIfDiagnostic[] = [];

  // M7006: Duplicate Identifiers (recorded during parsing before Map.set overwrites)
  if (doc.duplicateIdentifiers && doc.duplicateIdentifiers.length > 0) {
    for (const dup of doc.duplicateIdentifiers) {
      diagnostics.push({
        code: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.code,
        rule: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.rule,
        severity: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.severity,
        message: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.message(dup.id),
        span: dup.span,
      });
    }
  } else {
    const seenRelIds = new Set<string>();
    for (const rel of doc.specRelations) {
      if (seenRelIds.has(rel.identifier) || doc.specObjects.has(rel.identifier)) {
        diagnostics.push({
          code: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.code,
          rule: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.rule,
          severity: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.severity,
          message: ReqIfErrorCode.DUPLICATE_SPEC_OBJECT_ID.message(rel.identifier),
          span: rel.span,
        });
      }
      seenRelIds.add(rel.identifier);
    }
  }

  // M7009, M7007, M7002, M7005, M7010: Spec Object Type, Mandatory Attributes, Attribute Type/Bounds, and Contracts
  for (const obj of doc.specObjects.values()) {
    const specType = obj.typeRef ? doc.specTypes.get(obj.typeRef) : undefined;
    if (obj.typeRef && !specType) {
      diagnostics.push({
        code: ReqIfErrorCode.UNRESOLVED_TYPE_REFERENCE.code,
        rule: ReqIfErrorCode.UNRESOLVED_TYPE_REFERENCE.rule,
        severity: ReqIfErrorCode.UNRESOLVED_TYPE_REFERENCE.severity,
        message: ReqIfErrorCode.UNRESOLVED_TYPE_REFERENCE.message(obj.identifier, obj.typeRef),
        span: obj.span,
      });
    } else if (specType) {
      // Check mandatory attributes
      for (const ad of specType.attributeDefinitions.values()) {
        if (ad.isMandatory) {
          const hasAttr = obj.attributes.has(ad.identifier) || obj.attributes.has(ad.longName || "");
          if (!hasAttr) {
            diagnostics.push({
              code: ReqIfErrorCode.MISSING_MANDATORY_ATTRIBUTE.code,
              rule: ReqIfErrorCode.MISSING_MANDATORY_ATTRIBUTE.rule,
              severity: ReqIfErrorCode.MISSING_MANDATORY_ATTRIBUTE.severity,
              message: ReqIfErrorCode.MISSING_MANDATORY_ATTRIBUTE.message(obj.identifier, ad.longName || ad.identifier),
              span: obj.span,
            });
          }
        }
      }
    }

    // M7002: Check attribute values against datatype definitions, min/max bounds, and literal types
    for (const attr of obj.attributes.values()) {
      const ad =
        specType?.attributeDefinitions.get(attr.definitionRef) ??
        (specType
          ? Array.from(specType.attributeDefinitions.values()).find(
              (a) => a.longName === attr.name || a.identifier === attr.name,
            )
          : undefined);
      const dt = ad?.dataTypeRef ? doc.dataTypes.get(ad.dataTypeRef) : undefined;
      const expectedKind = dt?.kind ?? ad?.kind ?? attr.kind;
      const displayName = ad?.longName || attr.name || attr.definitionRef;

      let mismatchExpected: string | undefined;
      if (ad && ad.kind !== attr.kind) {
        mismatchExpected = ad.kind;
      } else if (dt && dt.kind !== attr.kind) {
        mismatchExpected = dt.kind;
      } else if (expectedKind === "INTEGER" && (typeof attr.value !== "number" || !Number.isInteger(attr.value))) {
        mismatchExpected = "INTEGER";
      } else if (expectedKind === "REAL" && (typeof attr.value !== "number" || Number.isNaN(attr.value))) {
        mismatchExpected = "REAL";
      } else if (expectedKind === "BOOLEAN" && typeof attr.value !== "boolean") {
        mismatchExpected = "BOOLEAN";
      } else if (dt && typeof attr.value === "number") {
        if (dt.min !== undefined && attr.value < dt.min) {
          mismatchExpected = `${dt.kind} >= ${dt.min}`;
        } else if (dt.max !== undefined && attr.value > dt.max) {
          mismatchExpected = `${dt.kind} <= ${dt.max}`;
        }
      } else if (dt && dt.kind === "ENUMERATION" && dt.enumValues && dt.enumValues.length > 0) {
        const valStr = String(attr.value);
        const validEnum = dt.enumValues.some((ev) => ev.identifier === valStr || ev.longName === valStr);
        if (!validEnum) {
          mismatchExpected = `ENUMERATION(${dt.identifier})`;
        }
      }

      if (mismatchExpected) {
        diagnostics.push({
          code: ReqIfErrorCode.TYPE_ATTRIBUTE_MISMATCH.code,
          rule: ReqIfErrorCode.TYPE_ATTRIBUTE_MISMATCH.rule,
          severity: ReqIfErrorCode.TYPE_ATTRIBUTE_MISMATCH.severity,
          message: ReqIfErrorCode.TYPE_ATTRIBUTE_MISMATCH.message(displayName, mismatchExpected, String(attr.value)),
          span: attr.span ?? obj.span,
        });
      }
    }

    // M7010: Invalid contract comparator in requirement text or contract object
    const validComparators = new Set(["<=", "<", ">=", ">", "==", "!="]);
    if (obj.contract && !validComparators.has(obj.contract.comparator)) {
      diagnostics.push({
        code: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.code,
        rule: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.rule,
        severity: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.severity,
        message: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.message(obj.identifier, obj.contract.comparator),
        span: obj.span,
      });
    } else if (!obj.contract && obj.text) {
      const normalizedText = obj.text.replace(/<[^<>]+>/g, " ").trim();
      const badCompMatch =
        /\b([a-zA-Z_][a-zA-Z0-9_.\s]*?)\s*(===|!==|=<|=>|<>|~=|><|<<|>>|(?<![<>!=])=(?!=))\s*[-+]?[0-9]*\.?[0-9]+/.exec(
          normalizedText,
        );
      if (badCompMatch && badCompMatch[2]) {
        diagnostics.push({
          code: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.code,
          rule: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.rule,
          severity: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.severity,
          message: ReqIfErrorCode.INVALID_CONTRACT_COMPARATOR.message(obj.identifier, badCompMatch[2]),
          span: obj.span,
        });
      }
    }

    // M7005: Unbounded formal contract for safety-critical requirements
    if (obj.asilLevel && obj.asilLevel !== "QM" && !obj.contract) {
      diagnostics.push({
        code: ReqIfErrorCode.UNBOUNDED_FORMAL_CONTRACT.code,
        rule: ReqIfErrorCode.UNBOUNDED_FORMAL_CONTRACT.rule,
        severity: ReqIfErrorCode.UNBOUNDED_FORMAL_CONTRACT.severity,
        message: ReqIfErrorCode.UNBOUNDED_FORMAL_CONTRACT.message(obj.identifier),
        span: obj.span,
        quickFix: {
          title: `Add formal bound to ${obj.identifier}`,
          replacement: `${obj.text} [contract: val <= 100]`,
        },
      });
    }
  }

  // M7001: Dangling Relations
  const outgoingRelations = new Set<string>();
  const incomingRelations = new Set<string>();

  for (const rel of doc.specRelations) {
    if (rel.sourceId && !doc.specObjects.has(rel.sourceId)) {
      diagnostics.push({
        code: ReqIfErrorCode.DANGLING_RELATION.code,
        rule: ReqIfErrorCode.DANGLING_RELATION.rule,
        severity: ReqIfErrorCode.DANGLING_RELATION.severity,
        message: ReqIfErrorCode.DANGLING_RELATION.message(rel.identifier, rel.sourceId, "source"),
        span: rel.span,
      });
    } else if (rel.sourceId) {
      outgoingRelations.add(rel.sourceId);
    }

    if (rel.targetId && !doc.specObjects.has(rel.targetId)) {
      diagnostics.push({
        code: ReqIfErrorCode.DANGLING_RELATION.code,
        rule: ReqIfErrorCode.DANGLING_RELATION.rule,
        severity: ReqIfErrorCode.DANGLING_RELATION.severity,
        message: ReqIfErrorCode.DANGLING_RELATION.message(rel.identifier, rel.targetId, "target"),
        span: rel.span,
      });
    } else if (rel.targetId) {
      incomingRelations.add(rel.targetId);
    }
  }

  // M7003 & M7008: Circular Hierarchy & Empty Specification
  for (const spec of doc.specifications) {
    if (spec.children.length === 0) {
      diagnostics.push({
        code: ReqIfErrorCode.EMPTY_SPECIFICATION.code,
        rule: ReqIfErrorCode.EMPTY_SPECIFICATION.rule,
        severity: ReqIfErrorCode.EMPTY_SPECIFICATION.severity,
        message: ReqIfErrorCode.EMPTY_SPECIFICATION.message(spec.identifier),
        span: spec.span,
      });
      continue;
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function checkHierarchy(h: ReqIfSpecHierarchy, path: string[]) {
      const objId = h.objectRef;
      if (!objId) return;

      if (recStack.has(objId)) {
        const cycle = [...path, objId].join(" -> ");
        diagnostics.push({
          code: ReqIfErrorCode.CIRCULAR_HIERARCHY.code,
          rule: ReqIfErrorCode.CIRCULAR_HIERARCHY.rule,
          severity: ReqIfErrorCode.CIRCULAR_HIERARCHY.severity,
          message: ReqIfErrorCode.CIRCULAR_HIERARCHY.message(objId, cycle),
          span: h.span,
        });
        return;
      }

      if (visited.has(objId)) return;

      visited.add(objId);
      recStack.add(objId);

      for (const child of h.children) {
        checkHierarchy(child, [...path, objId]);
      }

      recStack.delete(objId);
    }

    for (const topH of spec.children) {
      checkHierarchy(topH, []);
    }
  }

  // M7004: Unverified Leaf Requirements
  // A requirement that is a leaf in the specification and has no incoming or outgoing verification links
  const nonLeafRequirements = new Set<string>();
  function markNonLeaves(h: ReqIfSpecHierarchy) {
    if (h.children.length > 0) {
      nonLeafRequirements.add(h.objectRef);
      for (const c of h.children) {
        markNonLeaves(c);
      }
    }
  }
  for (const spec of doc.specifications) {
    for (const h of spec.children) {
      markNonLeaves(h);
    }
  }

  for (const obj of doc.specObjects.values()) {
    if (!nonLeafRequirements.has(obj.identifier)) {
      const hasRelation = outgoingRelations.has(obj.identifier) || incomingRelations.has(obj.identifier);
      if (!hasRelation && (obj.asilLevel || obj.contract)) {
        diagnostics.push({
          code: ReqIfErrorCode.UNVERIFIED_LEAF_REQUIREMENT.code,
          rule: ReqIfErrorCode.UNVERIFIED_LEAF_REQUIREMENT.rule,
          severity: ReqIfErrorCode.UNVERIFIED_LEAF_REQUIREMENT.severity,
          message: ReqIfErrorCode.UNVERIFIED_LEAF_REQUIREMENT.message(obj.identifier),
          span: obj.span,
        });
      }
    }
  }

  return diagnostics;
}
