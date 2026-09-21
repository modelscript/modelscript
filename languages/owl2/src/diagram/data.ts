// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramData, DiagramEdge, DiagramNode } from "@modelscript/diagram/protocol";

export interface OWL2Entity {
  iri: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual";
  isDefinedClass?: boolean;
}

export interface OWL2Relationship {
  source: string;
  target: string;
  label: string;
  type: "subClassOf" | "equivalentTo" | "disjointWith" | "domain" | "range" | "objectProperty" | "inverseOf";
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

/**
 * Builds DiagramData for an OWL 2 ontology suitable for AntV X6 rendering.
 */
export function buildOWL2DiagramData(
  axioms: any[],
  layout?: { elements?: Record<string, { x: number; y: number; width?: number; height?: number }> },
  diagramType: string = "All",
): DiagramData {
  const nodesMap = new Map<string, OWL2Entity>();
  const edgesData: OWL2Relationship[] = [];

  // Track defined classes (classes appearing in EquivalentClasses with >1 operands)
  const definedClasses = new Set<string>();
  for (const ax of axioms) {
    if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length > 1) {
      for (const c of ax.classIris) definedClasses.add(c);
    }
  }

  for (const ax of axioms) {
    if (ax.type === "ClassDeclaration" || ax.type === "Class") {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "class",
        isDefinedClass: definedClasses.has(ax.iri),
      });
    } else if (ax.type === "ObjectPropertyDeclaration" || ax.type === "ObjectProperty") {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "objectProperty",
      });
    } else if (ax.type === "DataPropertyDeclaration" || ax.type === "DataProperty") {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "dataProperty",
      });
    } else if (ax.type === "IndividualDeclaration" || ax.type === "NamedIndividual") {
      nodesMap.set(ax.iri, {
        iri: ax.iri,
        label: getShortLabel(ax.iri),
        type: "individual",
      });
    } else if (ax.type === "SubClassOf") {
      if (!nodesMap.has(ax.subClassIri)) {
        nodesMap.set(ax.subClassIri, {
          iri: ax.subClassIri,
          label: getShortLabel(ax.subClassIri),
          type: "class",
          isDefinedClass: definedClasses.has(ax.subClassIri),
        });
      }
      if (!nodesMap.has(ax.superClassIri)) {
        nodesMap.set(ax.superClassIri, {
          iri: ax.superClassIri,
          label: getShortLabel(ax.superClassIri),
          type: "class",
          isDefinedClass: definedClasses.has(ax.superClassIri),
        });
      }
      edgesData.push({
        source: ax.subClassIri,
        target: ax.superClassIri,
        label: "subClassOf",
        type: "subClassOf",
      });
    } else if (ax.type === "ObjectPropertyAssertion") {
      if (!nodesMap.has(ax.subjectIri)) {
        nodesMap.set(ax.subjectIri, {
          iri: ax.subjectIri,
          label: getShortLabel(ax.subjectIri),
          type: "individual",
        });
      }
      if (!nodesMap.has(ax.objectIri)) {
        nodesMap.set(ax.objectIri, {
          iri: ax.objectIri,
          label: getShortLabel(ax.objectIri),
          type: "individual",
        });
      }
      edgesData.push({
        source: ax.subjectIri,
        target: ax.objectIri,
        label: getShortLabel(ax.propertyIri),
        type: "objectProperty",
      });
    } else if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        edgesData.push({
          source: ax.classIris[i],
          target: ax.classIris[i + 1],
          label: "equivalentTo",
          type: "equivalentTo",
        });
      }
    } else if (ax.type === "DisjointClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        edgesData.push({
          source: ax.classIris[i],
          target: ax.classIris[i + 1],
          label: "disjointWith",
          type: "disjointWith",
        });
      }
    }
  }

  // Filter by diagramType if applicable
  let filteredEntities = Array.from(nodesMap.values());
  let filteredEdges = edgesData;

  if (diagramType === "Taxonomy" || diagramType === "Hierarchy") {
    filteredEntities = filteredEntities.filter((e) => e.type === "class");
    filteredEdges = filteredEdges.filter((e) => e.type === "subClassOf" || e.type === "equivalentTo");
  } else if (diagramType === "Properties") {
    filteredEntities = filteredEntities.filter((e) => e.type === "objectProperty" || e.type === "dataProperty");
    filteredEdges = filteredEdges.filter((e) => e.type === "domain" || e.type === "range" || e.type === "inverseOf");
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
    const style = typeStyles[styleKey] ?? typeStyles.class;

    const savedPos = layout?.elements?.[entity.iri] ?? layout?.elements?.[entity.label];
    const width = savedPos?.width ?? 160;
    const height = savedPos?.height ?? 54;
    const x = savedPos?.x ?? 0;
    const y = savedPos?.y ?? 0;
    const autoLayout = !savedPos;

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
      markup: {
        tagName: "g",
        children: [
          {
            tagName: "rect",
            attrs: {
              width,
              height,
              rx: entity.type === "individual" ? 14 : 4,
              ry: entity.type === "individual" ? 14 : 4,
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
    let targetMarker: any = undefined;

    if (rel.type === "subClassOf") {
      stroke = "#569cd6";
      targetMarker = {
        name: "path",
        d: "M 0 -6 L 10 0 L 0 6 Z",
        fill: "#ffffff",
        stroke: "#569cd6",
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
              fill: "#999",
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
  };
}
