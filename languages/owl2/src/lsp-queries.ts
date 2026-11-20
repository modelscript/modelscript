// SPDX-License-Identifier: AGPL-3.0-or-later

import { getCachedOwl2Taxonomy, getShortLabel, type Owl2OntologyStoreLike } from "./tree-utils.js";

export interface OWL2ClassNode {
  iri: string;
  label: string;
  hasChildren: boolean;
  isDefinedClass: boolean;
  superClasses: string[];
  disjointWith: string[];
  equivalentTo: string[];
}

export interface OWL2PropertyNode {
  iri: string;
  label: string;
  propertyType: "object" | "data" | "annotation";
  hasChildren: boolean;
  domain: string[];
  range: string[];
  characteristics: string[];
  inverseOf?: string | undefined;
}

export interface OWL2DiagramNode {
  id: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual";
  isDefinedClass?: boolean | undefined;
}

export interface OWL2DiagramEdge {
  source: string;
  target: string;
  label: string;
  type: "subClassOf" | "equivalentTo" | "disjointWith" | "domain" | "range" | "objectProperty" | "inverseOf";
}

export interface OWL2DiagramData {
  nodes: OWL2DiagramNode[];
  edges: OWL2DiagramEdge[];
}

export async function getOwl2ClassHierarchy(
  store?: Owl2OntologyStoreLike | null,
  parentIri?: string | null,
): Promise<OWL2ClassNode[]> {
  if (!store || !store.axioms || store.axioms.length === 0) return [];
  const { taxonomy, taxMap } = await getCachedOwl2Taxonomy(store);

  const definedClasses = new Set<string>();
  const disjointMap = new Map<string, string[]>();
  for (const ax of store.axioms) {
    if (ax.type === "EquivalentClasses" && ax.classIris.length > 1) {
      for (const c of ax.classIris) definedClasses.add(c);
    }
    if (ax.type === "DisjointClasses") {
      for (let i = 0; i < ax.classIris.length; i++) {
        const c1 = ax.classIris[i]!;
        const list = disjointMap.get(c1) ?? [];
        for (let j = 0; j < ax.classIris.length; j++) {
          if (i !== j) list.push(ax.classIris[j]!);
        }
        disjointMap.set(c1, list);
      }
    }
  }

  if (!parentIri) {
    const roots: OWL2ClassNode[] = [];
    for (const node of taxonomy) {
      if (node.iri === "owl:Thing") continue;
      const filteredSupers = node.directSuperClasses.filter((s: string) => s !== "owl:Thing");
      if (filteredSupers.length === 0) {
        roots.push({
          iri: node.iri,
          label: getShortLabel(node.iri),
          hasChildren: node.directSubClasses.length > 0,
          isDefinedClass: definedClasses.has(node.iri),
          superClasses: [...node.directSuperClasses],
          disjointWith: disjointMap.get(node.iri) ?? [],
          equivalentTo: [...node.equivalentClasses],
        });
      }
    }
    return roots;
  }

  const parentNode = taxMap.get(parentIri);
  if (!parentNode) return [];

  const children: OWL2ClassNode[] = [];
  for (const subIri of parentNode.directSubClasses) {
    const subNode = taxMap.get(subIri);
    children.push({
      iri: subIri,
      label: getShortLabel(subIri),
      hasChildren: (subNode?.directSubClasses.length ?? 0) > 0,
      isDefinedClass: definedClasses.has(subIri),
      superClasses: subNode ? [...subNode.directSuperClasses] : [parentIri],
      disjointWith: disjointMap.get(subIri) ?? [],
      equivalentTo: subNode ? [...subNode.equivalentClasses] : [],
    });
  }
  return children;
}

export function getOwl2PropertyHierarchy(store?: Owl2OntologyStoreLike | null): OWL2PropertyNode[] {
  if (!store || !store.axioms || store.axioms.length === 0) return [];
  const objProps = new Set<string>();
  const dataProps = new Set<string>();
  const characteristicsMap = new Map<string, Set<string>>();
  const inverseMap = new Map<string, string>();
  const domainsMap = new Map<string, Set<string>>();
  const rangesMap = new Map<string, Set<string>>();

  const addChar = (propIri: string, charName: string) => {
    const s = characteristicsMap.get(propIri) ?? new Set();
    s.add(charName);
    characteristicsMap.set(propIri, s);
  };

  for (const ax of store.axioms) {
    if (ax.type === "ObjectPropertyDeclaration" && ax.iri) objProps.add(ax.iri);
    if (ax.type === "DataPropertyDeclaration" && ax.iri) dataProps.add(ax.iri);
    if (ax.type === "TransitiveObjectProperty" && ax.propertyIri) addChar(ax.propertyIri, "Transitive");
    if (ax.type === "FunctionalObjectProperty" && ax.propertyIri) addChar(ax.propertyIri, "Functional");
    if (ax.type === "FunctionalDataProperty" && ax.propertyIri) addChar(ax.propertyIri, "Functional");
    if (ax.type === "SymmetricObjectProperty" && ax.propertyIri) addChar(ax.propertyIri, "Symmetric");
    if (ax.type === "AsymmetricObjectProperty" && ax.propertyIri) addChar(ax.propertyIri, "Asymmetric");
    if (ax.type === "InverseObjectProperty" && ax.propertyIri && ax.inversePropertyIri) {
      inverseMap.set(ax.propertyIri, ax.inversePropertyIri);
      inverseMap.set(ax.inversePropertyIri, ax.propertyIri);
    }
    if ((ax.type === "ObjectPropertyDomain" || ax.type === "DataPropertyDomain") && ax.propertyIri) {
      const ext = ax as { domain?: string; domainIri?: string; classIri?: string; targetClassIri?: string };
      const dom = ext.domain ?? ext.domainIri ?? ext.classIri ?? ext.targetClassIri;
      if (dom) {
        const d = domainsMap.get(ax.propertyIri) ?? new Set();
        d.add(dom);
        domainsMap.set(ax.propertyIri, d);
      }
    }
    if ((ax.type === "ObjectPropertyRange" || ax.type === "DataPropertyRange") && ax.propertyIri) {
      const ext = ax as { range?: string; rangeIri?: string; classIri?: string; targetClassIri?: string };
      const rng = ext.range ?? ext.rangeIri ?? ext.classIri ?? ext.targetClassIri;
      if (rng) {
        const r = rangesMap.get(ax.propertyIri) ?? new Set();
        r.add(rng);
        rangesMap.set(ax.propertyIri, r);
      }
    }
    if (ax.type === "UniversalRestriction" && ax.propertyIri && ax.targetClassIri) {
      if (ax.classIri && ax.classIri !== "owl:Thing") {
        const d = domainsMap.get(ax.propertyIri) ?? new Set();
        d.add(ax.classIri);
        domainsMap.set(ax.propertyIri, d);
      }
      const r = rangesMap.get(ax.propertyIri) ?? new Set();
      r.add(ax.targetClassIri);
      rangesMap.set(ax.propertyIri, r);
    }
  }

  const result: OWL2PropertyNode[] = [];
  for (const iri of objProps) {
    result.push({
      iri,
      label: getShortLabel(iri),
      propertyType: "object",
      hasChildren: false,
      domain: Array.from(domainsMap.get(iri) ?? []),
      range: Array.from(rangesMap.get(iri) ?? []),
      characteristics: Array.from(characteristicsMap.get(iri) ?? []),
      inverseOf: inverseMap.get(iri),
    });
  }
  for (const iri of dataProps) {
    result.push({
      iri,
      label: getShortLabel(iri),
      propertyType: "data",
      hasChildren: false,
      domain: Array.from(domainsMap.get(iri) ?? []),
      range: Array.from(rangesMap.get(iri) ?? []),
      characteristics: Array.from(characteristicsMap.get(iri) ?? []),
    });
  }
  return result;
}

export function getOwl2DiagramData(store?: Owl2OntologyStoreLike | null): OWL2DiagramData {
  if (!store || !store.axioms || store.axioms.length === 0) return { nodes: [], edges: [] };
  const nodesMap = new Map<string, OWL2DiagramNode>();
  const edges: OWL2DiagramEdge[] = [];

  for (const ax of store.axioms) {
    if (ax.type === "ClassDeclaration") {
      nodesMap.set(ax.iri, { id: ax.iri, label: getShortLabel(ax.iri), type: "class" });
    } else if (ax.type === "ObjectPropertyDeclaration") {
      nodesMap.set(ax.iri, { id: ax.iri, label: getShortLabel(ax.iri), type: "objectProperty" });
    } else if (ax.type === "DataPropertyDeclaration") {
      nodesMap.set(ax.iri, { id: ax.iri, label: getShortLabel(ax.iri), type: "dataProperty" });
    } else if (ax.type === "IndividualDeclaration") {
      nodesMap.set(ax.iri, { id: ax.iri, label: getShortLabel(ax.iri), type: "individual" });
    } else if (ax.type === "SubClassOf") {
      if (!nodesMap.has(ax.subClassIri)) {
        nodesMap.set(ax.subClassIri, { id: ax.subClassIri, label: getShortLabel(ax.subClassIri), type: "class" });
      }
      if (!nodesMap.has(ax.superClassIri)) {
        nodesMap.set(ax.superClassIri, { id: ax.superClassIri, label: getShortLabel(ax.superClassIri), type: "class" });
      }
      edges.push({ source: ax.subClassIri, target: ax.superClassIri, label: "subClassOf", type: "subClassOf" });
    } else if (ax.type === "ObjectPropertyAssertion") {
      if (!nodesMap.has(ax.subjectIri)) {
        nodesMap.set(ax.subjectIri, { id: ax.subjectIri, label: getShortLabel(ax.subjectIri), type: "individual" });
      }
      if (!nodesMap.has(ax.objectIri)) {
        nodesMap.set(ax.objectIri, { id: ax.objectIri, label: getShortLabel(ax.objectIri), type: "individual" });
      }
      edges.push({
        source: ax.subjectIri,
        target: ax.objectIri,
        label: getShortLabel(ax.propertyIri),
        type: "objectProperty",
      });
    } else if (ax.type === "DisjointClasses" && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        edges.push({
          source: ax.classIris[i]!,
          target: ax.classIris[i + 1]!,
          label: "disjointWith",
          type: "disjointWith",
        });
      }
    }
  }

  return { nodes: Array.from(nodesMap.values()), edges };
}
