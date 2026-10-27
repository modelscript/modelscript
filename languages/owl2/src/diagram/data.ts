// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramData, DiagramEdge, DiagramNode } from "@modelscript/diagram/protocol";

export interface OWL2Entity {
  iri: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual";
  isDefinedClass?: boolean | undefined;
}

export interface OWL2Relationship {
  source: string;
  target: string;
  label: string;
  type:
    | "subClassOf"
    | "inferredSubClassOf"
    | "equivalentTo"
    | "disjointWith"
    | "domain"
    | "range"
    | "objectProperty"
    | "inverseOf"
    | "classAssertion";
}

export interface OWL2DiagramOptions {
  /** Inferred SubClassOf pairs computed by TableauReasoner */
  inferredSubClassOf?: { subClassIri: string; superClassIri: string }[] | undefined;
}

export function getShortLabel(iri: string): string {
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

export interface OWL2DiagramAxiom {
  readonly type: string;
  readonly iri?: string | undefined;
  readonly subClassIri?: string | undefined;
  readonly superClassIri?: string | undefined;
  readonly inferred?: boolean | undefined;
  readonly subjectIri?: string | undefined;
  readonly objectIri?: string | undefined;
  readonly propertyIri?: string | undefined;
  readonly classIri?: string | undefined;
  readonly individualIri?: string | undefined;
  readonly domainIri?: string | undefined;
  readonly rangeIri?: string | undefined;
  readonly targetClassIri?: string | undefined;
  readonly dataRange?: string | undefined;
  readonly inversePropertyIri?: string | undefined;
  readonly propertyIris?: readonly string[] | undefined;
  readonly classIris?: readonly string[] | undefined;
}

/**
 * Builds DiagramData for an OWL 2 ontology suitable for AntV X6 rendering.
 */
export function buildOWL2DiagramData(
  axioms: readonly OWL2DiagramAxiom[],
  layout?: {
    elements?:
      | Record<string, { x: number; y: number; width?: number | undefined; height?: number | undefined }>
      | undefined;
  },
  diagramType: string = "All",
  options?: OWL2DiagramOptions,
): DiagramData {
  const nodesMap = new Map<string, OWL2Entity>();
  const edgesData: OWL2Relationship[] = [];
  const assertedSubClassPairs = new Set<string>();

  // Track defined classes (classes appearing in EquivalentClasses with >1 operands)
  const definedClasses = new Set<string>();
  for (const ax of axioms) {
    if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length > 1) {
      for (const c of ax.classIris) definedClasses.add(c);
    }
  }

  const ensureNode = (iri: string, defaultType: OWL2Entity["type"]) => {
    if (!iri || iri === "owl:Thing" || iri === "owl:Nothing") return;
    if (!nodesMap.has(iri)) {
      nodesMap.set(iri, {
        iri,
        label: getShortLabel(iri),
        type: defaultType,
        ...(defaultType === "class" ? { isDefinedClass: definedClasses.has(iri) } : {}),
      });
    }
  };

  for (const ax of axioms) {
    if ((ax.type === "ClassDeclaration" || ax.type === "Class") && ax.iri) {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "class",
        isDefinedClass: definedClasses.has(ax.iri),
      });
    } else if ((ax.type === "ObjectPropertyDeclaration" || ax.type === "ObjectProperty") && ax.iri) {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "objectProperty",
      });
    } else if ((ax.type === "DataPropertyDeclaration" || ax.type === "DataProperty") && ax.iri) {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "dataProperty",
      });
    } else if ((ax.type === "IndividualDeclaration" || ax.type === "NamedIndividual") && ax.iri) {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "individual",
      });
    } else if (ax.type === "SubClassOf" && ax.subClassIri && ax.superClassIri) {
      ensureNode(ax.subClassIri, "class");
      ensureNode(ax.superClassIri, "class");
      const isInferred = Boolean(ax.inferred);
      if (!isInferred) {
        assertedSubClassPairs.add(`${ax.subClassIri}→${ax.superClassIri}`);
      }
      edgesData.push({
        source: ax.subClassIri,
        target: ax.superClassIri,
        label: isInferred ? "«inferred» subClassOf" : "subClassOf",
        type: isInferred ? "inferredSubClassOf" : "subClassOf",
      });
    } else if (ax.type === "ObjectPropertyAssertion" && ax.subjectIri && ax.objectIri && ax.propertyIri) {
      ensureNode(ax.subjectIri, "individual");
      ensureNode(ax.objectIri, "individual");
      edgesData.push({
        source: ax.subjectIri,
        target: ax.objectIri,
        label: getShortLabel(ax.propertyIri),
        type: "objectProperty",
      });
    } else if (ax.type === "ClassAssertion") {
      const classIri = ax.classIri;
      const indivIri = ax.individualIri;
      if (classIri && indivIri) {
        ensureNode(indivIri, "individual");
        ensureNode(classIri, "class");
        edgesData.push({
          source: indivIri,
          target: classIri,
          label: "rdf:type",
          type: "classAssertion",
        });
      }
    } else if (ax.type === "ObjectPropertyDomain" || ax.type === "DataPropertyDomain") {
      const propIri = ax.propertyIri;
      const domainIri = ax.domainIri ?? ax.classIri ?? ax.targetClassIri;
      if (propIri && domainIri) {
        ensureNode(propIri, ax.type === "DataPropertyDomain" ? "dataProperty" : "objectProperty");
        ensureNode(domainIri, "class");
        edgesData.push({
          source: propIri,
          target: domainIri,
          label: "rdfs:domain",
          type: "domain",
        });
      }
    } else if (ax.type === "ObjectPropertyRange" || ax.type === "DataPropertyRange") {
      const propIri = ax.propertyIri;
      const rangeIri = ax.rangeIri ?? ax.classIri ?? ax.targetClassIri ?? ax.dataRange;
      if (propIri && rangeIri) {
        ensureNode(propIri, ax.type === "DataPropertyRange" ? "dataProperty" : "objectProperty");
        ensureNode(rangeIri, "class");
        edgesData.push({
          source: propIri,
          target: rangeIri,
          label: "rdfs:range",
          type: "range",
        });
      }
    } else if (ax.type === "UniversalRestriction" && !ax.classIri && ax.propertyIri && ax.targetClassIri) {
      ensureNode(ax.propertyIri, "objectProperty");
      ensureNode(ax.targetClassIri, "class");
      edgesData.push({
        source: ax.propertyIri,
        target: ax.targetClassIri,
        label: "domain/range",
        type: "domain",
      });
    } else if (ax.type === "InverseObjectProperty" || ax.type === "InverseObjectProperties") {
      const p1 = ax.propertyIri ?? ax.propertyIris?.[0];
      const p2 = ax.inversePropertyIri ?? ax.propertyIris?.[1];
      if (p1 && p2) {
        ensureNode(p1, "objectProperty");
        ensureNode(p2, "objectProperty");
        edgesData.push({
          source: p1,
          target: p2,
          label: "owl:inverseOf",
          type: "inverseOf",
        });
      }
    } else if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        const c1 = ax.classIris[i]!;
        const c2 = ax.classIris[i + 1]!;
        ensureNode(c1, "class");
        ensureNode(c2, "class");
        edgesData.push({
          source: c1,
          target: c2,
          label: "equivalentTo",
          type: "equivalentTo",
        });
      }
    } else if (ax.type === "DisjointClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        const c1 = ax.classIris[i]!;
        const c2 = ax.classIris[i + 1]!;
        ensureNode(c1, "class");
        ensureNode(c2, "class");
        edgesData.push({
          source: c1,
          target: c2,
          label: "disjointWith",
          type: "disjointWith",
        });
      }
    }
  }

  // Append DL reasoner inferred SubClassOf edges (skipping owl:Thing, reflexive, and already-asserted pairs)
  if (options?.inferredSubClassOf) {
    for (const inf of options.inferredSubClassOf) {
      if (
        !inf.subClassIri ||
        !inf.superClassIri ||
        inf.subClassIri === inf.superClassIri ||
        inf.superClassIri === "owl:Thing" ||
        inf.subClassIri === "owl:Nothing"
      ) {
        continue;
      }
      const key = `${inf.subClassIri}→${inf.superClassIri}`;
      if (assertedSubClassPairs.has(key)) continue;
      assertedSubClassPairs.add(key);
      ensureNode(inf.subClassIri, "class");
      ensureNode(inf.superClassIri, "class");
      edgesData.push({
        source: inf.subClassIri,
        target: inf.superClassIri,
        label: "«inferred» subClassOf",
        type: "inferredSubClassOf",
      });
    }
  }

  // Filter by diagramType if applicable
  let filteredEntities = Array.from(nodesMap.values());
  let filteredEdges = edgesData;

  if (diagramType === "Taxonomy" || diagramType === "Hierarchy") {
    filteredEntities = filteredEntities.filter((e) => e.type === "class");
    filteredEdges = filteredEdges.filter(
      (e) => e.type === "subClassOf" || e.type === "inferredSubClassOf" || e.type === "equivalentTo",
    );
  } else if (diagramType === "Properties") {
    filteredEdges = filteredEdges.filter((e) => e.type === "domain" || e.type === "range" || e.type === "inverseOf");
    const connectedEndpoints = new Set<string>();
    for (const e of filteredEdges) {
      connectedEndpoints.add(e.source);
      connectedEndpoints.add(e.target);
    }
    filteredEntities = filteredEntities.filter(
      (e) => e.type === "objectProperty" || e.type === "dataProperty" || connectedEndpoints.has(e.iri),
    );
  }

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const typeStyles: Record<string, { fill: string; stroke: string; header: string }> = {
    class: { fill: "#1e1e1e", stroke: "#e74c3c", header: "«owl:Class»" },
    definedClass: { fill: "#1e1e1e", stroke: "#f39c12", header: "«owl:DefinedClass»" },
    objectProperty: { fill: "#1e1e1e", stroke: "#3498db", header: "«owl:ObjectProperty»" },
    dataProperty: { fill: "#1e1e1e", stroke: "#2ecc71", header: "«owl:DataProperty»" },
    individual: { fill: "#1e1e1e", stroke: "#9b59b6", header: "«owl:NamedIndividual»" },
  };

  const portGroups = {
    top: { position: "top", zIndex: 10 },
    bottom: { position: "bottom", zIndex: 10 },
    left: { position: "left", zIndex: 10 },
    right: { position: "right", zIndex: 10 },
  };

  for (const entity of filteredEntities) {
    const isDefined = entity.isDefinedClass === true;
    const styleKey = isDefined ? "definedClass" : entity.type;
    const style = typeStyles[styleKey] ?? typeStyles["class"]!;

    const savedPos = layout?.elements?.[entity.iri] ?? layout?.elements?.[entity.label];
    const width = savedPos?.width ?? 160;
    const height = savedPos?.height ?? 54;
    const x = savedPos?.x ?? 0;
    const y = savedPos?.y ?? 0;
    const autoLayout = !savedPos;
    const rx = entity.type === "individual" ? 14 : 4;

    nodes.push({
      id: entity.iri,
      x,
      y,
      width,
      height,
      angle: 0,
      opacity: 1,
      zIndex: 1,
      autoLayout,
      properties: {
        className: isDefined ? "DefinedClass" : entity.type.charAt(0).toUpperCase() + entity.type.slice(1),
        name: entity.label,
        description: entity.iri,
        parameters: [
          { name: "iri", value: entity.iri, group: "Identification" },
          { name: "type", value: entity.type, group: "Identification" },
          { name: "isDefinedClass", value: String(isDefined), group: "Identification", isBoolean: true },
        ],
      },
      ports: {
        groups: portGroups,
        items: [
          {
            id: "top",
            group: "top",
            args: { x: width / 2, y: 0, angle: 0 },
            markup: { tagName: "circle", attrs: { r: 3, fill: style.stroke } },
          },
          {
            id: "bottom",
            group: "bottom",
            args: { x: width / 2, y: height, angle: 0 },
            markup: { tagName: "circle", attrs: { r: 3, fill: style.stroke } },
          },
          {
            id: "left",
            group: "left",
            args: { x: 0, y: height / 2, angle: 0 },
            markup: { tagName: "circle", attrs: { r: 3, fill: style.stroke } },
          },
          {
            id: "right",
            group: "right",
            args: { x: width, y: height / 2, angle: 0 },
            markup: { tagName: "circle", attrs: { r: 3, fill: style.stroke } },
          },
        ],
      },
      attrs: {
        body: {
          fill: style.fill,
          stroke: style.stroke,
          strokeWidth: 2,
          rx,
          ry: rx,
        },
        header: {
          text: style.header,
          fill: style.stroke,
          fontSize: 9,
          fontWeight: "600",
        },
        label: {
          text: entity.label,
          fill: "#e0e0e0",
          fontSize: 12,
          fontWeight: "600",
        },
      },
      markup: {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            attrs: {
              width,
              height,
              rx,
              ry: rx,
              fill: style.fill,
              stroke: style.stroke,
              "stroke-width": 2,
            },
          },
          {
            tagName: "text",
            textContent: style.header,
            attrs: {
              x: width / 2,
              y: 16,
              "text-anchor": "middle",
              fill: style.stroke,
              "font-size": 9,
              "font-weight": 600,
            },
          },
          {
            tagName: "text",
            textContent: entity.label,
            attrs: {
              x: width / 2,
              y: 36,
              "text-anchor": "middle",
              fill: "#e0e0e0",
              "font-size": 12,
              "font-weight": 600,
            },
          },
        ],
      },
    });
  }

  let edgeIdx = 0;
  for (const rel of filteredEdges) {
    edgeIdx++;
    const edgeId = `owl_edge_${edgeIdx}_${rel.source}_${rel.target}`;

    let stroke = "#569cd6";
    let strokeDasharray: string | undefined = undefined;
    let targetMarker: Record<string, unknown> | undefined = undefined;

    if (rel.type === "subClassOf") {
      stroke = "#569cd6";
      targetMarker = {
        name: "path",
        d: "M 0 -6 L 10 0 L 0 6 Z",
        fill: "#ffffff",
        stroke: "#569cd6",
      };
    } else if (rel.type === "inferredSubClassOf") {
      stroke = "#a855f7";
      strokeDasharray = "6 3";
      targetMarker = {
        name: "path",
        d: "M 0 -6 L 10 0 L 0 6 Z",
        fill: "#1e1e1e",
        stroke: "#a855f7",
      };
    } else if (rel.type === "equivalentTo") {
      stroke = "#f39c12";
      strokeDasharray = "6 3";
    } else if (rel.type === "disjointWith") {
      stroke = "#e74c3c";
      strokeDasharray = "4 4";
    } else if (rel.type === "objectProperty") {
      stroke = "#9b59b6";
      targetMarker = { name: "classic", fill: "#9b59b6" };
    } else if (rel.type === "domain") {
      stroke = "#2ecc71";
      targetMarker = { name: "classic", fill: "#2ecc71" };
    } else if (rel.type === "range") {
      stroke = "#e67e22";
      targetMarker = { name: "classic", fill: "#e67e22" };
    } else if (rel.type === "inverseOf") {
      stroke = "#95a5a6";
      strokeDasharray = "4 4";
      targetMarker = { name: "classic", fill: "#95a5a6" };
    } else if (rel.type === "classAssertion") {
      stroke = "#9b59b6";
      strokeDasharray = "3 3";
      targetMarker = { name: "classic", fill: "#9b59b6" };
    }

    edges.push({
      id: edgeId,
      source: { cell: rel.source, port: "right", anchor: "right", connectionPoint: { name: "boundary" } },
      target: { cell: rel.target, port: "left", anchor: "left", connectionPoint: { name: "boundary" } },
      zIndex: 0,
      router: "port-orthogonal-astar",
      style: { type: rel.type },
      labels: [
        {
          attrs: {
            text: {
              text: rel.label,
              fill: rel.type === "inferredSubClassOf" ? "#c084fc" : "#999",
              fontSize: 10,
            },
            rect: {
              fill: "#1e1e1e",
              rx: 2,
              ry: 2,
            },
          },
        },
      ],
      attrs: {
        line: {
          stroke,
          strokeWidth: 1.5,
          strokeDasharray,
          targetMarker,
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "none",
        },
      },
    });
  }

  return {
    nodes,
    edges,
    coordinateSystem: { x: 0, y: 0, width: 800, height: 600 },
    diagramBackground: null,
    availableViews: [
      { id: "All", label: "All Entities" },
      { id: "Taxonomy", label: "Class Taxonomy" },
      { id: "Properties", label: "Properties & Domains" },
    ],
    activeView: diagramType,
  };
}
