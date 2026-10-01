// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TreeNodeInfo } from "@modelscript/runtime";
import { TableauReasoner } from "@modelscript/runtime/wasm_ontology.js";

export function getShortLabel(iri: string): string {
  if (!iri) return "";
  const hashIdx = iri.lastIndexOf("#");
  if (hashIdx !== -1 && hashIdx < iri.length - 1) {
    return iri.slice(hashIdx + 1);
  }
  const slashIdx = iri.lastIndexOf("/");
  if (slashIdx !== -1 && slashIdx < iri.length - 1) {
    return iri.slice(slashIdx + 1);
  }
  const colonIdx = iri.indexOf(":");
  if (colonIdx !== -1 && !iri.startsWith("http://") && !iri.startsWith("https://")) {
    return iri.slice(colonIdx + 1);
  }
  return iri;
}

export function getOntologyDisplayName(uri: string): string {
  if (!uri) return "Ontology";
  const slashIdx = uri.lastIndexOf("/");
  if (slashIdx !== -1 && slashIdx < uri.length - 1) {
    return uri.slice(slashIdx + 1);
  }
  const colonIdx = uri.lastIndexOf(":");
  if (colonIdx !== -1 && colonIdx < uri.length - 1) {
    return uri.slice(colonIdx + 1);
  }
  return uri;
}

/**
 * Returns top-level ontology container nodes found in workspace or owl2Store.
 */
export function getOntologyRootNodes(workspace: any, store?: any): TreeNodeInfo[] {
  const nodes: TreeNodeInfo[] = [];
  const seenUris = new Set<string>();

  // 1. Check registered documents in workspace for OWL2 files
  if (workspace?.documents) {
    for (const [uri, doc] of workspace.documents) {
      const ext = uri.slice(uri.lastIndexOf(".")).toLowerCase();
      const isOwlExt = ext === ".owl" || ext === ".ofn" || ext === ".ttl" || ext === ".owl2";
      if ((isOwlExt || (doc as any)?.language === "owl2") && !seenUris.has(uri)) {
        seenUris.add(uri);
        nodes.push({
          id: `__ONTOLOGY__:${uri}`,
          name: getOntologyDisplayName(uri),
          compositeName: uri,
          classKind: "ontology",
          icon: "symbol-namespace",
          hasChildren: true,
          language: "owl2",
        });
      }
    }
  }

  // 2. Check owl2 language workspace index if available
  const owlWs = workspace?.workspaces?.get ? workspace.workspaces.get("owl2") : null;
  if (owlWs?.documents) {
    for (const [uri] of owlWs.documents) {
      if (!seenUris.has(uri)) {
        seenUris.add(uri);
        nodes.push({
          id: `__ONTOLOGY__:${uri}`,
          name: getOntologyDisplayName(uri),
          compositeName: uri,
          classKind: "ontology",
          icon: "symbol-namespace",
          hasChildren: true,
          language: "owl2",
        });
      }
    }
  }

  // 3. Fallback: if axioms exist in owl2Store but no specific document was found
  if (nodes.length === 0 && store?.axioms && store.axioms.length > 0) {
    const fallbackId = "__ONTOLOGY__:workspace-ontology";
    nodes.push({
      id: fallbackId,
      name: "Workspace Ontology",
      compositeName: "workspace-ontology",
      classKind: "ontology",
      icon: "symbol-namespace",
      hasChildren: true,
      language: "owl2",
    });
  }

  return nodes;
}

/**
 * Returns the structural category folder nodes under an ontology.
 */
export function getOntologyCategoryNodes(ontologyParentId: string, store: any): TreeNodeInfo[] {
  const uri = ontologyParentId.substring("__ONTOLOGY__:".length);
  const categories: TreeNodeInfo[] = [
    {
      id: `__OWL_CLASSES__:${uri}`,
      name: "Classes",
      compositeName: `${uri}#Classes`,
      classKind: "folder",
      icon: "symbol-class",
      hasChildren: true,
      language: "owl2",
    },
    {
      id: `__OWL_OBJ_PROPS__:${uri}`,
      name: "Object Properties",
      compositeName: `${uri}#ObjectProperties`,
      classKind: "folder",
      icon: "symbol-property",
      hasChildren: true,
      language: "owl2",
    },
    {
      id: `__OWL_DATA_PROPS__:${uri}`,
      name: "Data Properties",
      compositeName: `${uri}#DataProperties`,
      classKind: "folder",
      icon: "symbol-field",
      hasChildren: true,
      language: "owl2",
    },
  ];

  // Only show Individuals folder if individuals exist
  const hasIndividuals = store?.axioms?.some(
    (ax: any) =>
      ax.type === "IndividualDeclaration" ||
      ax.type === "NamedIndividualDeclaration" ||
      ax.type === "ClassAssertion" ||
      ax.type === "ObjectPropertyAssertion" ||
      ax.type === "DataPropertyAssertion",
  );

  if (hasIndividuals) {
    categories.push({
      id: `__OWL_INDIVIDUALS__:${uri}`,
      name: "Individuals",
      compositeName: `${uri}#Individuals`,
      classKind: "folder",
      icon: "symbol-misc",
      hasChildren: true,
      language: "owl2",
    });
  }

  return categories;
}

/**
 * Returns class nodes for the taxonomy subsumption hierarchy.
 */
export async function getOwlClassTreeNodes(store: any, parentIri: string | null): Promise<TreeNodeInfo[]> {
  if (!store?.axioms || store.axioms.length === 0) return [];

  const reasoner = new TableauReasoner();
  await reasoner.init();
  reasoner.loadOntology(store.axioms);
  reasoner.classify();

  const taxonomy = reasoner.getTaxonomy();
  const taxMap = new Map<string, (typeof taxonomy)[0]>();
  for (const node of taxonomy) {
    taxMap.set(node.iri, node);
  }

  const definedClasses = new Set<string>();
  for (const ax of store.axioms) {
    if (ax.type === "EquivalentClasses" && ax.classIris.length > 1) {
      for (const c of ax.classIris) definedClasses.add(c);
    }
  }

  if (!parentIri) {
    // Top-level root classes (no superclasses, or superclass is only owl:Thing)
    const roots: TreeNodeInfo[] = [];
    for (const node of taxonomy) {
      if (node.iri === "owl:Thing") continue;
      const equivSet = new Set(node.equivalentClasses);
      const filteredSupers = node.directSuperClasses.filter((s) => s !== "owl:Thing" && !equivSet.has(s));
      if (filteredSupers.length === 0) {
        const isDefined = definedClasses.has(node.iri);
        roots.push({
          id: `__OWL_CLASS__:${node.iri}`,
          name: getShortLabel(node.iri),
          compositeName: node.iri,
          classKind: isDefined ? "owl2-defined-class" : "owl2-class",
          icon: "symbol-class",
          description: isDefined ? "≡ defined" : "",
          hasChildren: node.directSubClasses.length > 0,
          language: "owl2",
        });
      }
    }
    roots.sort((a, b) => a.name.localeCompare(b.name));
    return roots;
  }

  // Children of parentIri
  const parentNode = taxMap.get(parentIri);
  if (!parentNode) return [];

  const children: TreeNodeInfo[] = [];
  for (const subIri of parentNode.directSubClasses) {
    const subNode = taxMap.get(subIri);
    const isDefined = definedClasses.has(subIri);
    children.push({
      id: `__OWL_CLASS__:${subIri}`,
      name: getShortLabel(subIri),
      compositeName: subIri,
      classKind: isDefined ? "owl2-defined-class" : "owl2-class",
      icon: "symbol-class",
      description: isDefined ? "≡ defined" : "",
      hasChildren: (subNode?.directSubClasses.length ?? 0) > 0,
      language: "owl2",
    });
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  return children;
}

/**
 * Returns property nodes for Object or Data properties.
 */
export function getOwlPropertyTreeNodes(store: any, propertyType: "object" | "data"): TreeNodeInfo[] {
  if (!store?.axioms || store.axioms.length === 0) return [];

  const objProps = new Set<string>();
  const dataProps = new Set<string>();
  const characteristicsMap = new Map<string, Set<string>>();
  const inverseMap = new Map<string, string>();
  const rangesMap = new Map<string, Set<string>>();
  const subPropertyMap = new Map<string, string[]>();
  const childProperties = new Set<string>();

  for (const ax of store.axioms) {
    if (ax.type === "ObjectPropertyDeclaration") objProps.add(ax.iri);
    if (ax.type === "DataPropertyDeclaration") dataProps.add(ax.iri);
    if (ax.type === "TransitiveObjectProperty") {
      const s = characteristicsMap.get(ax.propertyIri) ?? new Set();
      s.add("Transitive");
      characteristicsMap.set(ax.propertyIri, s);
    }
    if (ax.type === "FunctionalObjectProperty") {
      const s = characteristicsMap.get(ax.propertyIri) ?? new Set();
      s.add("Functional");
      characteristicsMap.set(ax.propertyIri, s);
    }
    if (ax.type === "FunctionalDataProperty") {
      const s = characteristicsMap.get(ax.propertyIri) ?? new Set();
      s.add("Functional");
      characteristicsMap.set(ax.propertyIri, s);
    }
    if (ax.type === "SymmetricObjectProperty") {
      const s = characteristicsMap.get(ax.propertyIri) ?? new Set();
      s.add("Symmetric");
      characteristicsMap.set(ax.propertyIri, s);
    }
    if (ax.type === "AsymmetricObjectProperty") {
      const s = characteristicsMap.get(ax.propertyIri) ?? new Set();
      s.add("Asymmetric");
      characteristicsMap.set(ax.propertyIri, s);
    }
    if (ax.type === "InverseObjectProperty") {
      inverseMap.set(ax.propertyIri, ax.inversePropertyIri);
      inverseMap.set(ax.inversePropertyIri, ax.propertyIri);
    }
    if (ax.type === "DataPropertyRange" && ax.range) {
      const r = rangesMap.get(ax.propertyIri) ?? new Set();
      r.add(ax.range);
      rangesMap.set(ax.propertyIri, r);
    }
    if (ax.type === "SubObjectPropertyOf" || ax.type === "SubDataPropertyOf") {
      const sub = ax.subPropertyIri ?? ax.subProperty;
      const sup = ax.superPropertyIri ?? ax.superProperty;
      if (sub && sup) {
        childProperties.add(sub);
        const list = subPropertyMap.get(sup) ?? [];
        list.push(sub);
        subPropertyMap.set(sup, list);
      }
    }
  }

  const result: TreeNodeInfo[] = [];

  if (propertyType === "object") {
    for (const iri of objProps) {
      if (childProperties.has(iri)) continue;
      const chars = Array.from(characteristicsMap.get(iri) ?? []);
      const inv = inverseMap.get(iri);
      const descParts: string[] = [];
      if (chars.length > 0) descParts.push(chars.join(", "));
      if (inv) descParts.push(`⇆ ${getShortLabel(inv)}`);

      const subs = subPropertyMap.get(iri) ?? [];
      result.push({
        id: `__OWL_OBJ_PROP__:${iri}`,
        name: getShortLabel(iri),
        compositeName: iri,
        classKind: "owl2-object-property",
        icon: "symbol-property",
        description: descParts.join(" · "),
        hasChildren: subs.length > 0,
        language: "owl2",
      });
    }
  } else {
    for (const iri of dataProps) {
      if (childProperties.has(iri)) continue;
      const ranges = Array.from(rangesMap.get(iri) ?? []);
      const chars = Array.from(characteristicsMap.get(iri) ?? []);
      const descParts: string[] = [];
      if (ranges.length > 0) descParts.push(ranges.join(", "));
      if (chars.length > 0) descParts.push(chars.join(", "));

      const subs = subPropertyMap.get(iri) ?? [];
      result.push({
        id: `__OWL_DATA_PROP__:${iri}`,
        name: getShortLabel(iri),
        compositeName: iri,
        classKind: "owl2-data-property",
        icon: "symbol-field",
        description: descParts.join(" · "),
        hasChildren: subs.length > 0,
        language: "owl2",
      });
    }
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/**
 * Returns individual nodes.
 */
export function getOwlIndividualTreeNodes(store: any): TreeNodeInfo[] {
  if (!store?.axioms || store.axioms.length === 0) return [];

  const individualTypes = new Map<string, string>();
  for (const ax of store.axioms) {
    if (ax.type === "IndividualDeclaration" || ax.type === "NamedIndividualDeclaration") {
      if (!individualTypes.has(ax.iri)) {
        individualTypes.set(ax.iri, "");
      }
    } else if (ax.type === "ClassAssertion") {
      const indIri = ax.individualIri ?? ax.individual;
      const classIri = ax.classIri ?? ax.classExpr;
      if (indIri && classIri) {
        individualTypes.set(indIri, `:${getShortLabel(classIri)}`);
      }
    }
  }

  const result: TreeNodeInfo[] = [];
  for (const [iri, typeDesc] of individualTypes) {
    result.push({
      id: `__OWL_INDIVIDUAL__:${iri}`,
      name: getShortLabel(iri),
      compositeName: iri,
      classKind: "owl2-individual",
      icon: "symbol-misc",
      description: typeDesc,
      hasChildren: false,
      language: "owl2",
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/**
 * Returns child sub-property nodes for a given parent property.
 */
export function getOwlSubPropertyTreeNodes(
  store: any,
  parentIri: string,
  propertyType: "object" | "data",
): TreeNodeInfo[] {
  if (!store?.axioms || store.axioms.length === 0) return [];

  const subProperties: string[] = [];
  const axiomType = propertyType === "object" ? "SubObjectPropertyOf" : "SubDataPropertyOf";

  for (const ax of store.axioms) {
    if (ax.type === axiomType) {
      const sup = ax.superPropertyIri ?? ax.superProperty;
      const sub = ax.subPropertyIri ?? ax.subProperty;
      if (sup === parentIri && sub) {
        subProperties.push(sub);
      }
    }
  }

  const allProps = getOwlPropertyTreeNodes(store, propertyType);
  const subSet = new Set(subProperties);
  return allProps.filter((p) => subSet.has(p.compositeName ?? ""));
}
