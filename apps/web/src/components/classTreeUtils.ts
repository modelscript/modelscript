// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClassSummary, Component } from "../api";

/* ─── tree node types ─── */

export interface TreeNode {
  name: string;
  fullName: string;
  classKind: string;
  children: TreeNode[];
}

export type ClassDomain = "modelica" | "sysml2" | "cad";

export function classifyClassDomain(cls: { class_kind: string; class_name?: string | undefined }): ClassDomain {
  const kind = (cls.class_kind || "").toLowerCase();
  if (kind.startsWith("sysml") || kind.startsWith("kerml")) {
    return "sysml2";
  }
  if (kind.startsWith("cad_") || kind === "product" || kind === "shape" || kind === "solid") {
    return "cad";
  }
  return "modelica";
}

export function buildClassTree(classes: ClassSummary[], rootName: string): TreeNode[] {
  const root: TreeNode = { name: rootName, fullName: rootName, classKind: "package", children: [] };
  const sorted = [...classes].sort((a, b) => a.class_name.localeCompare(b.class_name));

  for (const cls of sorted) {
    const fullName = cls.class_name;
    // Skip the root package entry itself so children sit at top level
    if (fullName === rootName) continue;

    const hasRootPrefix = fullName.startsWith(rootName + ".");
    const cleanName = hasRootPrefix ? fullName.slice(rootName.length + 1) : fullName;
    const parts = cleanName.split(".");
    let currentPath = hasRootPrefix ? rootName : "";
    let parentNode = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}.${part}` : part;
      let node = parentNode.children.find((c) => c.name === part);
      if (!node) {
        node = {
          name: part,
          fullName: i === parts.length - 1 ? fullName : currentPath,
          classKind: i === parts.length - 1 ? cls.class_kind : "package",
          children: [],
        };
        parentNode.children.push(node);
      } else if (i === parts.length - 1) {
        node.classKind = cls.class_kind;
        node.fullName = fullName;
      }
      parentNode = node;
    }
  }

  return root.children;
}

export function filterClassTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.trim().toLowerCase();

  const filterNode = (node: TreeNode): TreeNode | null => {
    const nameMatches =
      node.name.toLowerCase().includes(q) ||
      node.fullName.toLowerCase().includes(q) ||
      node.classKind.toLowerCase().includes(q);
    const filteredChildren = node.children
      .map((child) => filterNode(child))
      .filter((child): child is TreeNode => child !== null);

    if (nameMatches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      };
    }
    return null;
  };

  return nodes.map((node) => filterNode(node)).filter((node): node is TreeNode => node !== null);
}

/* ─── Javadoc component categorization & cross-linking ─── */

export interface EnrichedComponent extends Component {
  defaultValue: string | null;
  unit: string | null;
  otherModifiers: { modifier_name: string; modifier_value: string | null }[];
}

export interface CategorizedComponents {
  parameters: EnrichedComponent[];
  connectors: EnrichedComponent[];
  submodels: EnrichedComponent[];
}

const PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect", "ExternalObject", "Clock"]);

export function enrichComponent(comp: Component): EnrichedComponent {
  const mods = comp.modifiers || [];
  let defaultValue: string | null = null;
  let unit: string | null = null;
  const otherModifiers: { modifier_name: string; modifier_value: string | null }[] = [];

  for (const mod of mods) {
    if ((mod.modifier_name === "value" || mod.modifier_name === "start") && defaultValue === null) {
      defaultValue = mod.modifier_value;
    } else if (mod.modifier_name === "unit" && unit === null) {
      unit = mod.modifier_value ? mod.modifier_value.replace(/^["']|["']$/g, "") : null;
    } else {
      otherModifiers.push(mod);
    }
  }

  return {
    ...comp,
    defaultValue,
    unit,
    otherModifiers,
  };
}

export function categorizeClassComponents(components: Component[]): CategorizedComponents {
  const parameters: EnrichedComponent[] = [];
  const connectors: EnrichedComponent[] = [];
  const submodels: EnrichedComponent[] = [];

  for (const raw of components) {
    const comp = enrichComponent(raw);
    const v = (comp.variability || "").toLowerCase();
    const c = (comp.causality || "").toLowerCase();
    const t = comp.type_name || "";

    if (v === "parameter" || v === "constant" || c === "parameter" || t.startsWith("attribute")) {
      parameters.push(comp);
    } else if (
      c === "input" ||
      c === "output" ||
      c === "connector" ||
      t.startsWith("port") ||
      /(?:^|\.)(?:Interfaces|Pin|PositivePin|NegativePin|Port|Flange|HeatPort|RealInput|RealOutput|BooleanInput|BooleanOutput|IntegerInput|IntegerOutput)(?:$|\b)/.test(
        t,
      )
    ) {
      connectors.push(comp);
    } else {
      submodels.push(comp);
    }
  }

  return { parameters, connectors, submodels };
}

/**
 * Resolves a Modelica / SysML / CAD type reference to a navigable route URL if possible.
 */
export function resolveTypeTargetUrl(
  typeName: string,
  currentLibrary: string,
  currentVersion: string,
  knownClasses: ClassSummary[],
  currentClassName?: string,
): string | null {
  const cleaned = typeName
    .replace(/^part\s*:\s*/i, "")
    .replace(/^port\s*:\s*/i, "")
    .replace(/^attribute\s*:\s*/i, "")
    .replace(/\[.*\]$/, "")
    .trim();

  if (!cleaned || PRIMITIVE_TYPES.has(cleaned)) {
    return null;
  }

  const classSet = new Set(knownClasses.map((c) => c.class_name));

  // 1. Exact match in current package
  if (classSet.has(cleaned)) {
    return `/packages/${currentLibrary}/${currentVersion}/classes/${cleaned}`;
  }

  // 2. Relative to current class's enclosing package
  if (currentClassName && currentClassName.includes(".")) {
    const parentPkg = currentClassName.slice(0, currentClassName.lastIndexOf("."));
    const siblingCandidate = `${parentPkg}.${cleaned}`;
    if (classSet.has(siblingCandidate)) {
      return `/packages/${currentLibrary}/${currentVersion}/classes/${siblingCandidate}`;
    }
  }

  // 3. Relative to root package name
  const rootCandidate = `${currentLibrary}.${cleaned}`;
  if (classSet.has(rootCandidate)) {
    return `/packages/${currentLibrary}/${currentVersion}/classes/${rootCandidate}`;
  }

  // 4. Cross-package qualified name (e.g., Modelica.SIunits.Resistance)
  if (cleaned.includes(".")) {
    const rootPkg = cleaned.split(".")[0]!;
    if (rootPkg && rootPkg !== currentLibrary && /^[A-Z]/.test(rootPkg)) {
      return `/packages/${rootPkg}`;
    }
  }

  return null;
}
