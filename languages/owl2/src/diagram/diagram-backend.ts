// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramData,
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramGetPaletteParams,
  type DiagramPalette,
  type PropertyFieldConfig,
  type PropertyGroupConfig,
  type PropertyTabConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";
import { buildOWL2DiagramData, type OWL2DiagramAxiom } from "./data.js";
import {
  computeOWL2ConnectionDelete,
  computeOWL2ConnectionInsert,
  computeOWL2ElementDelete,
  computeOWL2ElementInsert,
  computeOWL2NameEdit,
} from "./edits.js";

export interface Owl2LayoutLike {
  elements?:
    | Record<string, { x: number; y: number; width?: number | undefined; height?: number | undefined }>
    | undefined;
}

export interface Owl2BackendDeps<
  TAxiom extends OWL2DiagramAxiom = OWL2DiagramAxiom,
  TLayout extends Owl2LayoutLike = Owl2LayoutLike,
> {
  getDocumentText: (uri: string) => string | undefined;
  getAxioms: (uri: string) => TAxiom[];
  getInferredSubClassOf?:
    | ((uri: string, axioms: TAxiom[]) => { subClassIri: string; superClassIri: string }[])
    | undefined;
  getLayout?: ((uri: string) => TLayout | undefined) | undefined;
  setLayout?: ((uri: string, layout: TLayout) => void) | undefined;
  createEmptyLayout?: (() => TLayout) | undefined;
  updateElementPositions?:
    | ((
        layout: TLayout,
        items: { name: string; x: number; y: number; width: number; height: number; rotation?: number | undefined }[],
      ) => TLayout)
    | undefined;
  updateConnectionVertices?:
    | ((layout: TLayout, updates: { id: string; vertices: { x: number; y: number }[] }[]) => TLayout)
    | undefined;
  removeElements?: ((layout: TLayout, names: string[]) => TLayout) | undefined;
  serializeLayout?: ((layout: TLayout) => string) | undefined;
  getSidecarUri?: ((uri: string) => string) | undefined;
  computeConnectionInsert?:
    | ((text: string, source: string, target: string, edgeType?: string) => TextEdit[])
    | undefined;
  computeConnectionDelete?: ((text: string, source: string, target: string) => TextEdit[]) | undefined;
  computeElementInsert?: ((text: string, elementType: string, name: string) => TextEdit[]) | undefined;
  computeElementDelete?: ((text: string, names: string[]) => TextEdit[]) | undefined;
  computeNameEdit?: ((text: string, oldIri: string, newIri: string) => TextEdit[]) | undefined;
  buildDiagramData?:
    | ((
        axioms: TAxiom[],
        layout?: TLayout,
        diagramType?: string,
        options?: { inferredSubClassOf?: { subClassIri: string; superClassIri: string }[] },
      ) => DiagramData)
    | undefined;
  getEntityData?:
    | ((
        uri: string,
        entityIri: string,
      ) => {
        iri: string;
        type: string;
        axioms?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
      } | null)
    | undefined;
}

export class Owl2DiagramBackend<
  TAxiom extends OWL2DiagramAxiom = OWL2DiagramAxiom,
  TLayout extends Owl2LayoutLike = Owl2LayoutLike,
> implements DiagramBackend {
  constructor(private readonly deps: Owl2BackendDeps<TAxiom, TLayout>) {}

  getData(params: DiagramGetDataParams): DiagramData | null {
    const axioms = this.deps.getAxioms(params.uri);
    const layout = this.deps.getLayout ? this.deps.getLayout(params.uri) : undefined;
    const inferredSubClassOf = this.deps.getInferredSubClassOf
      ? this.deps.getInferredSubClassOf(params.uri, axioms)
      : undefined;
    const builder = this.deps.buildDiagramData ?? buildOWL2DiagramData;
    return builder(axioms, layout, params.diagramType, inferredSubClassOf ? { inferredSubClassOf } : undefined);
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const name = params.componentName;
    const uri = params.uri;
    const axioms = this.deps.getAxioms(uri);

    const relatedAxioms: string[] = [];
    let entityType = "Class";
    const namePattern = name.replace(/^:/, "");

    for (const ax of axioms) {
      const axStr = JSON.stringify(ax);
      if (axStr.includes(namePattern)) {
        if (ax.type === "ClassDeclaration" && ax.iri?.includes(namePattern)) entityType = "Class";
        else if (ax.type === "ObjectPropertyDeclaration" && ax.iri?.includes(namePattern))
          entityType = "ObjectProperty";
        else if (ax.type === "DataPropertyDeclaration" && ax.iri?.includes(namePattern)) entityType = "DataProperty";
        else if (ax.type === "IndividualDeclaration" && ax.iri?.includes(namePattern)) entityType = "Individual";

        if (ax.type === "SubClassOf") {
          relatedAxioms.push(`SubClassOf(${ax.subClassIri} ${ax.superClassIri})`);
        } else if (ax.type === "EquivalentClasses") {
          relatedAxioms.push(`EquivalentClasses(${ax.classIris?.join(" ")})`);
        } else if (ax.type === "DisjointClasses") {
          relatedAxioms.push(`DisjointClasses(${ax.classIris?.join(" ")})`);
        } else if (ax.type === "ObjectPropertyAssertion") {
          relatedAxioms.push(`ObjectPropertyAssertion(${ax.propertyIri} ${ax.subjectIri} ${ax.objectIri})`);
        }
      }
    }

    const generalFields: PropertyFieldConfig[] = [
      { key: "iri", label: "IRI", kind: "string", defaultValue: name, readOnly: true },
      { key: "name", label: "Short Name", kind: "string", defaultValue: name.replace(/^.*[#/:]/, "") },
      { key: "type", label: "Entity Type", kind: "string", defaultValue: entityType, readOnly: true },
    ];

    const generalGroups: PropertyGroupConfig[] = [
      {
        id: "identification",
        label: "Identification",
        fields: generalFields,
      },
    ];

    const axiomFields: PropertyFieldConfig[] = relatedAxioms.map((ax, idx) => ({
      key: `axiom_${idx}`,
      label: `Axiom ${idx + 1}`,
      kind: "expression",
      defaultValue: ax,
      readOnly: true,
    }));

    const axiomGroups: PropertyGroupConfig[] =
      axiomFields.length > 0
        ? [
            {
              id: "axioms",
              label: "Axioms",
              fields: axiomFields,
            },
          ]
        : [];

    const tabs: PropertyTabConfig[] = [
      { id: "general", label: "General", groups: generalGroups },
      { id: "axioms", label: "Axioms", groups: axiomGroups },
      { id: "annotations", label: "Annotations", groups: [] },
    ];

    const values: Record<string, unknown> = {
      iri: name,
      name: name.replace(/^.*[#/:]/, ""),
      type: entityType,
    };
    relatedAxioms.forEach((ax, idx) => {
      values[`axiom_${idx}`] = ax;
    });

    return {
      name,
      className: entityType,
      description: name,
      schema: { tabs },
      values,
      parameters: [],
    };
  }

  applyEdits(params: DiagramApplyEditsParams): DiagramApplyEditsResult {
    const docText = this.deps.getDocumentText(params.uri) ?? "";
    const allEdits: TextEdit[] = [];
    let needsRender: "none" | "immediate" | "debounced" = "none";
    let layout = this.deps.getLayout ? this.deps.getLayout(params.uri) : undefined;
    if (!layout && this.deps.createEmptyLayout) {
      layout = this.deps.createEmptyLayout();
    }

    for (const action of params.actions) {
      switch (action.type) {
        case "move":
          if (this.deps.updateElementPositions && layout) {
            layout = this.deps.updateElementPositions(layout, action.items);
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "resize":
          if (this.deps.updateElementPositions && layout) {
            layout = this.deps.updateElementPositions(layout, [action.item]);
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "moveEdge":
          if (this.deps.updateConnectionVertices && layout) {
            layout = this.deps.updateConnectionVertices(
              layout,
              action.edges.map((e) => ({ id: `${e.source}→${e.target}`, vertices: e.points })),
            );
          }
          if (needsRender === "none") needsRender = "none";
          break;
        case "connect": {
          const insertFn = this.deps.computeConnectionInsert ?? computeOWL2ConnectionInsert;
          const edgeType = (action as { edgeType?: string }).edgeType ?? "subClassOf";
          allEdits.push(...insertFn(docText, action.source, action.target, edgeType));
          if (action.points && action.points.length > 0 && this.deps.updateConnectionVertices && layout) {
            layout = this.deps.updateConnectionVertices(layout, [
              { id: `${action.source}→${action.target}`, vertices: action.points },
            ]);
          }
          needsRender = "immediate";
          break;
        }
        case "disconnect": {
          const delFn = this.deps.computeConnectionDelete ?? computeOWL2ConnectionDelete;
          allEdits.push(...delFn(docText, action.source, action.target));
          needsRender = "immediate";
          break;
        }
        case "reconnect": {
          const delFn = this.deps.computeConnectionDelete ?? computeOWL2ConnectionDelete;
          const insertFn = this.deps.computeConnectionInsert ?? computeOWL2ConnectionInsert;
          allEdits.push(...delFn(docText, action.oldSource, action.oldTarget));
          allEdits.push(...insertFn(docText, action.newSource, action.newTarget));
          needsRender = "immediate";
          break;
        }
        case "deleteComponents": {
          const delFn = this.deps.computeElementDelete ?? computeOWL2ElementDelete;
          allEdits.push(...delFn(docText, action.names));
          if (this.deps.removeElements && layout) {
            layout = this.deps.removeElements(layout, action.names);
          }
          needsRender = "immediate";
          break;
        }
        case "updateName": {
          const nameFn = this.deps.computeNameEdit ?? computeOWL2NameEdit;
          allEdits.push(...nameFn(docText, action.oldName, action.newName));
          needsRender = "debounced";
          break;
        }
        case "addComponent": {
          const insertFn = this.deps.computeElementInsert ?? computeOWL2ElementInsert;
          const elementType = action.className || "Class";
          const uniqueName =
            (action as { name?: string }).name || (action.className ? `${action.className}_1` : "Entity_1");
          allEdits.push(...insertFn(docText, elementType, uniqueName));
          if (this.deps.updateElementPositions && layout) {
            layout = this.deps.updateElementPositions(layout, [
              { name: uniqueName, x: action.x, y: action.y, width: 140, height: 50 },
            ]);
          }
          needsRender = "immediate";
          break;
        }
      }
    }

    if (layout && this.deps.setLayout) {
      this.deps.setLayout(params.uri, layout);
    }

    let sidecarUri: string | undefined;
    let sidecarContent: string | undefined;
    if (layout) {
      const serialize = this.deps.serializeLayout ?? ((l: TLayout) => JSON.stringify(l, null, 2) + "\n");
      try {
        sidecarContent = serialize(layout);
        sidecarUri = this.deps.getSidecarUri ? this.deps.getSidecarUri(params.uri) : `${params.uri}.layout`;
      } catch {
        // ignore
      }
    }

    return {
      seq: params.seq,
      edits: deduplicateAndSort(allEdits),
      renderHint: needsRender,
      sidecarUri,
      sidecarContent,
    };
  }

  getPalette(_params: DiagramGetPaletteParams): DiagramPalette | null {
    return {
      categories: [
        {
          name: "Classes & Concepts",
          items: [
            { label: "Class", className: "Class" },
            { label: "Defined Class", className: "DefinedClass" },
            { label: "Individual", className: "Individual" },
          ],
        },
        {
          name: "Properties",
          items: [
            { label: "Object Property", className: "ObjectProperty" },
            { label: "Data Property", className: "DataProperty" },
          ],
        },
      ],
    };
  }

  drillDown(_params: DiagramDrillDownParams): DiagramDrillDownResult | null {
    return null;
  }
}
