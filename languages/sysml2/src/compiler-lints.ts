// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module compiler-lints
 *
 * Tier-1 native WebAssembly `CompilerLint` rules for SysML v2 / KerML.
 *
 * These rules are transpiled directly to AssemblyScript and compiled into
 * `sysml2/dist/parser.wasm` via `@modelscript/dsl`'s `buildParser`, executing
 * in sub-millisecond time over the arena-native linear-memory CST (`CodeGraph`)
 * via `facade.getDiagnostics(rootPtr)` (live in LSP and on-demand in Morsel/CLI).
 */

import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/dsl";

/**
 * Checks whether `nodeId` starts with an ASCII lowercase letter (`a`–`z`),
 * ignoring single-quoted unrestricted names (`'...'`).
 */
function startsWithLowercaseAscii(db: CodeGraph, nodeId: u32): boolean {
  if (nodeId == 0 || db.ast.startsWith(nodeId, "'")) return false;
  return (
    db.ast.startsWith(nodeId, "a") ||
    db.ast.startsWith(nodeId, "b") ||
    db.ast.startsWith(nodeId, "c") ||
    db.ast.startsWith(nodeId, "d") ||
    db.ast.startsWith(nodeId, "e") ||
    db.ast.startsWith(nodeId, "f") ||
    db.ast.startsWith(nodeId, "g") ||
    db.ast.startsWith(nodeId, "h") ||
    db.ast.startsWith(nodeId, "i") ||
    db.ast.startsWith(nodeId, "j") ||
    db.ast.startsWith(nodeId, "k") ||
    db.ast.startsWith(nodeId, "l") ||
    db.ast.startsWith(nodeId, "m") ||
    db.ast.startsWith(nodeId, "n") ||
    db.ast.startsWith(nodeId, "o") ||
    db.ast.startsWith(nodeId, "p") ||
    db.ast.startsWith(nodeId, "q") ||
    db.ast.startsWith(nodeId, "r") ||
    db.ast.startsWith(nodeId, "s") ||
    db.ast.startsWith(nodeId, "t") ||
    db.ast.startsWith(nodeId, "u") ||
    db.ast.startsWith(nodeId, "v") ||
    db.ast.startsWith(nodeId, "w") ||
    db.ast.startsWith(nodeId, "x") ||
    db.ast.startsWith(nodeId, "y") ||
    db.ast.startsWith(nodeId, "z")
  );
}

/**
 * Checks whether `nodeId` starts with an ASCII uppercase letter (`A`–`Z`),
 * ignoring single-quoted unrestricted names (`'...'`).
 */
function startsWithUppercaseAscii(db: CodeGraph, nodeId: u32): boolean {
  if (nodeId == 0 || db.ast.startsWith(nodeId, "'")) return false;
  return (
    db.ast.startsWith(nodeId, "A") ||
    db.ast.startsWith(nodeId, "B") ||
    db.ast.startsWith(nodeId, "C") ||
    db.ast.startsWith(nodeId, "D") ||
    db.ast.startsWith(nodeId, "E") ||
    db.ast.startsWith(nodeId, "F") ||
    db.ast.startsWith(nodeId, "G") ||
    db.ast.startsWith(nodeId, "H") ||
    db.ast.startsWith(nodeId, "I") ||
    db.ast.startsWith(nodeId, "J") ||
    db.ast.startsWith(nodeId, "K") ||
    db.ast.startsWith(nodeId, "L") ||
    db.ast.startsWith(nodeId, "M") ||
    db.ast.startsWith(nodeId, "N") ||
    db.ast.startsWith(nodeId, "O") ||
    db.ast.startsWith(nodeId, "P") ||
    db.ast.startsWith(nodeId, "Q") ||
    db.ast.startsWith(nodeId, "R") ||
    db.ast.startsWith(nodeId, "S") ||
    db.ast.startsWith(nodeId, "T") ||
    db.ast.startsWith(nodeId, "U") ||
    db.ast.startsWith(nodeId, "V") ||
    db.ast.startsWith(nodeId, "W") ||
    db.ast.startsWith(nodeId, "X") ||
    db.ast.startsWith(nodeId, "Y") ||
    db.ast.startsWith(nodeId, "Z")
  );
}

/**
 * Returns true if `t` is an enclosing Package, Definition, or Usage CST node type
 * that establishes an ownership body in SysML v2.
 */
interface Sysml2LintNodeIds {
  ActionDefinition: u16;
  ActionUsage: u16;
  AllocationDefinition: u16;
  AllocationUsage: u16;
  AnalysisCaseDefinition: u16;
  AnalysisCaseUsage: u16;
  AttributeDefinition: u16;
  AttributeUsage: u16;
  CalculationDefinition: u16;
  CalculationUsage: u16;
  CaseDefinition: u16;
  CaseUsage: u16;
  ConcernDefinition: u16;
  ConcernUsage: u16;
  ConnectionDefinition: u16;
  ConnectionUsage: u16;
  ConstraintDefinition: u16;
  ConstraintUsage: u16;
  DefaultReferenceUsage: u16;
  DoActionMember: u16;
  EmptySuccessionMember: u16;
  EntryActionMember: u16;
  EnumerationDefinition: u16;
  EnumerationUsage: u16;
  ExhibitStateUsage: u16;
  ExitActionMember: u16;
  FlowDefinition: u16;
  FlowUsage: u16;
  InterfaceDefinition: u16;
  InterfaceUsage: u16;
  ItemDefinition: u16;
  ItemUsage: u16;
  LibraryPackage: u16;
  MetadataDefinition: u16;
  NonOccurrenceUsageMember: u16;
  ObjectiveMember: u16;
  OccurrenceDefinition: u16;
  OccurrenceUsage: u16;
  OccurrenceUsageMember: u16;
  Package: u16;
  PartDefinition: u16;
  PartUsage: u16;
  PortDefinition: u16;
  PortUsage: u16;
  ReferenceUsage: u16;
  RenderingDefinition: u16;
  RenderingUsage: u16;
  RequirementDefinition: u16;
  RequirementUsage: u16;
  ReturnParameterMember: u16;
  StateDefinition: u16;
  StateUsage: u16;
  SubjectMember: u16;
  SuccessionAsUsage: u16;
  TransitionUsageMember: u16;
  UseCaseDefinition: u16;
  UseCaseUsage: u16;
  VariantUsageMember: u16;
  VerificationCaseDefinition: u16;
  VerificationCaseUsage: u16;
  ViewDefinition: u16;
  ViewUsage: u16;
  ViewpointDefinition: u16;
  ViewpointUsage: u16;
}

function isVariantOwnerNodeType(t: u16, $: Sysml2LintNodeIds): boolean {
  return (
    t == $.Package ||
    t == $.LibraryPackage ||
    t == $.AttributeDefinition ||
    t == $.EnumerationDefinition ||
    t == $.OccurrenceDefinition ||
    t == $.ItemDefinition ||
    t == $.MetadataDefinition ||
    t == $.PartDefinition ||
    t == $.ConnectionDefinition ||
    t == $.FlowDefinition ||
    t == $.InterfaceDefinition ||
    t == $.AllocationDefinition ||
    t == $.PortDefinition ||
    t == $.ActionDefinition ||
    t == $.CalculationDefinition ||
    t == $.StateDefinition ||
    t == $.ConstraintDefinition ||
    t == $.RequirementDefinition ||
    t == $.ConcernDefinition ||
    t == $.CaseDefinition ||
    t == $.AnalysisCaseDefinition ||
    t == $.VerificationCaseDefinition ||
    t == $.UseCaseDefinition ||
    t == $.ViewDefinition ||
    t == $.ViewpointDefinition ||
    t == $.RenderingDefinition ||
    t == $.DefaultReferenceUsage ||
    t == $.ReferenceUsage ||
    t == $.AttributeUsage ||
    t == $.EnumerationUsage ||
    t == $.OccurrenceUsage ||
    t == $.ItemUsage ||
    t == $.PartUsage ||
    t == $.PortUsage ||
    t == $.ConnectionUsage ||
    t == $.InterfaceUsage ||
    t == $.AllocationUsage ||
    t == $.FlowUsage ||
    t == $.ActionUsage ||
    t == $.CalculationUsage ||
    t == $.StateUsage ||
    t == $.ExhibitStateUsage ||
    t == $.ConstraintUsage ||
    t == $.RequirementUsage ||
    t == $.ConcernUsage ||
    t == $.CaseUsage ||
    t == $.AnalysisCaseUsage ||
    t == $.VerificationCaseUsage ||
    t == $.UseCaseUsage ||
    t == $.ViewUsage ||
    t == $.ViewpointUsage ||
    t == $.RenderingUsage
  );
}

/**
 * Tier-1 CST `CompilerLint` rules compiled into `sysml2/dist/parser.wasm`.
 */
export const sysml2CompilerLints: Record<string, CompilerLint<keyof Sysml2LintNodeIds>> = {
  /**
   * S1003: Definition names should follow UpperCamelCase convention.
   */
  definitionNaming: {
    nodes: [
      "AttributeDefinition",
      "EnumerationDefinition",
      "OccurrenceDefinition",
      "ItemDefinition",
      "MetadataDefinition",
      "PartDefinition",
      "ConnectionDefinition",
      "FlowDefinition",
      "InterfaceDefinition",
      "AllocationDefinition",
      "PortDefinition",
      "ActionDefinition",
      "CalculationDefinition",
      "StateDefinition",
      "ConstraintDefinition",
      "RequirementDefinition",
      "ConcernDefinition",
      "CaseDefinition",
      "AnalysisCaseDefinition",
      "VerificationCaseDefinition",
      "UseCaseDefinition",
      "ViewDefinition",
      "ViewpointDefinition",
      "RenderingDefinition",
    ],
    severity: "warning",
    code: 1003,
    message: (target) => `Definition '${target.text}' should start with an uppercase letter (PascalCase).`,
    query: (db: CodeGraph, node: u32) => {
      const nameNode = db.ast.getChildByFieldId(node, "declaredName");
      if (nameNode != 0 && startsWithLowercaseAscii(db, nameNode)) {
        db.diagnostic(nameNode);
      }
    },
  },

  /**
   * S1004: Usage names should follow lowerCamelCase convention (except enumeration variants).
   */
  usageNaming: {
    nodes: [
      "AttributeUsage",
      "ItemUsage",
      "PartUsage",
      "PortUsage",
      "ConnectionUsage",
      "InterfaceUsage",
      "FlowUsage",
      "ActionUsage",
      "CalculationUsage",
      "StateUsage",
      "ConstraintUsage",
      "RequirementUsage",
      "ConcernUsage",
      "CaseUsage",
      "AnalysisCaseUsage",
      "VerificationCaseUsage",
      "UseCaseUsage",
      "ViewUsage",
      "ViewpointUsage",
      "RenderingUsage",
      "ReferenceUsage",
      "OccurrenceUsage",
    ],
    severity: "warning",
    code: 1004,
    message: (target) => `Usage '${target.text}' should start with a lowercase letter (camelCase).`,
    query: (db: CodeGraph, node: u32, $) => {
      const nameNode = db.ast.getChildByFieldId(node, "declaredName");
      if (nameNode == 0 || !startsWithUppercaseAscii(db, nameNode)) return;

      // Exempt variant usages inside EnumerationDefinition / EnumerationUsage
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        const t = db.ast.getType(anc);
        if (t == $.EnumerationDefinition || t == $.EnumerationUsage) {
          return;
        }
        if (t != $.VariantUsageMember && t != $.OccurrenceUsageMember && t != $.NonOccurrenceUsageMember) {
          break;
        }
      }

      db.diagnostic(nameNode);
    },
  },

  /**
   * S1005: Package names should follow UpperCamelCase convention.
   */
  packageNaming: {
    nodes: ["Package", "LibraryPackage"],
    severity: "warning",
    code: 1005,
    message: (target) => `Package '${target.text}' should start with an uppercase letter (PascalCase).`,
    query: (db: CodeGraph, node: u32) => {
      const nameNode = db.ast.getChildByFieldId(node, "declaredName");
      if (nameNode != 0 && startsWithLowercaseAscii(db, nameNode)) {
        db.diagnostic(nameNode);
      }
    },
  },

  /**
   * S4014: A `variant` membership is only permitted inside an `enum def` / `enum`
   * or a definition/usage declared with `variation` (OMG SysML v2 §7.14).
   */
  variantOutsideVariation: {
    nodes: ["VariantUsageMember"],
    severity: "error",
    code: 4014,
    message: () =>
      `A 'variant' member is only permitted inside an 'enum' or a definition/usage declared as 'variation'.`,
    query: (db: CodeGraph, node: u32, $) => {
      let owner: u32 = 0;
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (anc == node) continue;
        if (isVariantOwnerNodeType(db.ast.getType(anc), $)) {
          owner = anc;
          break;
        }
      }
      if (owner == 0) {
        db.diagnostic(node);
        return;
      }
      const ownerType = db.ast.getType(owner);
      if (ownerType == $.EnumerationDefinition || ownerType == $.EnumerationUsage) {
        return;
      }
      if (ownerType == $.Package || ownerType == $.LibraryPackage) {
        db.diagnostic(node);
        return;
      }
      if (db.ast.getChildByFieldId(owner, "isVariation") != 0) {
        return;
      }
      if (
        db.ast.startsWith(owner, "variation ") ||
        db.ast.startsWith(owner, "abstract variation ") ||
        db.ast.startsWith(owner, "ref variation ")
      ) {
        return;
      }
      let hasVar = false;
      for (const desc of db.ast.getDescendants(owner, 0)) {
        if (desc == node) break;
        if (db.ast.getFirstChild(desc) == 0 && db.ast.textEquals(desc, "variation")) {
          hasVar = true;
          break;
        }
      }
      if (!hasVar) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * S4016: A `parallel` state cannot directly own transitions or target successions
   * between its concurrent regions (OMG SysML v2 §7.17).
   */
  parallelStateTransition: {
    nodes: ["StateDefinition", "StateUsage", "ExhibitStateUsage"],
    severity: "error",
    code: 4016,
    message: (target) => {
      const name = target.field("declaredName");
      const label = name && name.length > 0 ? name : "parallel state";
      return `Parallel state '${label}' cannot directly own transitions or successions between concurrent regions.`;
    },
    query: (db: CodeGraph, node: u32, $) => {
      let isParallel = db.ast.getChildByFieldId(node, "isParallel") != 0;
      if (!isParallel) {
        for (const desc of db.ast.getDescendants(node, 0)) {
          if (db.ast.getFirstChild(desc) == 0) {
            if (db.ast.textEquals(desc, "{") || db.ast.textEquals(desc, ";")) break;
            if (db.ast.textEquals(desc, "parallel")) {
              isParallel = true;
              break;
            }
          }
        }
      }
      if (!isParallel) return;

      for (const desc of db.ast.getDescendants(node, 0)) {
        const ct = db.ast.getType(desc);
        if (ct == $.TransitionUsageMember || ct == $.EmptySuccessionMember || ct == $.SuccessionAsUsage) {
          let directOwner: u32 = 0;
          for (const anc of db.ast.getAncestors(desc, 0)) {
            if (anc == desc) continue;
            if (isVariantOwnerNodeType(db.ast.getType(anc), $)) {
              directOwner = anc;
              break;
            }
          }
          if (directOwner == node) {
            db.diagnosticAt(desc, node);
          }
        }
      }
    },
  },

  /**
   * S4020: At most one `entry`, `do`, `exit`, `subject`, `objective`, or `return`
   * singleton member may be owned directly by a single behavioral/requirement body
   * (OMG SysML v2 §7.16–7.21).
   */
  duplicateSingletonMember: {
    nodes: [
      "StateDefinition",
      "StateUsage",
      "ExhibitStateUsage",
      "RequirementDefinition",
      "RequirementUsage",
      "ConcernDefinition",
      "ConcernUsage",
      "CaseDefinition",
      "CaseUsage",
      "AnalysisCaseDefinition",
      "AnalysisCaseUsage",
      "VerificationCaseDefinition",
      "VerificationCaseUsage",
      "UseCaseDefinition",
      "UseCaseUsage",
      "CalculationDefinition",
      "CalculationUsage",
      "ActionDefinition",
      "ActionUsage",
    ],
    severity: "error",
    code: 4020,
    message: (_target, kindArg, ownerArg) => {
      const k = kindArg ? kindArg.asNumber() : 0;
      const memberKind =
        k === 1 ? "entry" : k === 2 ? "do" : k === 3 ? "exit" : k === 4 ? "subject" : k === 5 ? "objective" : "return";
      const ownerName = ownerArg ? ownerArg.field("declaredName") : "";
      const label = ownerName && ownerName.length > 0 ? ownerName : "element";
      return `Duplicate '${memberKind}' member in '${label}': at most one '${memberKind}' member is allowed.`;
    },
    query: (db: CodeGraph, node: u32, $) => {
      let entryCount: u32 = 0;
      let doCount: u32 = 0;
      let exitCount: u32 = 0;
      let subjectCount: u32 = 0;
      let objectiveCount: u32 = 0;
      let returnCount: u32 = 0;

      for (const child of db.ast.getDescendants(node, 0)) {
        const ct = db.ast.getType(child);
        if (
          ct != $.EntryActionMember &&
          ct != $.DoActionMember &&
          ct != $.ExitActionMember &&
          ct != $.SubjectMember &&
          ct != $.ObjectiveMember &&
          ct != $.ReturnParameterMember
        ) {
          continue;
        }
        let directOwner: u32 = 0;
        for (const anc of db.ast.getAncestors(child, 0)) {
          if (anc == child) continue;
          if (isVariantOwnerNodeType(db.ast.getType(anc), $)) {
            directOwner = anc;
            break;
          }
        }
        if (directOwner != node) continue;

        if (ct == $.EntryActionMember) {
          entryCount++;
          if (entryCount > 1) db.diagnostic(child, 1, node);
        } else if (ct == $.DoActionMember) {
          doCount++;
          if (doCount > 1) db.diagnostic(child, 2, node);
        } else if (ct == $.ExitActionMember) {
          exitCount++;
          if (exitCount > 1) db.diagnostic(child, 3, node);
        } else if (ct == $.SubjectMember) {
          subjectCount++;
          if (subjectCount > 1) db.diagnostic(child, 4, node);
        } else if (ct == $.ObjectiveMember) {
          objectiveCount++;
          if (objectiveCount > 1) db.diagnostic(child, 5, node);
        } else if (ct == $.ReturnParameterMember) {
          returnCount++;
          if (returnCount > 1) db.diagnostic(child, 6, node);
        }
      }
    },
  },
};
