// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — 2D OMG UML 2.5 / SysML 1.6 Diagram Engine & SVG Renderer.
 *
 * Builds interactive diagram graphs and headless SVGs for:
 * - BDD (Block Definition Diagram): «block» compartments (parts, references, values, constraints, operations, ports)
 * - IBD (Internal Block Diagram): nested part boxes, conjugated boundary ports (~), connectors & item flows
 * - REQ (Requirements Diagram): «requirement» nodes (id, text) with «satisfy», «verify», «deriveReqt», «refine», «trace»
 * - PAR (Parametric Diagram): «constraintProperty» rounded boxes, parameters, value properties & «binding» connectors
 * - STM (State Machine Diagram): states, pseudostates, transitions with trigger [guard] / effect
 *
 * Preserves MagicDraw `mdOwnedViews` coordinates when present, falling back to automatic layout.
 */

import type { DiagramConfig } from "@modelscript/dsl";
import { loadDiagramView, parseMagicDraw } from "./parser/index.js";
import type {
  DiagramViewBounds,
  DiagramViewStyle,
  MagicDrawDiagramKind,
  MagicDrawDocument,
  SourceSpan,
  UmlClassifier,
  UmlRelationshipKind,
} from "./types.js";

export interface MagicDrawDiagramCompartment {
  title: string;
  entries: string[];
}

export interface MagicDrawDiagramPort {
  id: string;
  name: string;
  isConjugated: boolean;
  typeName?: string | undefined;
  side: "left" | "right" | "top" | "bottom";
}

export interface MagicDrawDiagramNode {
  id: string;
  label: string;
  stereotype: string;
  kind: string;
  compartments: MagicDrawDiagramCompartment[];
  ports: MagicDrawDiagramPort[];
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string | undefined;
  strokeColor?: string | undefined;
  parentId?: string | undefined;
  span?: SourceSpan | undefined;
}

export interface MagicDrawDiagramEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: UmlRelationshipKind | "connector" | "binding" | "transition" | "flow" | "message";
  label: string;
  dashed: boolean;
  points?: Array<{ x: number; y: number }> | undefined;
}

export interface MagicDrawDiagramModel {
  id: string;
  title: string;
  diagramKind: MagicDrawDiagramKind;
  nodes: MagicDrawDiagramNode[];
  edges: MagicDrawDiagramEdge[];
  frameBounds?: DiagramViewBounds | undefined;
  width: number;
  height: number;
}

export const magicDrawDiagramConfig: DiagramConfig = {
  nodes: {
    packagedElement: {
      role: "node",
      shape: "rect",
      label: "name",
      stereotype: "«block»",
    },
  },
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildClassifierCompartments(cls: UmlClassifier): MagicDrawDiagramCompartment[] {
  const compartments: MagicDrawDiagramCompartment[] = [];

  if (cls.kind === "Requirement") {
    const entries: string[] = [];
    if (cls.requirementId) entries.push(`id = "${cls.requirementId}"`);
    if (cls.requirementText) entries.push(`text = "${cls.requirementText}"`);
    if (entries.length > 0) compartments.push({ title: "requirement", entries });
    return compartments;
  }

  const parts = cls.properties
    .filter((p) => p.compartment === "parts")
    .map((p) => `${p.name} : ${p.typeRef?.resolvedName ?? "Any"}`);
  const refs = cls.properties
    .filter((p) => p.compartment === "references")
    .map((p) => `${p.name} : ${p.typeRef?.resolvedName ?? "Any"}`);
  const values = cls.properties
    .filter((p) => p.compartment === "values" || p.compartment === "attributes")
    .map((p) => {
      const t = p.typeRef?.resolvedName ?? "Real";
      const u = p.typeRef?.unit ? ` [${p.typeRef.unit}]` : "";
      const def = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : "";
      return `${p.name} : ${t}${u}${def}`;
    });
  const flowProps = cls.properties
    .filter((p) => p.compartment === "flowProperties")
    .map((p) => `${p.direction ?? "inout"} ${p.name} : ${p.typeRef?.resolvedName ?? "Real"}`);
  const constraintEntries = [
    ...cls.properties
      .filter((p) => p.compartment === "constraints")
      .map((p) => `${p.name} : ${p.typeRef?.resolvedName ?? "Constraint"}`),
    ...cls.constraints.map((c) => `{${c.body || c.name}}`),
  ];
  const ops = cls.operations.map((o) => {
    const params = o.parameters
      .filter((p) => p.direction !== "return")
      .map((p) => `${p.name}: ${p.typeRef?.resolvedName ?? "Any"}`)
      .join(", ");
    const ret = o.parameters.find((p) => p.direction === "return");
    return `${o.name}(${params})${ret ? `: ${ret.typeRef?.resolvedName ?? "Any"}` : ""}`;
  });

  if (parts.length > 0) compartments.push({ title: "parts", entries: parts });
  if (refs.length > 0) compartments.push({ title: "references", entries: refs });
  if (values.length > 0) compartments.push({ title: "values", entries: values });
  if (flowProps.length > 0) compartments.push({ title: "flow properties", entries: flowProps });
  if (constraintEntries.length > 0) compartments.push({ title: "constraints", entries: constraintEntries });
  if (ops.length > 0) compartments.push({ title: "operations", entries: ops });
  if (cls.literals.length > 0) compartments.push({ title: "literals", entries: cls.literals });

  // Generic custom stereotype tags
  const customTags: string[] = [];
  for (const s of cls.stereotypes) {
    if (["Block", "Requirement", "ValueType", "InterfaceBlock", "ConstraintBlock"].includes(s.name)) continue;
    for (const [k, v] of Object.entries(s.tags)) {
      customTags.push(`${s.name}.${k} = ${v}`);
    }
  }
  if (customTags.length > 0) compartments.push({ title: "tags", entries: customTags });

  return compartments;
}

function estimateNodeSize(
  label: string,
  compartments: MagicDrawDiagramCompartment[],
): { width: number; height: number } {
  let maxChars = Math.max(label.length + 4, 18);
  let lines = 2; // stereotype + title
  for (const c of compartments) {
    lines += 1 + c.entries.length;
    for (const e of c.entries) {
      maxChars = Math.max(maxChars, Math.min(e.length + 2, 48));
    }
  }
  return {
    width: Math.max(180, Math.min(340, maxChars * 7 + 24)),
    height: Math.max(64, lines * 18 + 20),
  };
}

function stereotypeBadge(cls: UmlClassifier): string {
  if (cls.stereotypes.length > 0) {
    return cls.stereotypes.map((s) => `«${s.name.charAt(0).toLowerCase()}${s.name.slice(1)}»`).join(" ");
  }
  switch (cls.kind) {
    case "Block":
      return "«block»";
    case "InterfaceBlock":
      return "«interfaceBlock»";
    case "ValueType":
      return "«valueType»";
    case "ConstraintBlock":
      return "«constraintBlock»";
    case "Requirement":
      return "«requirement»";
    case "Enumeration":
      return "«enumeration»";
    default:
      return `«${cls.kind.toLowerCase()}»`;
  }
}

export interface BuildMagicDrawDiagramOptions {
  diagramId?: string | undefined;
  diagramKind?: MagicDrawDiagramKind | undefined;
  focusClassifierId?: string | undefined;
}

/**
 * Builds a structured 2D diagram model (BDD, IBD, REQ, PAR, or STM) from a parsed `MagicDrawDocument`.
 */
export function buildMagicDrawDiagram(
  docOrText: MagicDrawDocument | string,
  options?: BuildMagicDrawDiagramOptions,
): MagicDrawDiagramModel {
  const doc = typeof docOrText === "string" ? parseMagicDraw(docOrText) : docOrText;

  const selectedMeta = options?.diagramId
    ? doc.diagrams.find((d) => d.id === options.diagramId)
    : options?.diagramKind
      ? doc.diagrams.find((d) => d.kind === options.diagramKind)
      : doc.diagrams[0];

  if (selectedMeta) {
    loadDiagramView(doc, selectedMeta.id);
  }

  const diagramKind: MagicDrawDiagramKind =
    options?.diagramKind ??
    selectedMeta?.kind ??
    (doc.stateMachines.size > 0 && doc.classifiers.size === 0
      ? "STM"
      : Array.from(doc.classifiers.values()).every((c) => c.kind === "Requirement") && doc.classifiers.size > 0
        ? "REQ"
        : "BDD");

  const boundsById = new Map<string, DiagramViewBounds>();
  if (selectedMeta) {
    for (const b of selectedMeta.viewBounds) {
      boundsById.set(b.elementId, b);
    }
  }

  const edgePointsById = new Map<string, Array<{ x: number; y: number }>>();
  if (selectedMeta?.edgePoints) {
    for (const ep of selectedMeta.edgePoints) {
      edgePointsById.set(ep.elementId, ep.points);
    }
  }

  const stylesById = new Map<string, DiagramViewStyle>();
  if (selectedMeta?.viewStyles) {
    for (const st of selectedMeta.viewStyles) {
      stylesById.set(st.elementId, st);
    }
  }

  const nodes: MagicDrawDiagramNode[] = [];
  const edges: MagicDrawDiagramEdge[] = [];
  const title = selectedMeta?.name ?? `${doc.metadata.projectName ?? "MagicDraw"} (${diagramKind})`;
  const diagId = selectedMeta?.id ?? `auto_${diagramKind.toLowerCase()}`;

  // --- ACT (Activity Diagram) ---
  if (diagramKind === "ACT") {
    const act = Array.from(doc.activities.values())[0];
    if (act) {
      let col = 0;
      for (const n of act.nodes) {
        const saved = boundsById.get(n.id);
        const size =
          n.kind === "initial" || n.kind === "final" || n.kind === "decision"
            ? { width: 36, height: 36 }
            : estimateNodeSize(n.name, []);
        nodes.push({
          id: n.id,
          label: n.name,
          stereotype: `«${n.kind}»`,
          kind: n.kind,
          compartments: [],
          ports: [],
          x: saved?.x ?? 50 + (col % 4) * 230,
          y: saved?.y ?? 70 + Math.floor(col / 4) * 140,
          width: saved?.width ?? size.width,
          height: saved?.height ?? size.height,
          span: n.span,
        });
        col++;
      }
      for (const e of act.edges) {
        edges.push({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          kind: "flow",
          label: e.guard ? `[${e.guard}]` : (e.name ?? ""),
          dashed: Boolean(e.isObjectFlow),
          points: edgePointsById.get(e.id),
        });
      }
    }
  } else if (diagramKind === "SEQ") {
    // --- SEQ (Sequence Diagram) ---
    const inter = Array.from(doc.interactions.values())[0];
    if (inter) {
      let col = 0;
      for (const ll of inter.lifelines) {
        const saved = boundsById.get(ll.id);
        nodes.push({
          id: ll.id,
          label: ll.name,
          stereotype: "«lifeline»",
          kind: "lifeline",
          compartments: [],
          ports: [],
          x: saved?.x ?? 60 + col * 240,
          y: saved?.y ?? 50,
          width: saved?.width ?? 160,
          height: saved?.height ?? 54,
          span: ll.span,
        });
        col++;
      }
      const nodeByIdLocal = new Map(nodes.map((n) => [n.id, n]));
      let msgIdx = 0;
      for (const msg of inter.messages) {
        const src = nodeByIdLocal.get(msg.sourceLifelineId);
        const dst = nodeByIdLocal.get(msg.targetLifelineId);
        const msgY = 140 + msgIdx * 52;
        const pts =
          edgePointsById.get(msg.id) ??
          (src && dst
            ? [
                { x: src.x + src.width / 2, y: msgY },
                { x: dst.x + dst.width / 2, y: msgY },
              ]
            : undefined);
        edges.push({
          id: msg.id,
          sourceId: msg.sourceLifelineId,
          targetId: msg.targetLifelineId,
          kind: "message",
          label: msg.name,
          dashed: msg.messageSort === "reply",
          points: pts,
        });
        msgIdx++;
      }
    }
  } else if (diagramKind === "STM") {
    const sm = Array.from(doc.stateMachines.values())[0];
    if (sm) {
      let col = 0;
      for (const st of sm.states) {
        const saved = boundsById.get(st.id);
        const actions: string[] = [];
        if (st.entryAction) actions.push(`entry / ${st.entryAction}`);
        if (st.doAction) actions.push(`do / ${st.doAction}`);
        if (st.exitAction) actions.push(`exit / ${st.exitAction}`);
        const comps = actions.length > 0 ? [{ title: "behaviors", entries: actions }] : [];
        const size =
          st.kind === "initial" || st.kind === "final" ? { width: 32, height: 32 } : estimateNodeSize(st.name, comps);
        nodes.push({
          id: st.id,
          label: st.name,
          stereotype: st.kind === "state" ? "«state»" : `«${st.kind}»`,
          kind: st.kind,
          compartments: comps,
          ports: [],
          x: saved?.x ?? 60 + col * 240,
          y: saved?.y ?? 80,
          width: saved?.width ?? size.width,
          height: saved?.height ?? size.height,
          span: st.span,
        });
        col++;
      }
      for (const tr of sm.transitions) {
        const parts: string[] = [];
        if (tr.trigger) parts.push(tr.trigger);
        if (tr.guard) parts.push(`[${tr.guard}]`);
        if (tr.effect) parts.push(`/ ${tr.effect}`);
        edges.push({
          id: tr.id,
          sourceId: tr.sourceId,
          targetId: tr.targetId,
          kind: "transition",
          label: parts.join(" ") || tr.name || "",
          dashed: false,
        });
      }
    }
  } else if (diagramKind === "IBD" || diagramKind === "PAR") {
    // --- IBD / PAR (Internal Block or Parametric Diagram) ---
    const contextCls =
      (options?.focusClassifierId ? doc.classifiers.get(options.focusClassifierId) : undefined) ??
      (selectedMeta ? doc.classifiers.get(selectedMeta.ownerId) : undefined) ??
      Array.from(doc.classifiers.values()).find((c) => c.connectors.length > 0) ??
      Array.from(doc.classifiers.values()).find((c) => c.kind === "Block");

    if (contextCls) {
      const targetProps =
        diagramKind === "PAR"
          ? contextCls.properties.filter((p) => p.compartment === "constraints" || p.compartment === "values")
          : contextCls.properties.filter((p) => p.compartment === "parts" || p.compartment === "references");

      let idx = 0;
      for (const prop of targetProps) {
        const saved = boundsById.get(prop.id);
        const typeCls = prop.typeRef?.resolvedId ? doc.classifiers.get(prop.typeRef.resolvedId) : undefined;
        const label = `${prop.name} : ${prop.typeRef?.resolvedName ?? "Any"}`;
        const comps =
          typeCls && diagramKind === "PAR" && typeCls.constraints.length > 0
            ? [{ title: "equation", entries: typeCls.constraints.map((c) => `{${c.body}}`) }]
            : [];
        const size = estimateNodeSize(label, comps);
        nodes.push({
          id: prop.id,
          label,
          stereotype: prop.compartment === "constraints" ? "«constraint»" : "«part»",
          kind: prop.compartment,
          compartments: comps,
          ports: (typeCls?.ports ?? []).map((pt, i) => ({
            id: pt.id,
            name: pt.name,
            isConjugated: pt.isConjugated,
            typeName: pt.typeRef?.resolvedName,
            side: i % 2 === 0 ? "left" : "right",
          })),
          x: saved?.x ?? 60 + (idx % 3) * 260,
          y: saved?.y ?? 80 + Math.floor(idx / 3) * 160,
          width: saved?.width ?? size.width,
          height: saved?.height ?? size.height,
          parentId: contextCls.id,
          span: prop.span,
        });
        idx++;
      }

      const nodeIds = new Set(nodes.map((n) => n.id));
      for (const conn of contextCls.connectors) {
        if (conn.ends.length >= 2) {
          const src = conn.ends[0]?.partWithPortId ?? conn.ends[0]?.roleId ?? "";
          const dst = conn.ends[1]?.partWithPortId ?? conn.ends[1]?.roleId ?? "";
          if (nodeIds.has(src) && nodeIds.has(dst)) {
            edges.push({
              id: conn.id,
              sourceId: src,
              targetId: dst,
              kind: conn.kind === "binding" ? "binding" : "connector",
              label: conn.itemFlowLabel ?? conn.name ?? (conn.kind === "binding" ? "«equal»" : ""),
              dashed: false,
            });
          }
        }
      }
    }
  } else {
    // --- BDD / REQ / PKG ---
    const scopedIds = selectedMeta && selectedMeta.elementIds.length > 0 ? new Set(selectedMeta.elementIds) : null;

    const filterFn = (c: UmlClassifier): boolean => {
      if (scopedIds) return scopedIds.has(c.id);
      if (diagramKind === "REQ")
        return (
          c.kind === "Requirement" ||
          doc.relationships.some((r) => (r.kind === "satisfy" || r.kind === "verify") && r.sourceId === c.id)
        );
      if (diagramKind === "BDD") return c.kind !== "Requirement";
      return true;
    };

    const classifiers = Array.from(doc.classifiers.values()).filter(filterFn);
    let idx = 0;
    for (const cls of classifiers) {
      const saved = boundsById.get(cls.id);
      const style = stylesById.get(cls.id);
      const suppressed = new Set(style?.suppressedCompartments ?? []);
      const compartments = buildClassifierCompartments(cls).filter((c) => !suppressed.has(c.title));
      const size = estimateNodeSize(cls.name, compartments);
      nodes.push({
        id: cls.id,
        label: cls.name,
        stereotype: stereotypeBadge(cls),
        kind: cls.kind,
        compartments,
        ports: suppressed.has("ports")
          ? []
          : cls.ports.map((pt, i) => ({
              id: pt.id,
              name: pt.name,
              isConjugated: pt.isConjugated,
              typeName: pt.typeRef?.resolvedName,
              side: i % 2 === 0 ? "left" : "right",
            })),
        x: saved?.x ?? 40 + (idx % 3) * 300,
        y: saved?.y ?? 40 + Math.floor(idx / 3) * 220,
        width: saved?.width ?? size.width,
        height: saved?.height ?? size.height,
        fillColor: style?.fillColor,
        strokeColor: style?.strokeColor,
        span: cls.span,
      });
      idx++;
    }

    // Also render non-classifier elements (Packages, Activities, StateMachines, Interactions)
    // when referenced on a scoped Cameo BDD/PKG diagram (e.g., "System Activities" BDD or PKG diagrams)
    if (scopedIds || diagramKind === "PKG") {
      const alreadyAdded = new Set(nodes.map((n) => n.id));
      const addGenericNode = (id: string, label: string, stereotype: string, kind: string, span?: SourceSpan) => {
        if (alreadyAdded.has(id)) return;
        alreadyAdded.add(id);
        const saved = boundsById.get(id);
        const style = stylesById.get(id);
        const size = estimateNodeSize(label, []);
        nodes.push({
          id,
          label,
          stereotype,
          kind,
          compartments: [],
          ports: [],
          x: saved?.x ?? 40 + (idx % 3) * 300,
          y: saved?.y ?? 40 + Math.floor(idx / 3) * 160,
          width: saved?.width ?? size.width,
          height: saved?.height ?? size.height,
          fillColor: style?.fillColor,
          strokeColor: style?.strokeColor,
          span,
        });
        idx++;
      };

      for (const pkg of doc.packages.values()) {
        if ((scopedIds && scopedIds.has(pkg.id)) || (!scopedIds && diagramKind === "PKG")) {
          addGenericNode(pkg.id, pkg.name, "«package»", "Package", pkg.span);
        }
      }
      if (scopedIds) {
        for (const act of doc.activities.values()) {
          if (scopedIds.has(act.id)) addGenericNode(act.id, act.name, "«activity»", "Activity", act.span);
        }
        for (const sm of doc.stateMachines.values()) {
          if (scopedIds.has(sm.id)) addGenericNode(sm.id, sm.name, "«stateMachine»", "StateMachine", sm.span);
        }
        for (const inter of doc.interactions.values()) {
          if (scopedIds.has(inter.id)) addGenericNode(inter.id, inter.name, "«interaction»", "Interaction", inter.span);
        }
      }
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const rel of doc.relationships) {
      if (nodeIds.has(rel.sourceId) && nodeIds.has(rel.targetId)) {
        const dashed =
          rel.kind === "satisfy" ||
          rel.kind === "verify" ||
          rel.kind === "deriveReqt" ||
          rel.kind === "refine" ||
          rel.kind === "trace" ||
          rel.kind === "allocate" ||
          rel.kind === "dependency";
        edges.push({
          id: rel.id,
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          kind: rel.kind,
          label: dashed ? `«${rel.kind}»` : (rel.name ?? ""),
          dashed,
          points: edgePointsById.get(rel.id),
        });
      }
    }
  }

  let maxX = 640;
  let maxY = 400;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + 60);
    maxY = Math.max(maxY, n.y + n.height + 60);
  }
  for (const e of edges) {
    for (const p of e.points ?? []) {
      maxX = Math.max(maxX, p.x + 60);
      maxY = Math.max(maxY, p.y + 60);
    }
  }
  if (selectedMeta?.frameBounds) {
    maxX = Math.max(maxX, selectedMeta.frameBounds.x + selectedMeta.frameBounds.width + 40);
    maxY = Math.max(maxY, selectedMeta.frameBounds.y + selectedMeta.frameBounds.height + 40);
  }

  return {
    id: diagId,
    title,
    diagramKind,
    nodes,
    edges,
    frameBounds: selectedMeta?.frameBounds,
    width: maxX,
    height: maxY,
  };
}

/**
 * Renders a MagicDraw SysML 1.x / UML 2.5 diagram to a standalone headless SVG string.
 */
export function renderMagicDrawDiagramSvg(
  docOrText: MagicDrawDocument | string,
  options?: BuildMagicDrawDiagramOptions,
): string {
  const model = buildMagicDrawDiagram(docOrText, options);
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" viewBox="0 0 ${model.width} ${model.height}" data-magicdraw-diagram="${escapeXml(model.diagramKind)}">`,
    `<defs>`,
    `<marker id="md-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker>`,
    `<marker id="md-gen" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 12 6 L 0 12 z" fill="#ffffff" stroke="#334155" stroke-width="1.5"/></marker>`,
    `</defs>`,
    `<rect x="0" y="0" width="${model.width}" height="${model.height}" fill="#f8fafc"/>`,
    `<text x="16" y="24" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#0f172a">${escapeXml(model.title)}</text>`,
  ];

  // Sequence diagram vertical dashed lifelines
  if (model.diagramKind === "SEQ") {
    for (const node of model.nodes) {
      if (node.kind === "lifeline") {
        const cx = node.x + node.width / 2;
        parts.push(
          `<line x1="${cx}" y1="${node.y + node.height}" x2="${cx}" y2="${model.height - 24}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6,6"/>`,
        );
      }
    }
  }

  // Edges (supporting mdOwnedViews bendpoints via <polyline>)
  for (const edge of model.edges) {
    const src = nodeById.get(edge.sourceId);
    const dst = nodeById.get(edge.targetId);
    const dash = edge.dashed ? ' stroke-dasharray="6,4"' : "";
    const marker = edge.kind === "generalization" ? ' marker-end="url(#md-gen)"' : ' marker-end="url(#md-arrow)"';

    if (edge.points && edge.points.length >= 2) {
      const ptsAttr = edge.points.map((p) => `${p.x},${p.y}`).join(" ");
      parts.push(`<polyline points="${ptsAttr}" fill="none" stroke="#475569" stroke-width="1.5"${dash}${marker}/>`);
      if (edge.label) {
        const mid = edge.points[Math.floor(edge.points.length / 2)]!;
        const prev = edge.points[Math.max(0, Math.floor(edge.points.length / 2) - 1)]!;
        const mx = (mid.x + prev.x) / 2;
        const my = (mid.y + prev.y) / 2 - 6;
        parts.push(
          `<text x="${mx}" y="${my}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#334155">${escapeXml(edge.label)}</text>`,
        );
      }
      continue;
    }

    if (!src || !dst) continue;
    const x1 = src.x + src.width / 2;
    const y1 = src.y + src.height / 2;
    const x2 = dst.x + dst.width / 2;
    const y2 = dst.y + dst.height / 2;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#475569" stroke-width="1.5"${dash}${marker}/>`,
    );
    if (edge.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - 6;
      parts.push(
        `<text x="${mx}" y="${my}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#334155">${escapeXml(edge.label)}</text>`,
      );
    }
  }

  if (model.frameBounds) {
    const fb = model.frameBounds;
    parts.push(
      `<rect x="${fb.x}" y="${fb.y}" width="${fb.width}" height="${fb.height}" fill="none" stroke="#94a3b8" stroke-width="1.2"/>`,
    );
  }

  // Nodes
  for (const node of model.nodes) {
    const isReq = node.kind === "Requirement";
    const isConstraint = node.kind === "ConstraintBlock" || node.kind === "constraints";
    const rx = isConstraint || node.kind === "state" || node.kind === "Activity" ? 12 : 3;
    const fill = node.fillColor ?? (isReq ? "#fefce8" : isConstraint ? "#f0fdf4" : "#ffffff");
    const stroke = node.strokeColor ?? (isReq ? "#ca8a04" : isConstraint ? "#16a34a" : "#334155");

    parts.push(`<g data-xmi-id="${escapeXml(node.id)}">`);
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
    );
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${node.y + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" fill="#64748b">${escapeXml(node.stereotype)}</text>`,
    );
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${node.y + 32}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="#0f172a">${escapeXml(node.label)}</text>`,
    );

    let curY = node.y + 42;
    for (const comp of node.compartments) {
      parts.push(
        `<line x1="${node.x}" y1="${curY}" x2="${node.x + node.width}" y2="${curY}" stroke="#cbd5e1" stroke-width="1"/>`,
      );
      curY += 14;
      parts.push(
        `<text x="${node.x + node.width / 2}" y="${curY}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-style="italic" fill="#64748b">${escapeXml(comp.title)}</text>`,
      );
      for (const entry of comp.entries) {
        curY += 16;
        parts.push(
          `<text x="${node.x + 8}" y="${curY}" font-family="ui-monospace, monospace" font-size="11" fill="#1e293b">${escapeXml(entry)}</text>`,
        );
      }
      curY += 6;
    }

    // Ports on left/right boundaries
    let leftIdx = 0;
    let rightIdx = 0;
    for (const pt of node.ports) {
      const isLeft = pt.side === "left";
      const px = isLeft ? node.x - 6 : node.x + node.width - 6;
      const py = node.y + 24 + (isLeft ? leftIdx++ : rightIdx++) * 22;
      parts.push(
        `<rect x="${px}" y="${py}" width="12" height="12" fill="#e2e8f0" stroke="#334155" stroke-width="1.2"/>`,
      );
      const labelX = isLeft ? px - 4 : px + 16;
      const anchor = isLeft ? "end" : "start";
      const conj = pt.isConjugated ? "~" : "";
      parts.push(
        `<text x="${labelX}" y="${py + 10}" text-anchor="${anchor}" font-family="system-ui, sans-serif" font-size="10" fill="#334155">${escapeXml(`${pt.name}${pt.typeName ? ` : ${conj}${pt.typeName}` : ""}`)}</text>`,
      );
    }

    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
