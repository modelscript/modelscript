// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "../runtime.js";

/**
 * Language-neutral semantic classification of indexed workspace symbols across all
 * ModelScript languages (Modelica, SysML v2, PSS/E, PSCAD, SPICE, Simulink, STEP, OWL 2, etc.).
 */
export type SemanticRole =
  | "namespace"
  | "type"
  | "port"
  | "function"
  | "instance"
  | "import"
  | "relationship"
  | "literal"
  | "unknown";

const SYSML2_RELATION_RULES = new Set<string>([
  "OwnedFeatureTyping",
  "ConjugatedPortTyping",
  "OwnedSubclassification",
  "Subclassification",
  "OwnedSubsetting",
  "OwnedReferenceSubsetting",
  "OwnedCrossSubsetting",
  "OwnedRedefinition",
  "SatisfyRequirementUsage",
  "VerifyRequirementUsage",
  "IncludeUseCaseUsage",
  "FeatureTyping",
  "Redefinition",
  "Subsetting",
  "Specialization",
  "ReferenceSubsetting",
]);

const PORT_DEFINITION_RULES = new Set<string>(["PortDefinition", "InterfaceDefinition"]);

const PORT_USAGE_RULES = new Set<string>(["PortUsage", "InterfaceUsage", "pscad_port", "simulink_port", "psse_bus"]);

const NAMESPACE_RULES = new Set<string>(["Package", "Namespace", "psse_package", "pscad_library"]);

const FUNCTION_KINDS = new Set<string>(["Function", "ActionDefinition", "CalculationDefinition"]);

const TYPE_KINDS = new Set<string>([
  "Class",
  "Definition",
  "Def",
  "Block",
  "Subcircuit",
  "PartDefinition",
  "AttributeDefinition",
  "ConnectionDefinition",
  "AllocationDefinition",
  "RequirementDefinition",
  "ItemDefinition",
]);

const INSTANCE_KINDS = new Set<string>([
  "Component",
  "Variable",
  "Usage",
  "Attribute",
  "PartUsage",
  "AttributeUsage",
  "ItemUsage",
  "ReferenceUsage",
  "ConnectionUsage",
  "AllocationUsage",
]);

const EXTRA_TYPE_RULES = new Set<string>(["pscad_component", "pscad_project", "psse_dyr_case", "psse_raw_case"]);

/**
 * Classifies a workspace `SymbolEntry` into a normalized `SemanticRole` without
 * mutating its language-specific `kind` string.
 */
export function getSemanticRole(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): SemanticRole {
  if (!entry) return "unknown";
  const kind = entry.kind ?? "";
  const rule = entry.ruleName ?? "";
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const classPrefixes = typeof meta["classPrefixes"] === "string" ? meta["classPrefixes"].toLowerCase() : "";
  const defKind = typeof meta["defKind"] === "string" ? meta["defKind"].toLowerCase() : "";

  if (kind === "Import" || rule === "Import" || rule === "ImportClause" || rule.includes("Import")) {
    return "import";
  }

  if (kind === "Reference" || kind === "Specialization" || kind === "Extends" || SYSML2_RELATION_RULES.has(rule)) {
    return "relationship";
  }

  if (kind === "EnumerationLiteral" || kind === "Literal") {
    return "literal";
  }

  if (FUNCTION_KINDS.has(kind) || classPrefixes === "function") {
    return "function";
  }

  if (
    kind === "Port" ||
    kind === "PortDefinition" ||
    kind === "Connector" ||
    PORT_DEFINITION_RULES.has(rule) ||
    PORT_USAGE_RULES.has(rule) ||
    classPrefixes === "connector" ||
    defKind === "port" ||
    meta["isPort"] === true
  ) {
    return "port";
  }

  if (kind === "Package" || kind === "Namespace" || NAMESPACE_RULES.has(rule) || classPrefixes === "package") {
    return "namespace";
  }

  if (
    TYPE_KINDS.has(kind) ||
    EXTRA_TYPE_RULES.has(rule) ||
    meta["isType"] === true ||
    classPrefixes === "model" ||
    classPrefixes === "block" ||
    classPrefixes === "record" ||
    classPrefixes === "type" ||
    classPrefixes === "class" ||
    rule.endsWith("Definition")
  ) {
    return "type";
  }

  if (INSTANCE_KINDS.has(kind) || meta["isInstance"] === true || rule === "psse_dyr_record") {
    return "instance";
  }

  return "unknown";
}

/** True when `entry` represents a package or namespace container across any language. */
export function isNamespaceLikeSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  return getSemanticRole(entry) === "namespace";
}

/**
 * True when `entry` defines a port/connector interface (e.g., Modelica `connector`,
 * SysML v2 `port def`), distinguishing type definitions from member instances.
 */
export function isPortDefinitionSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  if (!entry) return false;
  const kind = entry.kind ?? "";
  const rule = entry.ruleName ?? "";
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const classPrefixes = typeof meta["classPrefixes"] === "string" ? meta["classPrefixes"].toLowerCase() : "";
  const defKind = typeof meta["defKind"] === "string" ? meta["defKind"].toLowerCase() : "";

  if (kind === "Port" || kind === "PortDefinition" || kind === "Connector" || PORT_DEFINITION_RULES.has(rule)) {
    return true;
  }
  if (kind === "Class" || kind === "Definition" || kind === "Def") {
    return classPrefixes === "connector" || defKind === "port" || meta["isPort"] === true;
  }
  return false;
}

/** True when `entry` is either a port definition or a port usage/terminal instance. */
export function isPortLikeSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  return getSemanticRole(entry) === "port" || isPortDefinitionSymbol(entry);
}

/**
 * True when `entry` is an import, typing, specialization, or cross-reference relationship edge
 * rather than a user-declared type or member feature.
 */
export function isRelationshipOrImportSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  const role = getSemanticRole(entry);
  return role === "import" || role === "relationship";
}

/**
 * True when `entry` can act as a resolvable type, package, port definition, or function
 * in cross-language type specifiers and qualified paths (never matches plain instances or relations).
 */
export function isTypeLikeSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  if (!entry) return false;
  const role = getSemanticRole(entry);
  if (role === "type" || role === "namespace" || role === "function") return true;
  if (role === "port") {
    // PortUsage instances have ruleName "PortUsage" / kind "Usage"; only PortDefinition / Class connectors are types.
    const kind = entry.kind ?? "";
    const rule = entry.ruleName ?? "";
    if (PORT_USAGE_RULES.has(rule) || kind === "Usage" || kind === "Component" || kind === "Variable") {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * True when `entry` is a declared member/component/port-usage/variable inside an enclosing type.
 */
export function isMemberLikeSymbol(
  entry: Pick<SymbolEntry, "kind" | "ruleName" | "metadata"> | null | undefined,
): boolean {
  if (!entry) return false;
  const role = getSemanticRole(entry);
  if (role === "instance") return true;
  if (role === "port") {
    return !isPortDefinitionSymbol(entry);
  }
  return false;
}

/**
 * Splits a qualified name across Modelica `.` and SysML v2 `::` separators while preserving
 * Modelica single-quoted identifiers (e.g., `'a.b'`). Leading `.`, `::`, or `~` are ignored.
 */
export function splitQualifiedPath(rawPath: string): string[] {
  if (!rawPath) return [];
  let path = rawPath.trim();
  if (path.startsWith("~")) path = path.slice(1).trim();
  while (path.startsWith("::")) path = path.slice(2).trim();
  while (path.startsWith(".")) path = path.slice(1).trim();
  if (!path) return [];

  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;

  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!;
    if (ch === "'" && (i === 0 || path[i - 1] !== "\\")) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote) {
      if (ch === ":" && path[i + 1] === ":") {
        const seg = current.trim();
        if (seg) parts.push(seg);
        current = "";
        i++;
        continue;
      }
      if (ch === ".") {
        const seg = current.trim();
        if (seg) parts.push(seg);
        current = "";
        continue;
      }
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * Normalizes a qualified path to the separator syntax expected by `targetLang`.
 */
export function normalizeQualifiedName(rawPath: string, targetLang: string): string {
  const parts = splitQualifiedPath(rawPath);
  if (parts.length === 0) return "";
  const sep = targetLang.toLowerCase().startsWith("sysml") ? "::" : ".";
  return parts.join(sep);
}

/**
 * Strips a leading `~` conjugation marker if present and returns `{ isConjugated, cleanPath }`.
 */
export function stripConjugationPrefix(rawPath: string): { isConjugated: boolean; cleanPath: string } {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith("~")) {
    return { isConjugated: true, cleanPath: trimmed.slice(1).trim() };
  }
  return { isConjugated: false, cleanPath: trimmed };
}
