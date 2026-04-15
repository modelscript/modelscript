/* eslint-disable @typescript-eslint/no-explicit-any */
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Language-agnostic diagram builder for polyglot languages.
// Reads SymbolIndex + GraphicsConfig and produces X6‑compatible JSON
// that the webview can feed directly to Graph.fromJSON().

import type { GraphicsConfig, X6Attrs, X6Markup, X6Ports } from "./index.js";
import type { ScopeResolver } from "./resolver.js";
import type { SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";

// ── Public Types ──

export interface PolyglotDiagramNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  zIndex: number;
  /** X6 markup — can be an array (selector-based) or a single SVG tree. */
  markup: X6Markup[] | X6Markup;
  /** X6 attrs keyed by selector. */
  attrs?: X6Attrs;
  /** Ports configuration. */
  ports?: X6Ports & { items?: any[] };
  /** Shape name for X6 (e.g. "rect"). */
  shape?: string;
  /** Parent node ID for X6 group embedding. */
  parent?: string;
  /** Child node IDs for X6 group embedding (bidirectional with parent). */
  children?: string[];
  /** Properties for the side panel. */
  properties?: {
    className: string;
    description: string;
    parameters: { name: string; value: string }[];
  };
  /** Whether this node should be auto-laid-out by Dagre. */
  autoLayout: boolean;
}

export interface PolyglotDiagramEdge {
  id: string;
  shape: string;
  zIndex: number;
  source: string | { cell: string; port?: string };
  target: string | { cell: string; port?: string };
  vertices?: { x: number; y: number }[];
  router?: string | { name: string; args?: Record<string, unknown> };
  connector?: string | { name: string; args?: Record<string, unknown> };
  attrs: X6Attrs;
  labels?: any[];
}

export interface PolyglotDiagramData {
  nodes: PolyglotDiagramNode[];
  edges: PolyglotDiagramEdge[];
  coordinateSystem: { x: number; y: number; width: number; height: number };
  diagramBackground: null;
}

// ── Builder ──

/**
 * Builds an X6-compatible diagram from a SymbolIndex and a GraphicsConfig lookup.
 *
 * @param index        The unified symbol index (from WorkspaceIndex.toUnified()).
 * @param gfxConfig    Maps symbol kind → GraphicsConfig (from generated graphics_config.ts).
 * @param resourceId   Optional resource URI to limit scope to symbols from one document.
 * @param resolver     Optional ScopeResolver for resolving edge source/target via the scope graph.
 */
export function buildPolyglotDiagram(
  index: SymbolIndex,
  gfxConfig: Record<string, GraphicsConfig>,
  resourceId?: string,
  resolver?: ScopeResolver,
  diagramType: "All" | "BDD" | "IBD" | "StateMachine" = "All",
): PolyglotDiagramData {
  const nodes: PolyglotDiagramNode[] = [];
  const edges: PolyglotDiagramEdge[] = [];

  // Collect all symbols, optionally filtered to one document
  const allSymbols: SymbolEntry[] = [];
  for (const sym of index.symbols.values()) {
    if (resourceId && sym.resourceId !== resourceId) continue;

    // Phase 6: Diagram Type Filtering
    if (diagramType === "BDD") {
      // In BDD, we only want structural nodes (Packages, Blocks) and extending taxonomy
      // Hide internal parts/ports from the main canvas (except as compartment text)
      if (sym.ruleName === "PartUsage" || sym.ruleName === "PortUsage") continue;
      // Hide State Machines and their innards
      if (sym.ruleName.startsWith("State") || sym.ruleName.startsWith("Transition")) continue;
    } else if (diagramType === "IBD") {
      // In IBD, we only want Parts, Ports, and their connections.
      // Hide taxonomy and packages. (Wait, Parts need a parent container).
      if (sym.ruleName === "Package" || sym.ruleName === "LibraryPackage") continue;
      if (sym.ruleName.startsWith("State") || sym.ruleName.startsWith("Transition")) continue;
    } else if (diagramType === "StateMachine") {
      // Hide generic structure
      if (
        sym.ruleName !== "StateDefinition" &&
        sym.ruleName !== "StateUsage" &&
        sym.ruleName !== "TransitionUsage" &&
        sym.ruleName !== "ActionUsage" &&
        sym.ruleName !== "Package"
      ) {
        continue;
      }
    }

    allSymbols.push(sym);
  }

  // Map from symbolId → generated node id (for edge resolution)
  const symbolIdToNodeId = new Map<SymbolId, string>();

  // ── Structural parent kinds whose children get absorbed as compartment text ──
  const STRUCTURAL_KINDS = new Set([
    "PartUsage",
    "PartDefinition",
    "ActionDefinition",
    "ActionUsage",
    "ItemDefinition",
    "ItemUsage",
    "RequirementDefinition",
    "RequirementUsage",
    "ConstraintDefinition",
    "ConstraintUsage",
    "CalculationDefinition",
    "CalculationUsage",
    "VerificationCaseDefinition",
    "VerificationCaseUsage",
    "StateDefinition",
    "StateUsage",
    "UseCaseDefinition",
    "UseCaseUsage",
    "CaseDefinition",
    "CaseUsage",
    "AnalysisCaseDefinition",
    "AnalysisCaseUsage",
    "ConcernDefinition",
    "ConcernUsage",
    "InterfaceDefinition",
    "FlowDefinition",
    "AllocationDefinition",
    "OccurrenceDefinition",
    "OccurrenceUsage",
    "ViewDefinition",
    "ViewUsage",
    "ViewpointDefinition",
    "ViewpointUsage",
    "RenderingDefinition",
    "RenderingUsage",
    "EnumerationDefinition",
  ]);

  // Pre-pass: collect ALL children of structural parents as compartment entries.
  // Every child of a structural parent is fully absorbed as text — no child gets
  // its own standalone diagram node. This produces clean BDD-style blocks.
  const compartmentsByParent = new Map<SymbolId, SymbolEntry[]>();
  const fullyAbsorbed = new Set<SymbolId>(); // symbols that should NOT get own nodes

  // Track which symbol kinds are container groups (e.g. Package, LibraryPackage)
  const groupKinds = new Set<string>();
  for (const [kind, cfg] of Object.entries(gfxConfig)) {
    if (cfg.role === "group") groupKinds.add(kind);
  }

  // Kinds that should NOT be absorbed into compartment text — they get their own
  // diagram nodes (PartUsage/PartDefinition) or become X6 ports (PortUsage).
  const STANDALONE_CHILD_KINDS = new Set(["PartUsage", "PartDefinition", "PortUsage", "PortDefinition"]);

  for (const sym of allSymbols) {
    if (sym.parentId === null) continue;
    const parentSym = index.symbols.get(sym.parentId);
    if (!parentSym) continue;

    // Only absorb children if the parent is a structural block
    if (!STRUCTURAL_KINDS.has(parentSym.ruleName)) continue;

    // Parts and Ports are NOT absorbed — they get own nodes/ports
    if (STANDALONE_CHILD_KINDS.has(sym.ruleName)) continue;

    const list = compartmentsByParent.get(sym.parentId) ?? [];
    list.push(sym);
    compartmentsByParent.set(sym.parentId, list);

    // Remaining children are fully absorbed as compartment text
    fullyAbsorbed.add(sym.id);
  }

  // First pass: create nodes for all symbols with graphics configs
  const actualNodeIds = new Set<string>(); // Keep track of rendered nodes to guard edge endpoints

  for (const sym of allSymbols) {
    const config = gfxConfig[sym.ruleName];
    if (!config) continue;
    // Use unique symbol ID as the node ID to prevent collisions.
    const nodeId = `n_${sym.id}`;
    symbolIdToNodeId.set(sym.id, nodeId);

    if (config.role === "edge" || config.role === "port-owner" || config.role === "compartment") {
      continue;
    }

    // Skip symbols that were fully absorbed into a parent's compartments
    if (fullyAbsorbed.has(sym.id)) {
      continue;
    }

    const nodeConfig = config.node;
    if (!nodeConfig) continue;

    const size = nodeConfig.size ?? { width: 220, height: 50 };

    // Stratify compartment entries by type for BDD presentation
    const compartmentEntries = compartmentsByParent.get(sym.id) ?? [];

    // Helper: filter out parser-generated placeholder names
    const isRealName = (n: string | undefined): n is string => !!n && !n.startsWith("<") && n !== "anonymous";

    // Build typed sections: [ { header, entries[] } ]
    interface Section {
      header: string;
      entries: string[];
    }
    const sections: Section[] = [];

    const attrEntries = compartmentEntries.filter(
      (e) => e.ruleName === "AttributeUsage" || e.ruleName === "AttributeDefinition",
    );
    if (attrEntries.length > 0) {
      sections.push({
        header: "attributes",
        entries: attrEntries
          .map((e) => {
            if (!isRealName(e.name)) return null;
            // Try to resolve the attribute's type via OwnedFeatureTyping children
            const typeName = resolveTypeName(e.id, index, resolver);
            return typeName ? `${e.name} : ${typeName}` : e.name;
          })
          .filter((v): v is string => v !== null),
      });
    }

    // Ports and parts are no longer absorbed — they become X6 ports and
    // standalone nodes respectively. Only show connections in compartments.
    const connEntries = compartmentEntries.filter(
      (e) => e.ruleName === "ConnectionUsage" || e.ruleName === "ConnectionDefinition",
    );
    if (connEntries.length > 0) {
      sections.push({
        header: "connections",
        entries: connEntries.map((e) => (isRealName(e.name) ? e.name : "connect ...")),
      });
    }

    const actionEntries = compartmentEntries.filter(
      (e) => e.ruleName === "ActionUsage" || e.ruleName === "ActionDefinition" || e.ruleName === "PerformActionUsage",
    );
    const filteredActionNames = actionEntries.map((e) => e.name).filter(isRealName);
    if (filteredActionNames.length > 0) {
      sections.push({
        header: "actions",
        entries: filteredActionNames,
      });
    }

    const actorEntries = compartmentEntries.filter(
      (e) => e.ruleName === "ActorUsage" || e.ruleName === "StakeholderUsage",
    );
    const filteredActorNames = actorEntries.map((e) => e.name).filter(isRealName);
    if (filteredActorNames.length > 0) {
      sections.push({
        header: "actors",
        entries: filteredActorNames.map((name) => `actor ${name}`),
      });
    }

    const subjectEntries = compartmentEntries.filter((e) => e.ruleName === "SubjectUsage");
    const filteredSubjectNames = subjectEntries.map((e) => e.name).filter(isRealName);
    if (filteredSubjectNames.length > 0) {
      sections.push({
        header: "subjects",
        entries: filteredSubjectNames.map((name) => `subject ${name}`),
      });
    }

    // Requirement entries
    const reqEntries = compartmentEntries.filter(
      (e) => e.ruleName === "RequirementUsage" || e.ruleName === "ObjectiveRequirementUsage",
    );
    const filteredReqNames = reqEntries.map((e) => e.name).filter(isRealName);
    if (filteredReqNames.length > 0) {
      sections.push({ header: "requirements", entries: filteredReqNames });
    }

    // Constraint entries
    const constraintEntries = compartmentEntries.filter(
      (e) =>
        e.ruleName === "ConstraintUsage" ||
        e.ruleName === "AssertConstraintUsage" ||
        e.ruleName === "RequirementConstraintUsage",
    );
    const filteredConstraintNames = constraintEntries.map((e) => e.name).filter(isRealName);
    if (filteredConstraintNames.length > 0) {
      sections.push({ header: "constraints", entries: filteredConstraintNames });
    }

    // State entries
    const stateEntries = compartmentEntries.filter(
      (e) => e.ruleName === "StateUsage" || e.ruleName === "ExhibitStateUsage",
    );
    const filteredStateNames = stateEntries.map((e) => e.name).filter(isRealName);
    if (filteredStateNames.length > 0) {
      sections.push({ header: "states", entries: filteredStateNames });
    }

    // Calculation entries
    const calcEntries = compartmentEntries.filter((e) => e.ruleName === "CalculationUsage");
    const filteredCalcNames = calcEntries.map((e) => e.name).filter(isRealName);
    if (filteredCalcNames.length > 0) {
      sections.push({ header: "calculations", entries: filteredCalcNames });
    }

    // Case entries (use case, analysis case, verification case)
    const caseEntries = compartmentEntries.filter(
      (e) =>
        e.ruleName === "UseCaseUsage" ||
        e.ruleName === "IncludeUseCaseUsage" ||
        e.ruleName === "AnalysisCaseUsage" ||
        e.ruleName === "VerificationCaseUsage" ||
        e.ruleName === "CaseUsage",
    );
    const filteredCaseNames = caseEntries.map((e) => e.name).filter(isRealName);
    if (filteredCaseNames.length > 0) {
      sections.push({ header: "cases", entries: filteredCaseNames });
    }

    // Item entries
    const itemEntries = compartmentEntries.filter((e) => e.ruleName === "ItemUsage");
    const filteredItemNames = itemEntries.map((e) => e.name).filter(isRealName);
    if (filteredItemNames.length > 0) {
      sections.push({ header: "items", entries: filteredItemNames });
    }

    // Enumeration entries
    const enumEntries = compartmentEntries.filter(
      (e) => e.ruleName === "EnumerationUsage" || e.ruleName === "EnumeratedValue",
    );
    const filteredEnumNames = enumEntries.map((e) => e.name).filter(isRealName);
    if (filteredEnumNames.length > 0) {
      sections.push({ header: "enumerations", entries: filteredEnumNames });
    }

    // Flow entries
    const flowEntries = compartmentEntries.filter(
      (e) => e.ruleName === "FlowUsage" || e.ruleName === "SuccessionFlowUsage",
    );
    const filteredFlowNames = flowEntries.map((e) => e.name).filter(isRealName);
    if (filteredFlowNames.length > 0) {
      sections.push({ header: "flows", entries: filteredFlowNames });
    }

    // Concern entries
    const concernEntries = compartmentEntries.filter((e) => e.ruleName === "ConcernUsage");
    const filteredConcernNames = concernEntries.map((e) => e.name).filter(isRealName);
    if (filteredConcernNames.length > 0) {
      sections.push({ header: "concerns", entries: filteredConcernNames });
    }

    // Transition entries (for state definitions)
    const transitionEntries = compartmentEntries.filter(
      (e) => e.ruleName === "TransitionUsage" || e.ruleName === "SuccessionAsUsage",
    );
    const filteredTransitionNames = transitionEntries.map((e) => e.name).filter(isRealName);
    if (filteredTransitionNames.length > 0) {
      sections.push({ header: "transitions", entries: filteredTransitionNames });
    }

    // Reference/metadata entries (generic catch-all for remaining)
    const alreadyCategorized = new Set([
      "AttributeUsage",
      "AttributeDefinition",
      "ConnectionUsage",
      "ConnectionDefinition",
      "ActionUsage",
      "ActionDefinition",
      "PerformActionUsage",
      "ActorUsage",
      "StakeholderUsage",
      "SubjectUsage",
      "RequirementUsage",
      "ObjectiveRequirementUsage",
      "ConstraintUsage",
      "AssertConstraintUsage",
      "RequirementConstraintUsage",
      "StateUsage",
      "ExhibitStateUsage",
      "CalculationUsage",
      "UseCaseUsage",
      "IncludeUseCaseUsage",
      "AnalysisCaseUsage",
      "VerificationCaseUsage",
      "CaseUsage",
      "ItemUsage",
      "EnumerationUsage",
      "EnumeratedValue",
      "FlowUsage",
      "SuccessionFlowUsage",
      "ConcernUsage",
      "TransitionUsage",
      "SuccessionAsUsage",
      // These become standalone nodes or ports
      "PartUsage",
      "PartDefinition",
      "PortUsage",
      "PortDefinition",
    ]);
    const otherEntries = compartmentEntries.filter((e) => !alreadyCategorized.has(e.ruleName) && isRealName(e.name));
    if (otherEntries.length > 0) {
      sections.push({
        header: "features",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        entries: otherEntries.map((e) => e.name!),
      });
    }

    // ── Determine if this is a structural node needing dynamic compartments ──
    const isStructural = STRUCTURAL_KINDS.has(sym.ruleName) && sections.length > 0;

    // Resolve name for templates
    const nameText = sym.name ?? "";

    // Extract colors from the rule's GraphicsConfig (falls back to neutral grey)
    const configAttrs = config.node?.attrs ?? {};
    const bodyAttrs = configAttrs["body"] as Record<string, any> | undefined;
    const headerAttrs = configAttrs["header"] as Record<string, any> | undefined;
    const strokeColor = (bodyAttrs?.["stroke"] as string) ?? "#757575";
    const fillColor = (bodyAttrs?.["fill"] as string) ?? "#f5f5f5";
    const isDef = sym.ruleName.endsWith("Definition");
    const stereoText =
      (headerAttrs?.["text"] as string) ??
      (isDef
        ? `\u00ab${sym.ruleName.replace("Definition", " def")}\u00bb`
        : `\u00ab${sym.ruleName.replace("Usage", "")}\u00bb`);
    const textColor = strokeColor;
    const headerColor = strokeColor;
    const labelColor = "#1a1a1a";

    if (isStructural) {
      // ── Dynamic markup generation for compartmented BDD blocks ──
      const HEADER_HEIGHT = 42; // stereotype + label area
      const LINE_HEIGHT = 15; // pixels per text line
      const SECTION_PAD = 2; // padding above section header

      // Build markup array and attrs dynamically
      const markup: any[] = [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "stereotype" },
        { tagName: "text", selector: "label" },
        { tagName: "line", selector: "headerSep" },
      ];

      const attrs: Record<string, any> = {
        stereotype: {
          text: stereoText,
          fill: headerColor,
          fontSize: 10,
          fontStyle: "italic",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: 6,
        },
        label: {
          text: nameText,
          fill: labelColor,
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: 22,
        },
      };

      let currentY = HEADER_HEIGHT;

      // Header separator line
      attrs.headerSep = {
        x1: 0,
        y1: currentY,
        x2: 999, // will be clamped by node width
        y2: currentY,
        stroke: strokeColor,
        strokeWidth: 1,
      };

      // Find the longest text for width calculation
      let maxTextLen = nameText.length;

      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        const sepId = `sep_${si}`;
        const headerId = `secHead_${si}`;

        // Separator line above each section (beyond the first, which uses headerSep)
        if (si > 0) {
          markup.push({ tagName: "line", selector: sepId });
          attrs[sepId] = {
            x1: 0,
            y1: currentY,
            x2: 999,
            y2: currentY,
            stroke: strokeColor,
            strokeWidth: 0.5,
          };
        }

        currentY += SECTION_PAD;

        // Section header (centered, italic)
        markup.push({ tagName: "text", selector: headerId });
        attrs[headerId] = {
          text: section.header,
          fill: textColor,
          fontSize: 11,
          fontStyle: "italic",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: currentY,
        };
        currentY += LINE_HEIGHT;
        maxTextLen = Math.max(maxTextLen, section.header.length);

        // Entries (left-aligned)
        for (let ei = 0; ei < section.entries.length; ei++) {
          const entryId = `entry_${si}_${ei}`;
          markup.push({ tagName: "text", selector: entryId });
          attrs[entryId] = {
            text: section.entries[ei],
            fill: textColor,
            fontSize: 11,
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 16,
            refY: currentY,
          };
          currentY += LINE_HEIGHT;
          maxTextLen = Math.max(maxTextLen, section.entries[ei].length + 2);
        }
      }

      currentY += 4; // bottom padding

      const adjustedWidth = Math.max(size.width, maxTextLen * 8 + 32);
      const adjustedHeight = Math.max(size.height, currentY);

      // Update separator x2 values to match the width
      attrs.headerSep.x2 = adjustedWidth;
      for (let si = 0; si < sections.length; si++) {
        const sepId = `sep_${si}`;
        if (attrs[sepId]) {
          attrs[sepId].x2 = adjustedWidth;
        }
      }

      // Body rect — use refWidth/refHeight so X6 scales to node dimensions
      attrs.body = {
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: isDef ? 2 : 1.5,
        rx: 4,
        ry: 4,
        refWidth: "100%",
        refHeight: "100%",
      };

      // Build metadata for properties panel
      const parameters: { name: string; value: string }[] = [];
      for (const [key, value] of Object.entries(sym.metadata)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          parameters.push({ name: key, value: String(value) });
        }
      }

      const node: PolyglotDiagramNode = {
        id: nodeId,
        x: 0,
        y: 0,
        width: adjustedWidth,
        height: adjustedHeight,
        angle: 0,
        opacity: 1,
        zIndex: 10,
        markup,
        attrs,
        shape: nodeConfig.shape,
        ports: {
          groups: nodeConfig.ports?.groups ?? {},
          items: [...(nodeConfig.ports?.items ?? [])],
        },
        properties: {
          className: sym.ruleName,
          description: sym.name,
          parameters,
        },
        autoLayout: true,
      };

      // Resolve parent group embedding — walk up ancestry to find nearest package
      if (sym.parentId !== null) {
        let ancestorId: SymbolId | null = sym.parentId;
        while (ancestorId !== null) {
          const ancestorSym = index.symbols.get(ancestorId);
          if (!ancestorSym) break;
          if (groupKinds.has(ancestorSym.ruleName)) {
            node.parent = symbolIdToNodeId.get(ancestorId);
            node.autoLayout = false;
            break;
          }
          ancestorId = ancestorSym.parentId;
        }
      }

      // Group nodes get low zIndex so children render on top
      if (config.role === "group") {
        node.zIndex = 1;
      }

      actualNodeIds.add(node.id);
      nodes.push(node);
      continue; // skip the normal node creation below
    }

    // ── Non-structural nodes: use the static config as-is ──
    const compartmentText = "";
    const resolvedAttrs = resolveTemplates(nodeConfig.attrs, sym, compartmentText);

    let adjustedHeight = size.height;
    const adjustedWidth = size.width;

    // Strip separator/compartment for standalone usages that have no compartment text
    // to avoid the green line extending beyond the box
    if (resolvedAttrs && !compartmentText) {
      if (resolvedAttrs.separator) {
        (resolvedAttrs.separator as any).display = "none";
      }
      if (resolvedAttrs.compartment) {
        (resolvedAttrs.compartment as any).display = "none";
      }
      // Also shrink height since there's no compartment slot
      adjustedHeight = Math.min(adjustedHeight, 50);
    }

    // Build metadata for properties panel
    const parameters: { name: string; value: string }[] = [];
    for (const [key, value] of Object.entries(sym.metadata)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        parameters.push({ name: key, value: String(value) });
      }
    }

    const node: PolyglotDiagramNode = {
      id: nodeId,
      x: 0,
      y: 0,
      width: adjustedWidth,
      height: adjustedHeight,
      angle: 0,
      opacity: 1,
      zIndex: 10,
      markup: nodeConfig.markup ?? [],
      attrs: resolvedAttrs,
      shape: nodeConfig.shape,
      ports: {
        groups: nodeConfig.ports?.groups ?? {},
        items: [...(nodeConfig.ports?.items ?? [])],
      },
      properties: {
        className: sym.ruleName,
        description: sym.name,
        parameters,
      },
      autoLayout: true,
    };

    // Resolve parent group embedding — walk up ancestry to find nearest package
    if (sym.parentId !== null) {
      let ancestorId: SymbolId | null = sym.parentId;
      while (ancestorId !== null) {
        const ancestorSym = index.symbols.get(ancestorId);
        if (!ancestorSym) break;
        if (groupKinds.has(ancestorSym.ruleName)) {
          node.parent = symbolIdToNodeId.get(ancestorId);
          node.autoLayout = false;
          break;
        }
        ancestorId = ancestorSym.parentId;
      }
    }

    // Group nodes get low zIndex so children render on top
    if (config.role === "group") {
      node.zIndex = 1;
    }

    actualNodeIds.add(node.id);
    nodes.push(node);
  }

  // Second pass: create edges
  for (const sym of allSymbols) {
    const config = gfxConfig[sym.ruleName];
    if (!config || config.role !== "edge") continue;

    const edgeConfig = config.edge;
    if (!edgeConfig) continue;

    // Resolve edge source and target via the scope graph
    const { sourceId, targetId } = resolveEdgeEndpoints(sym, index, symbolIdToNodeId, gfxConfig, resolver);
    if (!sourceId || !targetId) continue;

    const sourceNodeId = sourceId.includes(".") ? sourceId.split(".")[0] : sourceId;
    const targetNodeId = targetId.includes(".") ? targetId.split(".")[0] : targetId;

    // Prevent rendering edges connected to nodes that were filtered out or fully absorbed
    if (!actualNodeIds.has(sourceNodeId) || !actualNodeIds.has(targetNodeId)) {
      continue;
    }

    // Resolve {{name}} templates in labels
    const resolvedLabels = edgeConfig.labels?.map((label) => ({
      ...label,
      attrs: resolveTemplates(label.attrs, sym),
    }));

    // Parse port assignments from IDs (e.g. "nodeId.portName")
    let finalSource: string | { cell: string; port: string } = sourceId;
    if (sourceId.includes(".")) {
      const parts = sourceId.split(".");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const port = parts.pop()!;
      finalSource = { cell: parts.join("."), port };
    }

    let finalTarget: string | { cell: string; port: string } = targetId;
    if (targetId.includes(".")) {
      const parts = targetId.split(".");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const port = parts.pop()!;
      finalTarget = { cell: parts.join("."), port };
    }

    edges.push({
      id: `${sym.ruleName}_${sym.id}`,
      shape: edgeConfig.shape ?? "edge",
      zIndex: 1,
      source: finalSource,
      target: finalTarget,
      router: edgeConfig.router,
      connector: edgeConfig.connector,
      attrs: resolveTemplates(edgeConfig.attrs, sym) ?? {},
      labels: resolvedLabels,
    });
  }

  // ── Create composition edges for PartUsage/PartDefinition children ──
  // These are children of structural parents that were NOT absorbed;
  // they need a filled-diamond composition edge from parent to child.
  for (const sym of allSymbols) {
    if (sym.parentId === null) continue;
    if (sym.ruleName !== "PartUsage" && sym.ruleName !== "PartDefinition") continue;

    const parentSym = index.symbols.get(sym.parentId);
    if (!parentSym || !STRUCTURAL_KINDS.has(parentSym.ruleName)) continue;

    const parentNodeId = symbolIdToNodeId.get(sym.parentId);
    const childNodeId = symbolIdToNodeId.get(sym.id);
    if (!parentNodeId || !childNodeId) continue;

    edges.push({
      id: `composition_${sym.id}`,
      shape: "edge",
      zIndex: 1,
      source: parentNodeId,
      target: childNodeId,
      router: "manhattan",
      connector: "rounded",
      attrs: {
        line: {
          stroke: "#43a047",
          strokeWidth: 1.5,
          sourceMarker: {
            name: "diamond",
            width: 14,
            height: 8,
            fill: "#43a047",
          },
          targetMarker: "",
        },
      },
      labels: [],
    });
  }

  // ── Create X6 port items for PortUsage children ──
  // Ports are shown on the border of their parent node, not as compartment text.
  for (const sym of allSymbols) {
    if (sym.parentId === null) continue;
    if (sym.ruleName !== "PortUsage" && sym.ruleName !== "PortDefinition") continue;

    const parentSym = index.symbols.get(sym.parentId);
    if (!parentSym || !STRUCTURAL_KINDS.has(parentSym.ruleName)) continue;

    const parentNodeId = symbolIdToNodeId.get(sym.parentId);
    if (!parentNodeId) continue;

    const parentNode = nodes.find((n) => n.id === parentNodeId);
    if (!parentNode) continue;

    // Ensure port groups exist
    if (!parentNode.ports) {
      parentNode.ports = { groups: {}, items: [] };
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const groups = parentNode.ports.groups!;
    if (!groups.in) {
      groups.in = {
        position: "left",
        attrs: {
          circle: { r: 6, fill: "#ef6c00", stroke: "#fff", strokeWidth: 1.5 },
          text: { fontSize: 9, fill: "#333" },
        },
        label: {
          position: { name: "outside" },
        },
      };
    }
    if (!groups.out) {
      groups.out = {
        position: "right",
        attrs: {
          circle: { r: 6, fill: "#ef6c00", stroke: "#fff", strokeWidth: 1.5 },
          text: { fontSize: 9, fill: "#333" },
        },
        label: {
          position: { name: "outside" },
        },
      };
    }

    const portName = sym.name ?? `port_${sym.id}`;
    // Alternate sides: odd index → 'in' (left), even index → 'out' (right)
    const portItems = parentNode.ports.items ?? [];
    const group = portItems.length % 2 === 0 ? "out" : "in";

    portItems.push({
      id: portName,
      group,
      attrs: {
        text: { text: portName },
      },
    });
    parentNode.ports.items = portItems;

    // Also register in the symbol→node mapping for edge resolution
    symbolIdToNodeId.set(sym.id, `${parentNodeId}.${portName}`);
  }

  // ── Create "typed-by" edges from Usages to their Definitions ──
  // In SysML2, `part engine : Engine` means PartUsage "engine" is typed by
  // PartDefinition "Engine". We scan ALL index entries for ref entries
  // parented to each usage (OwnedFeatureTyping isn't in the indexer config,
  // so it can't be found via childrenOf — we must scan symbols directly,
  // mirroring ScopeResolver.findRefChildren).
  const USAGE_KINDS = new Set([
    "PartUsage",
    "ItemUsage",
    "PortUsage",
    "ActionUsage",
    "StateUsage",
    "ConstraintUsage",
    "RequirementUsage",
    "CalculationUsage",
    "AttributeUsage",
    "ConnectionUsage",
    "OccurrenceUsage",
    "ReferenceUsage",
  ]);
  const addedTypingEdges = new Set<string>();

  if (resolver) {
    // Build a parentId → ref-entry children map by scanning ALL symbols
    const refChildrenByParent = new Map<SymbolId, SymbolEntry[]>();
    for (const entry of index.symbols.values()) {
      if (entry.parentId === null) continue;
      if (resolver.isDeclaration(entry)) continue; // skip declarations
      const list = refChildrenByParent.get(entry.parentId) ?? [];
      list.push(entry);
      refChildrenByParent.set(entry.parentId, list);
    }

    for (const sym of allSymbols) {
      if (!USAGE_KINDS.has(sym.ruleName)) continue;

      const usageNodeId = symbolIdToNodeId.get(sym.id);
      if (!usageNodeId) continue;

      // Find ref-entry children of this usage (e.g., OwnedFeatureTyping)
      const refChildren = refChildrenByParent.get(sym.id) ?? [];
      for (const refEntry of refChildren) {
        const resolved = resolver.resolve(refEntry);
        for (const target of resolved) {
          const defNodeId = symbolIdToNodeId.get(target.id);
          if (!defNodeId || defNodeId === usageNodeId) continue;

          // Skip if the target is a sibling usage (not a definition)
          if (USAGE_KINDS.has(target.ruleName)) continue;

          const edgeKey = `${usageNodeId}->${defNodeId}`;
          if (addedTypingEdges.has(edgeKey)) continue;
          addedTypingEdges.add(edgeKey);

          edges.push({
            id: `typing_${sym.id}_${target.id}`,
            shape: "edge",
            zIndex: 1,
            source: usageNodeId,
            target: defNodeId,
            router: "manhattan",
            connector: "rounded",
            attrs: {
              line: {
                stroke: "#546e7a",
                strokeWidth: 1.5,
                strokeDasharray: "8 4",
                targetMarker: {
                  name: "block",
                  width: 12,
                  height: 8,
                },
              },
            },
            labels: [],
          });

          // Also update the usage node's label to show "name : TypeName"
          const usageNode = nodes.find((n) => n.id === usageNodeId);
          if (usageNode && target.name && sym.name) {
            const typedLabel = `${sym.name} : ${target.name}`;
            if (usageNode.attrs) {
              if (usageNode.attrs.label) {
                (usageNode.attrs.label as any).text = typedLabel;
              }
            }
          }
        }
      }
    }
  }

  // Compute a bounding coordinate system from node count
  const gridSize = Math.ceil(Math.sqrt(nodes.length));
  const csWidth = Math.max(gridSize * 250, 500);
  const csHeight = Math.max(gridSize * 150, 400);

  // ── Post-process: populate `children` arrays on parent nodes ──
  // X6 requires BOTH parent (on child) and children (on parent) for
  // getChildren() to work. Without this, child stacking in diagram.ts is a no-op.
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parent) {
      const list = childrenMap.get(node.parent) ?? [];
      list.push(node.id);
      childrenMap.set(node.parent, list);
    }
  }
  for (const node of nodes) {
    const kids = childrenMap.get(node.id);
    if (kids && kids.length > 0) {
      node.children = kids;
    }
  }

  return {
    nodes,
    edges,
    coordinateSystem: {
      x: -csWidth / 2,
      y: -csHeight / 2,
      width: csWidth,
      height: csHeight,
    },
    diagramBackground: null,
  };
}

// ── Edge Endpoint Resolution ──

/**
 * Resolves the source and target node IDs for an edge symbol.
 *
 * Strategy (in priority order):
 * 1. **Scope graph** (preferred): Walk all descendants of the edge symbol,
 *    find ref-entry children, resolve each via the ScopeResolver to its
 *    target declaration, and map that declaration's ID to a diagram node ID.
 * 2. **Child heuristic**: Use the first two children that map to known nodes.
 * 3. **Sibling heuristic**: Use sibling nodes of the edge's parent scope.
 */
function resolveEdgeEndpoints(
  edgeSym: SymbolEntry,
  index: SymbolIndex,
  symbolIdToNodeId: Map<SymbolId, string>,
  gfxConfig: Record<string, GraphicsConfig>,
  resolver?: ScopeResolver,
): { sourceId: string | undefined; targetId: string | undefined } {
  let sourceId: string | undefined;
  let targetId: string | undefined;

  // Strategy 1: Scope graph resolution
  if (resolver) {
    const refDescendants = collectRefDescendants(edgeSym.id, index, resolver);
    for (const refEntry of refDescendants) {
      const resolved = resolver.resolve(refEntry);
      for (const target of resolved) {
        const nodeId = symbolIdToNodeId.get(target.id);
        if (!nodeId) continue;
        if (!sourceId) {
          sourceId = nodeId;
        } else if (!targetId && nodeId !== sourceId) {
          targetId = nodeId;
        }
      }
      if (sourceId && targetId) break;
    }
  }

  // Strategy 2: Child heuristic (fallback)
  if (!sourceId || !targetId) {
    const children = index.childrenOf.get(edgeSym.id) ?? [];
    for (const childId of children) {
      const childSym = index.symbols.get(childId);
      if (!childSym) continue;
      const childNodeId = symbolIdToNodeId.get(childSym.id) ?? childSym.name;
      if (!sourceId) {
        sourceId = childNodeId;
      } else if (!targetId) {
        targetId = childNodeId;
      }
    }
  }

  // Strategy 3: Sibling heuristic (last resort)
  if (!sourceId || !targetId) {
    if (edgeSym.parentId !== null) {
      const siblings = index.childrenOf.get(edgeSym.parentId) ?? [];
      const nodeKindSiblings = siblings
        .map((id) => index.symbols.get(id))
        .filter((s): s is SymbolEntry => s !== undefined && gfxConfig[s.ruleName]?.role === "node")
        .map((s) => symbolIdToNodeId.get(s.id) ?? s.name);

      if (nodeKindSiblings.length >= 2) {
        sourceId = sourceId ?? nodeKindSiblings[0];
        targetId = targetId ?? nodeKindSiblings[1];
      }
    }
  }

  return { sourceId, targetId };
}

/**
 * Recursively collects all ref-entry descendants of a symbol.
 * These are the reference nodes (e.g. ConnectorEnd → OwnedReferenceSubsetting)
 * that can be resolved to their target declarations via the scope graph.
 */
function collectRefDescendants(parentId: SymbolId, index: SymbolIndex, resolver: ScopeResolver): SymbolEntry[] {
  const results: SymbolEntry[] = [];
  const childIds = index.childrenOf.get(parentId) ?? [];
  for (const childId of childIds) {
    const child = index.symbols.get(childId);
    if (!child) continue;
    // Check if this child is a reference entry (not a declaration)
    if (!resolver.isDeclaration(child)) {
      results.push(child);
    }
    // Recurse into children (ConnectorEnd → OwnedReferenceSubsetting hierarchy)
    results.push(...collectRefDescendants(childId, index, resolver));
  }
  return results;
}

// ── Template Resolution ──

/**
 * Deeply resolves `{{name}}` template placeholders in an X6 attrs object.
 * Replaces `{{name}}` with the symbol's name, `{{kind}}` with the kind,
 * and `{{compartment}}` with the compartment text (newline-separated attribute names).
 */
function resolveTemplates(
  attrs: X6Attrs | Record<string, any> | undefined,
  sym: SymbolEntry,
  compartmentText?: string,
): X6Attrs | undefined {
  if (!attrs) return undefined;
  const result: Record<string, any> = {};
  for (const [selector, styles] of Object.entries(attrs)) {
    if (typeof styles === "object" && styles !== null) {
      const resolved: Record<string, any> = {};
      for (const [prop, value] of Object.entries(styles)) {
        if (typeof value === "string") {
          resolved[prop] = value
            .replace(/\{\{name\}\}/g, sym.name ?? "")
            .replace(/\{\{kind\}\}/g, sym.ruleName ?? "")
            .replace(/\{\{compartment\}\}/g, compartmentText ?? "");
        } else {
          resolved[prop] = value;
        }
      }
      result[selector] = resolved;
    } else {
      result[selector] = styles;
    }
  }
  return result;
}

// ── Type Name Resolution ──

/**
 * Resolves the type name for a usage symbol by finding its OwnedFeatureTyping
 * children in the index and resolving them via the scope graph.
 *
 * Falls back to the ref entry's own name (e.g., "Real") when resolution
 * fails (built-in/primitive types that aren't indexed).
 *
 * Returns the first resolved type name, or undefined if no type is found.
 */
function resolveTypeName(symbolId: SymbolId, index: SymbolIndex, resolver?: ScopeResolver): string | undefined {
  // Strategy 1: Check childrenOf map (fast path if populated)
  const childIds = index.childrenOf.get(symbolId) ?? [];
  for (const childId of childIds) {
    const child = index.symbols.get(childId);
    if (!child) continue;
    if (child.ruleName !== "OwnedFeatureTyping" && child.ruleName !== "FeatureTyping") continue;

    // Try resolving via scope graph
    if (resolver) {
      const resolved = resolver.resolve(child);
      for (const target of resolved) {
        if (target.name && target.name !== "<anonymous>") {
          return target.name;
        }
      }
    }

    // Fall back to the entry's own name (e.g., "Real", "Integer")
    if (child.name && child.name !== "<anonymous>") {
      return child.name;
    }
  }

  // Strategy 2: Full scan of all symbols (handles cases where childrenOf isn't populated)
  for (const entry of index.symbols.values()) {
    if (entry.parentId !== symbolId) continue;
    if (entry.ruleName !== "OwnedFeatureTyping" && entry.ruleName !== "FeatureTyping") continue;

    // Try resolving via scope graph
    if (resolver) {
      const resolved = resolver.resolve(entry);
      for (const target of resolved) {
        if (target.name && target.name !== "<anonymous>") {
          return target.name;
        }
      }
    }

    // Fall back to the entry's own name
    if (entry.name && entry.name !== "<anonymous>") {
      return entry.name;
    }
  }

  return undefined;
}
