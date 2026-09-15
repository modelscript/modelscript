// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { TableauReasoner } from "@modelscript/runtime/wasm_ontology.js";
import { LspContext } from "../LspContext.js";

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
  inverseOf?: string;
}

export interface OWL2DiagramData {
  nodes: OWL2DiagramNode[];
  edges: OWL2DiagramEdge[];
}

export interface OWL2DiagramNode {
  id: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual";
  isDefinedClass?: boolean;
}

export interface OWL2DiagramEdge {
  source: string;
  target: string;
  label: string;
  type: "subClassOf" | "equivalentTo" | "disjointWith" | "domain" | "range" | "objectProperty" | "inverseOf";
}

function getShortLabel(iri: string): string {
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

export function registerOwl2Endpoints(context: LspContext): void {
  // 1. Class Hierarchy endpoint
  context.connection.onRequest(
    "modelscript/owl2/classHierarchy",
    async (params: { uri?: string; parentIri?: string | null }): Promise<OWL2ClassNode[]> => {
      const store = context.workspaceManager.unifiedWorkspace.owl2Store;
      const reasoner = new TableauReasoner();
      await reasoner.init();
      reasoner.loadOntology(store.axioms);
      reasoner.classify();

      const taxonomy = reasoner.getTaxonomy();
      const taxMap = new Map<string, (typeof taxonomy)[0]>();
      for (const node of taxonomy) {
        taxMap.set(node.iri, node);
      }

      // Collect defined classes and disjoint pairs from axioms
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

      if (!params.parentIri) {
        // Return root level classes (no superclasses, or superclass is only owl:Thing)
        const roots: OWL2ClassNode[] = [];
        for (const node of taxonomy) {
          if (node.iri === "owl:Thing") continue;
          const filteredSupers = node.directSuperClasses.filter((s) => s !== "owl:Thing");
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

      // Return children of parentIri
      const parentNode = taxMap.get(params.parentIri);
      if (!parentNode) return [];

      const children: OWL2ClassNode[] = [];
      for (const subIri of parentNode.directSubClasses) {
        const subNode = taxMap.get(subIri);
        children.push({
          iri: subIri,
          label: getShortLabel(subIri),
          hasChildren: (subNode?.directSubClasses.length ?? 0) > 0,
          isDefinedClass: definedClasses.has(subIri),
          superClasses: subNode ? [...subNode.directSuperClasses] : [params.parentIri],
          disjointWith: disjointMap.get(subIri) ?? [],
          equivalentTo: subNode ? [...subNode.equivalentClasses] : [],
        });
      }
      return children;
    },
  );

  // 2. Property Hierarchy endpoint
  context.connection.onRequest(
    "modelscript/owl2/propertyHierarchy",
    async (_params: {
      uri?: string;
      parentIri?: string | null;
      propertyType?: string | null;
    }): Promise<OWL2PropertyNode[]> => {
      const store = context.workspaceManager.unifiedWorkspace.owl2Store;
      const objProps = new Set<string>();
      const dataProps = new Set<string>();
      const characteristicsMap = new Map<string, Set<string>>();
      const inverseMap = new Map<string, string>();
      const domainsMap = new Map<string, Set<string>>();
      const rangesMap = new Map<string, Set<string>>();

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
    },
  );

  // 3. Diagram Data endpoint
  context.connection.onRequest(
    "modelscript/owl2/diagramData",
    async (_params: { uri?: string }): Promise<OWL2DiagramData> => {
      const store = context.workspaceManager.unifiedWorkspace.owl2Store;
      const nodesMap = new Map<string, OWL2DiagramNode>();
      const edges: OWL2DiagramEdge[] = [];

      for (const ax of store.axioms) {
        if (ax.type === "ClassDeclaration") {
          nodesMap.set(ax.iri, {
            id: ax.iri,
            label: getShortLabel(ax.iri),
            type: "class",
          });
        } else if (ax.type === "ObjectPropertyDeclaration") {
          nodesMap.set(ax.iri, {
            id: ax.iri,
            label: getShortLabel(ax.iri),
            type: "objectProperty",
          });
        } else if (ax.type === "DataPropertyDeclaration") {
          nodesMap.set(ax.iri, {
            id: ax.iri,
            label: getShortLabel(ax.iri),
            type: "dataProperty",
          });
        } else if (ax.type === "IndividualDeclaration") {
          nodesMap.set(ax.iri, {
            id: ax.iri,
            label: getShortLabel(ax.iri),
            type: "individual",
          });
        } else if (ax.type === "SubClassOf") {
          if (!nodesMap.has(ax.subClassIri)) {
            nodesMap.set(ax.subClassIri, { id: ax.subClassIri, label: getShortLabel(ax.subClassIri), type: "class" });
          }
          if (!nodesMap.has(ax.superClassIri)) {
            nodesMap.set(ax.superClassIri, {
              id: ax.superClassIri,
              label: getShortLabel(ax.superClassIri),
              type: "class",
            });
          }
          edges.push({
            source: ax.subClassIri,
            target: ax.superClassIri,
            label: "subClassOf",
            type: "subClassOf",
          });
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

      return {
        nodes: Array.from(nodesMap.values()),
        edges,
      };
    },
  );

  // 4. Go To Declaration endpoint
  context.connection.onRequest(
    "modelscript/owl2/goToDeclaration",
    async (params: { iri: string }): Promise<{ uri: string; line: number; character: number } | null> => {
      const idx = context.workspaceManager.owl2WorkspaceIndex;
      if (idx && typeof idx.toUnifiedPartial === "function") {
        const unified = idx.toUnifiedPartial();
        const ids = unified.byName.get(params.iri) ?? [];
        if (ids.length > 0) {
          const entry = unified.symbols.get(ids[0]!);
          if (entry?.resourceId) {
            const bridge = context.state.documentLSPBridges.get(entry.resourceId);
            if (bridge) {
              const pos = (bridge as any).positions.offsetToPosition(entry.startByte);
              return { uri: entry.resourceId, line: pos.line, character: pos.character };
            }
          }
        }
      }
      return null;
    },
  );
}
