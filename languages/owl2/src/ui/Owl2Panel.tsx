// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildKnowledgeGraphFromTriples,
  executeOwl2SparqlQuery,
  materializeOwl2KnowledgeBase,
  type Owl2SparqlExecutionOutput,
} from "../sparql-kb.js";
import { Owl2KnowledgeGraph } from "./Owl2KnowledgeGraph.js";
import {
  buildOwl2WorkbenchModel,
  evaluateDlQuery,
  shortOwlLabel,
  type InferredFactKind,
  type Owl2ClassInfo,
  type Owl2EntityKind,
  type Owl2HierarchyNode,
  type Owl2IndividualInfo,
  type Owl2PropertyCharacteristic,
  type Owl2PropertyInfo,
  type Owl2WorkbenchModel,
} from "./owl2-workbench-model.js";

type Owl2TabId = "classes" | "properties" | "inferred" | "faceted" | "graph" | "query";
type HierarchyMode = "merged" | "asserted" | "inferred";

const CHAR_ABBR: Record<Owl2PropertyCharacteristic, { abbr: string; title: string }> = {
  Functional: { abbr: "F", title: "Functional" },
  InverseFunctional: { abbr: "IF", title: "InverseFunctional" },
  Transitive: { abbr: "T", title: "Transitive" },
  Symmetric: { abbr: "S", title: "Symmetric" },
  Asymmetric: { abbr: "AS", title: "Asymmetric" },
  Reflexive: { abbr: "R", title: "Reflexive" },
  Irreflexive: { abbr: "IR", title: "Irreflexive" },
};

const KIND_COLOR: Record<Owl2EntityKind, string> = {
  Class: "#f59e0b",
  ObjectProperty: "#3b82f6",
  DataProperty: "#10b981",
  Individual: "#a855f7",
};

function EntityDot({ kind, unsatisfiable }: { kind: Owl2EntityKind; unsatisfiable?: boolean | undefined }) {
  if (unsatisfiable) {
    return (
      <span
        title="Unsatisfiable class (≡ owl:Nothing)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "rgba(239, 68, 68, 0.18)",
          color: "#ef4444",
          fontSize: 10,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        ⊥
      </span>
    );
  }
  const color = KIND_COLOR[kind];
  if (kind === "Class") {
    return (
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  }
  if (kind === "Individual") {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          transform: "rotate(45deg)",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 2,
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function InferredBadge() {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 4,
        background: "rgba(245, 158, 11, 0.16)",
        color: "#d97706",
        border: "1px solid rgba(245, 158, 11, 0.35)",
        flexShrink: 0,
      }}
    >
      inferred
    </span>
  );
}

function renderOwl2TaxonomySvg(model: Owl2WorkbenchModel, showInferred: boolean, isDark: boolean): string {
  const classList = Array.from(model.classes.values());
  if (classList.length === 0) return "";

  const depthMap = new Map<string, number>();
  const parentLookup = new Map<string, string[]>();
  for (const c of classList) {
    const parents = showInferred
      ? Array.from(new Set([...c.assertedSuperClasses, ...c.inferredSuperClasses]))
      : c.assertedSuperClasses;
    parentLookup.set(c.iri, parents);
  }

  const getDepth = (iri: string, visited = new Set<string>()): number => {
    if (depthMap.has(iri)) return depthMap.get(iri)!;
    if (visited.has(iri)) return 0;
    visited.add(iri);
    const parents = (parentLookup.get(iri) ?? []).filter((p) => model.classes.has(p));
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => getDepth(p, visited)));
    depthMap.set(iri, d);
    return d;
  };

  const layers = new Map<number, Owl2ClassInfo[]>();
  for (const c of classList.slice(0, 70)) {
    const d = getDepth(c.iri);
    const arr = layers.get(d) ?? [];
    arr.push(c);
    layers.set(d, arr);
  }

  const nodeW = 156;
  const nodeH = 36;
  const gapX = 28;
  const gapY = 66;
  const positions = new Map<string, { x: number; y: number; cls: Owl2ClassInfo }>();

  let maxCols = 1;
  for (const arr of layers.values()) maxCols = Math.max(maxCols, arr.length);
  const totalWidth = Math.max(540, maxCols * (nodeW + gapX) + 64);
  const maxDepth = Math.max(0, ...Array.from(layers.keys()));
  const totalHeight = Math.max(280, (maxDepth + 1) * (nodeH + gapY) + 64);

  for (const [depth, arr] of layers.entries()) {
    const rowWidth = arr.length * nodeW + Math.max(0, arr.length - 1) * gapX;
    const startX = (totalWidth - rowWidth) / 2;
    const y = 36 + depth * (nodeH + gapY);
    arr.forEach((cls, idx) => {
      positions.set(cls.iri, { x: startX + idx * (nodeW + gapX), y, cls });
    });
  }

  const edgeAsserted = isDark ? "#38bdf8" : "#0284c7";
  const edgeInferred = isDark ? "#f59e0b" : "#d97706";
  const nodeFillNormal = isDark ? "#1e293b" : "#ffffff";
  const nodeFillUnsat = isDark ? "#3b1219" : "#fef2f2";
  const nodeTextColor = isDark ? "#e2e8f0" : "#0f172a";

  const assertedEdgesSvg = model.assertedSubClassEdges
    .map((e) => {
      const from = positions.get(e.child);
      const to = positions.get(e.parent);
      if (!from || !to) return "";
      const x1 = from.x + nodeW / 2;
      const y1 = from.y;
      const x2 = to.x + nodeW / 2;
      const y2 = to.y + nodeH;
      const midY = (y1 + y2) / 2;
      return `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${edgeAsserted}" stroke-width="1.6" marker-end="url(#owl-arrow)" data-line="${e.line}"/>`;
    })
    .join("");

  const inferredEdgesSvg = showInferred
    ? model.inferredSubClassEdges
        .map((e) => {
          const from = positions.get(e.child);
          const to = positions.get(e.parent);
          if (!from || !to) return "";
          const x1 = from.x + nodeW / 2;
          const y1 = from.y;
          const x2 = to.x + nodeW / 2;
          const y2 = to.y + nodeH;
          const midY = (y1 + y2) / 2;
          return `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${edgeInferred}" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#owl-arrow-inf)"/>`;
        })
        .join("")
    : "";

  const nodesSvg = Array.from(positions.entries())
    .map(([iri, pos]) => {
      const name = pos.cls.label;
      const label = name.length > 18 ? `${name.slice(0, 17)}…` : name;
      const stroke = pos.cls.unsatisfiable ? "#ef4444" : "#0891b2";
      const fill = pos.cls.unsatisfiable ? nodeFillUnsat : nodeFillNormal;
      const badge = pos.cls.unsatisfiable ? "⊥ " : "";
      return `<g data-line="${pos.cls.line}" data-id="${iri}" style="cursor:pointer;">
        <rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${pos.x + nodeW / 2}" y="${pos.y + 22}" text-anchor="middle" fill="${nodeTextColor}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600">${badge}${label}</text>
      </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="max-height:100%;">
  <defs>
    <marker id="owl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="none" stroke="${edgeAsserted}" stroke-width="1.4"/>
    </marker>
    <marker id="owl-arrow-inf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="none" stroke="${edgeInferred}" stroke-width="1.4"/>
    </marker>
  </defs>
  <g>${inferredEdgesSvg}</g>
  <g>${assertedEdgesSvg}</g>
  <g>${nodesSvg}</g>
</svg>`;
}

interface HierarchyTreeViewProps {
  nodes: Owl2HierarchyNode[];
  rootLabel: string;
  rootKind: Owl2EntityKind;
  selectedIri: string | null;
  onSelect: (iri: string) => void;
  searchQuery: string;
  showInferred: boolean;
  isDark: boolean;
}

const HierarchyTreeView: React.FC<HierarchyTreeViewProps> = ({
  nodes,
  rootLabel,
  rootKind,
  selectedIri,
  onSelect,
  searchQuery,
  showInferred,
  isDark,
}) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = searchQuery.trim().toLowerCase();

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const nodeMatches = (node: Owl2HierarchyNode): boolean => {
    if (!q) return true;
    if (node.label.toLowerCase().includes(q) || node.iri.toLowerCase().includes(q)) return true;
    return node.children.some(nodeMatches);
  };

  const renderNode = (node: Owl2HierarchyNode, depth: number, pathKey: string): React.ReactNode => {
    if (!showInferred && node.inferredLink) return null;
    if (!nodeMatches(node)) return null;
    const key = `${pathKey}/${node.iri}`;
    const visibleChildren = node.children.filter((c) => (showInferred || !c.inferredLink) && nodeMatches(c));
    const hasKids = visibleChildren.length > 0;
    const isCollapsed = collapsed.has(key) && !q;
    const isSelected = selectedIri === node.iri;

    return (
      <div key={key}>
        <div
          onClick={() => onSelect(node.iri)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            paddingLeft: 8 + depth * 16,
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 12,
            background: isSelected
              ? isDark
                ? "rgba(56, 189, 248, 0.16)"
                : "rgba(2, 132, 199, 0.12)"
              : node.inferredLink
                ? "rgba(245, 158, 11, 0.07)"
                : "transparent",
            border: isSelected ? "1px solid rgba(56, 189, 248, 0.45)" : "1px solid transparent",
            color: node.unsatisfiable ? "#ef4444" : "var(--ms-text)",
          }}
        >
          <span
            onClick={(e) => {
              if (!hasKids) return;
              e.stopPropagation();
              toggle(key);
            }}
            style={{
              width: 14,
              textAlign: "center",
              fontSize: 10,
              color: "var(--ms-text-2)",
              userSelect: "none",
              cursor: hasKids ? "pointer" : "default",
              flexShrink: 0,
            }}
          >
            {hasKids ? (isCollapsed ? "▸" : "▾") : "•"}
          </span>
          <EntityDot kind={node.kind} unsatisfiable={node.unsatisfiable} />
          <span
            style={{
              fontWeight: isSelected ? 700 : 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={node.iri}
          >
            {node.label}
          </span>
          {node.inferredLink && <InferredBadge />}
          {node.characteristics && node.characteristics.length > 0 && (
            <span style={{ display: "inline-flex", gap: 2 }}>
              {node.characteristics.slice(0, 3).map((ch) => (
                <span
                  key={ch}
                  title={CHAR_ABBR[ch].title}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "0 4px",
                    borderRadius: 3,
                    background: isDark ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.12)",
                    color: "#3b82f6",
                  }}
                >
                  {CHAR_ABBR[ch].abbr}
                </span>
              ))}
            </span>
          )}
          {typeof node.instanceCount === "number" && node.instanceCount > 0 && (
            <span
              title={`${node.instanceCount} individual(s)`}
              style={{
                fontSize: 10,
                padding: "0 5px",
                borderRadius: 999,
                background: isDark ? "rgba(168, 85, 247, 0.18)" : "rgba(168, 85, 247, 0.12)",
                color: "#a855f7",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {node.instanceCount}
            </span>
          )}
        </div>
        {hasKids && !isCollapsed && visibleChildren.map((child) => renderNode(child, depth + 1, key))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--ms-text-2)",
          fontFamily: "var(--ms-font-mono)",
        }}
      >
        <EntityDot kind={rootKind} />
        <span>{rootLabel}</span>
      </div>
      {nodes.length === 0 ? (
        <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--ms-text-2)" }}>No entities declared.</div>
      ) : (
        nodes.map((n) => renderNode(n, 1, "root"))
      )}
    </div>
  );
};

function SectionCard({
  title,
  count,
  inferred,
  children,
}: {
  title: string;
  count?: number | undefined;
  inferred?: boolean | undefined;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 7,
        border: inferred ? "1px solid rgba(245, 158, 11, 0.35)" : "1px solid var(--ms-border)",
        background: inferred ? "rgba(245, 158, 11, 0.06)" : "var(--ms-bg-alt)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: inferred ? "#d97706" : "var(--ms-text-2)",
          }}
        >
          {title}
        </span>
        {typeof count === "number" && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ms-text-2)" }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function EntityChip({
  iri,
  kind,
  inferred,
  onClick,
}: {
  iri: string;
  kind: Owl2EntityKind;
  inferred?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={iri}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 5,
        fontSize: 11,
        fontFamily: "var(--ms-font-mono)",
        fontWeight: 500,
        cursor: onClick ? "pointer" : "default",
        background: inferred ? "rgba(245, 158, 11, 0.14)" : "var(--ms-bg)",
        border: inferred ? "1px solid rgba(245, 158, 11, 0.42)" : "1px solid var(--ms-border)",
        color: "var(--ms-text)",
      }}
    >
      <EntityDot kind={kind} />
      <span>{shortOwlLabel(iri)}</span>
      {inferred && <InferredBadge />}
    </button>
  );
}

export const Owl2Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const isDark = colorMode === "dark";
  const [activeTab, setActiveTab] = useState<Owl2TabId>("classes");
  const [hierarchyMode, setHierarchyMode] = useState<HierarchyMode>("merged");
  const [showInferred, setShowInferred] = useState(true);
  const [treeSearch, setTreeSearch] = useState("");
  const [selectedClassIri, setSelectedClassIri] = useState<string | null>(null);
  const [selectedPropIri, setSelectedPropIri] = useState<string | null>(null);
  const [selectedIndIri, setSelectedIndIri] = useState<string | null>(null);
  const [inferredFilter, setInferredFilter] = useState<"all" | InferredFactKind>("all");

  // Faceted browser state
  const [facetSearch, setFacetSearch] = useState("");
  const [facetKinds, setFacetKinds] = useState<Set<Owl2EntityKind>>(new Set());
  const [facetStatus, setFacetStatus] = useState<"all" | "inferred" | "unsatisfiable" | "asserted">("all");
  const [facetChars, setFacetChars] = useState<Set<Owl2PropertyCharacteristic>>(new Set());
  const [facetBranch, setFacetBranch] = useState<string | null>(null);

  // Graph & SPARQL / DL Query state
  const [graphSubMode, setGraphSubMode] = useState<"kg" | "taxonomy">("kg");
  const [queryMode, setQueryMode] = useState<"sparql" | "dl">("sparql");
  const [dlQuery, setDlQuery] = useState("");
  const [sparqlQuery, setSparqlQuery] = useState(
    "SELECT ?entity ?predicate ?target WHERE {\n  ?entity ?predicate ?target .\n  FILTER(?predicate != rdf:type || ?target != owl:Class)\n} LIMIT 50",
  );
  const [sparqlResultView, setSparqlResultView] = useState<"table" | "graph" | "triples">("table");
  const [sparqlBusy, setSparqlBusy] = useState(false);
  const [sparqlError, setSparqlError] = useState<string | null>(null);
  const [sparqlResult, setSparqlResult] = useState<Owl2SparqlExecutionOutput | null>(null);

  const model = useMemo(() => buildOwl2WorkbenchModel(code), [code]);
  const graphSvg = useMemo(
    () => renderOwl2TaxonomySvg(model, showInferred, colorMode === "dark"),
    [model, showInferred, colorMode],
  );
  const materializedKb = useMemo(
    () => materializeOwl2KnowledgeBase(model, { includeInferred: showInferred }),
    [model, showInferred],
  );
  const fullKg = useMemo(
    () => buildKnowledgeGraphFromTriples(materializedKb.triples, model, materializedKb.baseIri),
    [materializedKb, model],
  );

  const runSparql = useCallback(
    async (queryOverride?: string) => {
      const q = (queryOverride ?? sparqlQuery).trim();
      if (!q) return;
      setSparqlBusy(true);
      setSparqlError(null);
      try {
        const res = await executeOwl2SparqlQuery(model, q, { includeInferred: showInferred });
        setSparqlResult(res);
      } catch (err) {
        setSparqlError(err instanceof Error ? err.message : String(err));
      } finally {
        setSparqlBusy(false);
      }
    },
    [model, showInferred, sparqlQuery],
  );

  // Auto-select first class/property when ontology changes
  useEffect(() => {
    if (!selectedClassIri || !model.classes.has(selectedClassIri)) {
      const first = model.assertedClassTree[0]?.iri ?? Array.from(model.classes.keys())[0] ?? null;
      setSelectedClassIri(first);
    }
    if (!selectedPropIri || !model.properties.has(selectedPropIri)) {
      const firstP = Array.from(model.properties.keys())[0] ?? null;
      setSelectedPropIri(firstP);
    }
    if (!selectedIndIri || !model.individuals.has(selectedIndIri)) {
      const firstI = Array.from(model.individuals.keys())[0] ?? null;
      setSelectedIndIri(firstI);
    }
  }, [model, selectedClassIri, selectedPropIri, selectedIndIri]);

  // Listen to Ansatz toolbar actions so clicking "Reasoner" or "SPARQL Query" activates the right tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ languageId?: string; actionId?: string }>).detail;
      if (detail?.languageId !== "owl2") return;
      if (detail.actionId === "validate_consistency" || detail.actionId === "explain_inferences") {
        setShowInferred(true);
        setActiveTab("inferred");
      } else if (detail.actionId === "query_sparql") {
        setActiveTab("query");
      }
    };
    window.addEventListener("ansatz:toolbar-action-result", handler);
    return () => window.removeEventListener("ansatz:toolbar-action-result", handler);
  }, []);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (model.ontologyIri ? shortOwlLabel(model.ontologyIri) : "OWL 2 Ontology Workbench");

  const activeClassTree =
    hierarchyMode === "asserted"
      ? model.assertedClassTree
      : hierarchyMode === "inferred"
        ? model.inferredClassTree
        : model.mergedClassTree;

  const selectedClass: Owl2ClassInfo | undefined = selectedClassIri ? model.classes.get(selectedClassIri) : undefined;
  const selectedProp: Owl2PropertyInfo | undefined = selectedPropIri
    ? model.properties.get(selectedPropIri)
    : undefined;
  const selectedInd: Owl2IndividualInfo | undefined = selectedIndIri
    ? model.individuals.get(selectedIndIri)
    : undefined;

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      {
        label: "Reasoner",
        value: !model.consistent
          ? "Inconsistent"
          : model.unsatisfiableClasses.length > 0
            ? `${model.unsatisfiableClasses.length} Unsat`
            : `Consistent (${model.reasoningTimeMs}ms)`,
        tone: !model.consistent ? "danger" : model.unsatisfiableClasses.length > 0 ? "warning" : "success",
      },
      { label: "Classes", value: model.classes.size, tone: "info" },
      { label: "Properties", value: model.properties.size },
      { label: "Individuals", value: model.individuals.size },
      {
        label: "Inferred Facts",
        value: model.inferredFacts.length,
        tone: model.inferredFacts.length > 0 ? "warning" : undefined,
      },
    ],
    [model],
  );

  const filteredInferredFacts = useMemo(() => {
    if (inferredFilter === "all") return model.inferredFacts;
    return model.inferredFacts.filter((f) => f.kind === inferredFilter);
  }, [model.inferredFacts, inferredFilter]);

  const filteredFacetedEntities = useMemo(() => {
    const q = facetSearch.trim().toLowerCase();
    return model.facetedEntities.filter((e) => {
      if (facetKinds.size > 0 && !facetKinds.has(e.kind)) return false;
      if (facetStatus === "inferred" && !e.hasInferredFacts) return false;
      if (facetStatus === "unsatisfiable" && !e.unsatisfiable) return false;
      if (facetStatus === "asserted" && e.hasInferredFacts) return false;
      if (facetChars.size > 0) {
        if (!Array.from(facetChars).every((c) => e.characteristics.includes(c))) return false;
      }
      if (facetBranch && !e.topLevelBranches.includes(facetBranch)) return false;
      if (q && !e.searchText.includes(q)) return false;
      return true;
    });
  }, [model.facetedEntities, facetSearch, facetKinds, facetStatus, facetChars, facetBranch]);

  const dlQueryResult = useMemo(() => evaluateDlQuery(model, dlQuery), [model, dlQuery]);

  const navigateToEntity = (iri: string, kind: Owl2EntityKind) => {
    if (kind === "Class" && model.classes.has(iri)) {
      setSelectedClassIri(iri);
      setActiveTab("classes");
      host.onRevealLine?.(model.classes.get(iri)!.line, shortOwlLabel(iri));
    } else if ((kind === "ObjectProperty" || kind === "DataProperty") && model.properties.has(iri)) {
      setSelectedPropIri(iri);
      setActiveTab("properties");
      host.onRevealLine?.(model.properties.get(iri)!.line, shortOwlLabel(iri));
    } else if (kind === "Individual" && model.individuals.has(iri)) {
      setSelectedIndIri(iri);
      host.onRevealLine?.(model.individuals.get(iri)!.line, shortOwlLabel(iri));
    }
  };

  const appendAxiomToSource = (axiomLine: string) => {
    if (!host.onCodeChange) return;
    const trimmed = code.trimEnd();
    if (model.format === "ofn" && trimmed.endsWith(")")) {
      const insertIdx = trimmed.lastIndexOf(")");
      const updated = `${trimmed.slice(0, insertIdx).trimEnd()}\n  ${axiomLine}\n)\n`;
      host.onCodeChange(updated);
    } else {
      host.onCodeChange(`${trimmed}\n${axiomLine}\n`);
    }
  };

  const toggleFacetKind = (kind: Owl2EntityKind) => {
    setFacetKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const toggleFacetChar = (ch: Owl2PropertyCharacteristic) => {
    setFacetChars((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  const firstClassSample = Array.from(model.classes.keys())[0] ?? ":Entity";
  const firstIndSample = Array.from(model.individuals.keys())[0];

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={`${model.ontologyIri ?? "Active Ontology"} • ${model.formatLabel}`}
        badge={{
          label: !model.consistent ? "INCONSISTENT" : showInferred ? "SROIQ(D) LIVE" : "ASSERTED",
          tone: !model.consistent ? "danger" : showInferred ? "warning" : "info",
        }}
        actions={
          <>
            <PanelButton
              variant={showInferred ? "primary" : undefined}
              onClick={() => setShowInferred((v) => !v)}
              title="Toggle visibility of Protégé-style inferred axioms and hierarchy links"
            >
              {showInferred ? "Inferred: ON" : "Inferred: OFF"}
            </PanelButton>
            {activeTab === "graph" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("owl2-taxonomy.svg", graphSvg, "image/svg+xml")}
                disabled={!graphSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "owl2", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Owl2TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "classes", label: "Class Hierarchy", count: model.classes.size },
          { id: "properties", label: "Properties", count: model.properties.size },
          { id: "inferred", label: "Inferred Facts", count: model.inferredFacts.length },
          { id: "faceted", label: "Faceted Browser", count: model.facetedEntities.length },
          { id: "graph", label: "Knowledge Graph", count: fullKg.nodes.length },
          { id: "query", label: "SPARQL & Query" },
        ]}
      />

      {/* ── TAB 1: CLASS HIERARCHY + DESCRIPTION INSPECTOR ──────────────────── */}
      {activeTab === "classes" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {/* Left: Collapsible Class Tree */}
          <div
            style={{
              width: "44%",
              minWidth: 220,
              maxWidth: 380,
              borderRight: "1px solid var(--ms-border)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "8px 10px",
                borderBottom: "1px solid var(--ms-border)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", gap: 4 }}>
                {(["merged", "asserted", "inferred"] as HierarchyMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setHierarchyMode(m)}
                    style={{
                      flex: 1,
                      padding: "3px 6px",
                      fontSize: 11,
                      fontWeight: hierarchyMode === m ? 700 : 500,
                      borderRadius: 5,
                      cursor: "pointer",
                      textTransform: "capitalize",
                      border: hierarchyMode === m ? "1px solid var(--ms-brand, #0969da)" : "1px solid var(--ms-border)",
                      background:
                        hierarchyMode === m
                          ? isDark
                            ? "rgba(56, 189, 248, 0.16)"
                            : "rgba(9, 105, 218, 0.1)"
                          : "transparent",
                      color: "var(--ms-text)",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                placeholder="Filter classes..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "5px 8px",
                  fontSize: 12,
                  borderRadius: 5,
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg)",
                  color: "var(--ms-text)",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "6px 4px" }}>
              <HierarchyTreeView
                nodes={activeClassTree}
                rootLabel="owl:Thing"
                rootKind="Class"
                selectedIri={selectedClassIri}
                onSelect={(iri) => {
                  setSelectedClassIri(iri);
                  const cls = model.classes.get(iri);
                  if (cls) host.onRevealLine?.(cls.line, cls.label);
                }}
                searchQuery={treeSearch}
                showInferred={showInferred}
                isDark={isDark}
              />
            </div>
          </div>

          {/* Right: Protégé-style Class Description Inspector */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {!selectedClass ? (
              <div style={{ fontSize: 12, color: "var(--ms-text-2)" }}>
                Select a class in the hierarchy to inspect its asserted and inferred axioms.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <EntityDot kind="Class" unsatisfiable={selectedClass.unsatisfiable} />
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: selectedClass.unsatisfiable ? "#ef4444" : "var(--ms-text)",
                        }}
                      >
                        {selectedClass.label}
                      </div>
                      <div style={{ fontSize: 11, fontFamily: "var(--ms-font-mono)", color: "var(--ms-text-2)" }}>
                        {selectedClass.iri} (L{selectedClass.line})
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {host.onRevealLine && (
                      <PanelButton onClick={() => host.onRevealLine?.(selectedClass.line, selectedClass.label)}>
                        Reveal in Code
                      </PanelButton>
                    )}
                    {host.onCodeChange && model.format === "ofn" && (
                      <PanelButton
                        onClick={() =>
                          appendAxiomToSource(
                            `Declaration(Class(:${selectedClass.label}Sub))\n  SubClassOf(:${selectedClass.label}Sub ${selectedClass.iri})`,
                          )
                        }
                      >
                        + SubClass
                      </PanelButton>
                    )}
                  </div>
                </div>

                {selectedClass.unsatisfiable && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#ef4444",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    ⊥ Unsatisfiable Class — equivalent to <code>owl:Nothing</code> under SROIQ(D) tableau reasoning.
                  </div>
                )}

                <SectionCard
                  title="SuperClasses (SubClassOf ⊑)"
                  count={
                    selectedClass.assertedSuperClasses.length +
                    (showInferred ? selectedClass.inferredSuperClasses.length : 0) +
                    selectedClass.complexSuperExpressions.length
                  }
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedClass.assertedSuperClasses.map((sup) => (
                      <EntityChip
                        key={`asup-${sup}`}
                        iri={sup}
                        kind="Class"
                        onClick={() => navigateToEntity(sup, "Class")}
                      />
                    ))}
                    {showInferred &&
                      selectedClass.inferredSuperClasses.map((sup) => (
                        <EntityChip
                          key={`isup-${sup}`}
                          iri={sup}
                          kind="Class"
                          inferred
                          onClick={() => navigateToEntity(sup, "Class")}
                        />
                      ))}
                    {selectedClass.complexSuperExpressions.map((expr, idx) => (
                      <span
                        key={`cexpr-${idx}`}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          fontSize: 11,
                          fontFamily: "var(--ms-font-mono)",
                          background: "var(--ms-bg)",
                          border: "1px solid var(--ms-border)",
                          color: "var(--ms-text)",
                        }}
                      >
                        {expr}
                      </span>
                    ))}
                    {selectedClass.assertedSuperClasses.length === 0 &&
                      (!showInferred || selectedClass.inferredSuperClasses.length === 0) &&
                      selectedClass.complexSuperExpressions.length === 0 && (
                        <span style={{ fontSize: 11, color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)" }}>
                          owl:Thing
                        </span>
                      )}
                  </div>
                </SectionCard>

                <SectionCard
                  title="SubClasses"
                  count={
                    selectedClass.assertedSubClasses.length +
                    (showInferred ? selectedClass.inferredSubClasses.length : 0)
                  }
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedClass.assertedSubClasses.map((sub) => (
                      <EntityChip
                        key={`asub-${sub}`}
                        iri={sub}
                        kind="Class"
                        onClick={() => navigateToEntity(sub, "Class")}
                      />
                    ))}
                    {showInferred &&
                      selectedClass.inferredSubClasses.map((sub) => (
                        <EntityChip
                          key={`isub-${sub}`}
                          iri={sub}
                          kind="Class"
                          inferred
                          onClick={() => navigateToEntity(sub, "Class")}
                        />
                      ))}
                    {selectedClass.assertedSubClasses.length === 0 &&
                      (!showInferred || selectedClass.inferredSubClasses.length === 0) && (
                        <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>None</span>
                      )}
                  </div>
                </SectionCard>

                <SectionCard title="Disjoint With" count={selectedClass.disjointWith.length}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedClass.disjointWith.length === 0 ? (
                      <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>None</span>
                    ) : (
                      selectedClass.disjointWith.map((d) => (
                        <EntityChip key={d} iri={d} kind="Class" onClick={() => navigateToEntity(d, "Class")} />
                      ))
                    )}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Members / Individuals"
                  count={
                    selectedClass.assertedInstances.length + (showInferred ? selectedClass.inferredInstances.length : 0)
                  }
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedClass.assertedInstances.map((ind) => (
                      <EntityChip
                        key={`aind-${ind}`}
                        iri={ind}
                        kind="Individual"
                        onClick={() => navigateToEntity(ind, "Individual")}
                      />
                    ))}
                    {showInferred &&
                      selectedClass.inferredInstances.map((ind) => (
                        <EntityChip
                          key={`iind-${ind}`}
                          iri={ind}
                          kind="Individual"
                          inferred
                          onClick={() => navigateToEntity(ind, "Individual")}
                        />
                      ))}
                    {selectedClass.assertedInstances.length === 0 &&
                      (!showInferred || selectedClass.inferredInstances.length === 0) && (
                        <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>No instances</span>
                      )}
                  </div>
                </SectionCard>

                {(selectedClass.domainOfProperties.length > 0 || selectedClass.rangeOfProperties.length > 0) && (
                  <SectionCard
                    title="Property Usage (Domain / Range)"
                    count={selectedClass.domainOfProperties.length + selectedClass.rangeOfProperties.length}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedClass.domainOfProperties.map((p) => {
                        const prop = model.properties.get(p);
                        return (
                          <EntityChip
                            key={`dom-${p}`}
                            iri={`${p} (domain)`}
                            kind={prop?.kind ?? "ObjectProperty"}
                            onClick={() => navigateToEntity(p, prop?.kind ?? "ObjectProperty")}
                          />
                        );
                      })}
                      {selectedClass.rangeOfProperties.map((p) => {
                        const prop = model.properties.get(p);
                        return (
                          <EntityChip
                            key={`rng-${p}`}
                            iri={`${p} (range)`}
                            kind={prop?.kind ?? "ObjectProperty"}
                            onClick={() => navigateToEntity(p, prop?.kind ?? "ObjectProperty")}
                          />
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {selectedInd && (
                  <SectionCard title={`Selected Individual: ${selectedInd.label}`}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {selectedInd.assertedTypes.map((t) => (
                          <EntityChip
                            key={`it-${t}`}
                            iri={t}
                            kind="Class"
                            onClick={() => navigateToEntity(t, "Class")}
                          />
                        ))}
                        {showInferred &&
                          selectedInd.inferredTypes.map((t) => (
                            <EntityChip
                              key={`iit-${t}`}
                              iri={t}
                              kind="Class"
                              inferred
                              onClick={() => navigateToEntity(t, "Class")}
                            />
                          ))}
                      </div>
                      {selectedInd.inferredRoleAssertions.length > 0 && showInferred && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {selectedInd.inferredRoleAssertions.map((r, i) => (
                            <div
                              key={i}
                              style={{
                                fontFamily: "var(--ms-font-mono)",
                                color: "#d97706",
                              }}
                            >
                              → {shortOwlLabel(r.property)}({shortOwlLabel(r.target)}) [inferred]
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: PROPERTY HIERARCHY + CHARACTERISTICS INSPECTOR ───────────── */}
      {activeTab === "properties" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <div
            style={{
              width: "44%",
              minWidth: 220,
              maxWidth: 380,
              borderRight: "1px solid var(--ms-border)",
              overflow: "auto",
              padding: "8px 6px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <HierarchyTreeView
              nodes={model.objectPropertyTree}
              rootLabel="owl:topObjectProperty"
              rootKind="ObjectProperty"
              selectedIri={selectedPropIri}
              onSelect={(iri) => {
                setSelectedPropIri(iri);
                const prop = model.properties.get(iri);
                if (prop) host.onRevealLine?.(prop.line, prop.label);
              }}
              searchQuery=""
              showInferred={showInferred}
              isDark={isDark}
            />
            <div style={{ borderTop: "1px solid var(--ms-border)", paddingTop: 10 }}>
              <HierarchyTreeView
                nodes={model.dataPropertyTree}
                rootLabel="owl:topDataProperty"
                rootKind="DataProperty"
                selectedIri={selectedPropIri}
                onSelect={(iri) => {
                  setSelectedPropIri(iri);
                  const prop = model.properties.get(iri);
                  if (prop) host.onRevealLine?.(prop.line, prop.label);
                }}
                searchQuery=""
                showInferred={showInferred}
                isDark={isDark}
              />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {!selectedProp ? (
              <div style={{ fontSize: 12, color: "var(--ms-text-2)" }}>
                Select an ObjectProperty or DataProperty to inspect its hierarchy, domain, range, and characteristics.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <EntityDot kind={selectedProp.kind} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedProp.label}</div>
                      <div style={{ fontSize: 11, fontFamily: "var(--ms-font-mono)", color: "var(--ms-text-2)" }}>
                        {selectedProp.kind} • {selectedProp.iri} (L{selectedProp.line})
                      </div>
                    </div>
                  </div>
                  {host.onRevealLine && (
                    <PanelButton onClick={() => host.onRevealLine?.(selectedProp.line, selectedProp.label)}>
                      Reveal in Code
                    </PanelButton>
                  )}
                </div>

                <SectionCard title="Characteristics" count={selectedProp.characteristics.length}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedProp.characteristics.length === 0 ? (
                      <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>None declared</span>
                    ) : (
                      selectedProp.characteristics.map((ch) => (
                        <span
                          key={ch}
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: isDark ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.12)",
                            color: "#3b82f6",
                            border: "1px solid rgba(59, 130, 246, 0.35)",
                          }}
                        >
                          {ch}
                        </span>
                      ))
                    )}
                  </div>
                </SectionCard>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <SectionCard title="Domains" count={selectedProp.domains.length}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedProp.domains.length === 0 ? (
                        <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>owl:Thing</span>
                      ) : (
                        selectedProp.domains.map((d, i) => (
                          <EntityChip
                            key={i}
                            iri={d}
                            kind="Class"
                            onClick={model.classes.has(d) ? () => navigateToEntity(d, "Class") : undefined}
                          />
                        ))
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard title="Ranges" count={selectedProp.ranges.length}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedProp.ranges.length === 0 ? (
                        <span style={{ fontSize: 11, color: "var(--ms-text-2)" }}>
                          {selectedProp.kind === "DataProperty" ? "rdfs:Literal" : "owl:Thing"}
                        </span>
                      ) : (
                        selectedProp.ranges.map((r, i) => (
                          <EntityChip
                            key={i}
                            iri={r}
                            kind={selectedProp.kind === "DataProperty" ? "DataProperty" : "Class"}
                            onClick={model.classes.has(r) ? () => navigateToEntity(r, "Class") : undefined}
                          />
                        ))
                      )}
                    </div>
                  </SectionCard>
                </div>

                {(selectedProp.superProperties.length > 0 || selectedProp.subProperties.length > 0) && (
                  <SectionCard title="Property Hierarchy">
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                      {selectedProp.superProperties.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--ms-text-2)" }}>SubPropertyOf:</span>
                          {selectedProp.superProperties.map((sp) => (
                            <EntityChip
                              key={sp}
                              iri={sp}
                              kind={selectedProp.kind}
                              onClick={() => navigateToEntity(sp, selectedProp.kind)}
                            />
                          ))}
                        </div>
                      )}
                      {selectedProp.subProperties.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--ms-text-2)" }}>SubProperties:</span>
                          {selectedProp.subProperties.map((sp) => (
                            <EntityChip
                              key={sp}
                              iri={sp}
                              kind={selectedProp.kind}
                              onClick={() => navigateToEntity(sp, selectedProp.kind)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                )}

                {selectedProp.inverseOf.length > 0 && (
                  <SectionCard title="Inverse Of" count={selectedProp.inverseOf.length}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedProp.inverseOf.map((inv) => (
                        <EntityChip
                          key={inv}
                          iri={inv}
                          kind="ObjectProperty"
                          onClick={() => navigateToEntity(inv, "ObjectProperty")}
                        />
                      ))}
                    </div>
                  </SectionCard>
                )}

                {selectedProp.propertyChains.length > 0 && (
                  <SectionCard
                    title="Property Chains (SubPropertyChainOf)"
                    count={selectedProp.propertyChains.length}
                    inferred
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {selectedProp.propertyChains.map((chain, idx) => (
                        <div key={idx} style={{ fontFamily: "var(--ms-font-mono)", fontSize: 11 }}>
                          {chain.map(shortOwlLabel).join(" ○ ")} ⊑ <strong>{selectedProp.label}</strong>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: INFERRED FACTS & REASONER EXPLANATIONS ───────────────────── */}
      {activeTab === "inferred" && (
        <div
          style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          {/* Consistency Banner */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: !model.consistent
                ? "1px solid rgba(239, 68, 68, 0.45)"
                : model.unsatisfiableClasses.length > 0
                  ? "1px solid rgba(245, 158, 11, 0.45)"
                  : "1px solid rgba(34, 197, 94, 0.4)",
              background: !model.consistent
                ? "rgba(239, 68, 68, 0.1)"
                : model.unsatisfiableClasses.length > 0
                  ? "rgba(245, 158, 11, 0.1)"
                  : "rgba(34, 197, 94, 0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  color: !model.consistent ? "#ef4444" : model.unsatisfiableClasses.length > 0 ? "#d97706" : "#16a34a",
                }}
              >
                {!model.consistent
                  ? `✗ Ontology Inconsistent (${model.clashes.length} contradiction(s) detected)`
                  : model.unsatisfiableClasses.length > 0
                    ? `⚠ Ontology Consistent, but ${model.unsatisfiableClasses.length} Unsatisfiable Class(es) Found`
                    : `✓ Ontology Consistent — ${model.inferredFacts.length} Inferred Fact(s) Computed`}
              </span>
              <span style={{ fontSize: 11, color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)" }}>
                SROIQ(D) Tableau • {model.reasoningTimeMs}ms
              </span>
            </div>
            {model.clashes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {model.clashes.map((c, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--ms-font-mono)",
                      color: "#ef4444",
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: "rgba(239, 68, 68, 0.08)",
                    }}
                  >
                    {c}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filter Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(
              [
                { id: "all", label: `All (${model.inferredFacts.length})` },
                {
                  id: "subClassOf",
                  label: `SubClassOf ⊑ (${model.inferredFacts.filter((f) => f.kind === "subClassOf").length})`,
                },
                {
                  id: "classAssertion",
                  label: `Types ∈ (${model.inferredFacts.filter((f) => f.kind === "classAssertion").length})`,
                },
                {
                  id: "roleAssertion",
                  label: `Roles → (${model.inferredFacts.filter((f) => f.kind === "roleAssertion").length})`,
                },
                {
                  id: "sameIndividual",
                  label: `SameAs ≡ (${model.inferredFacts.filter((f) => f.kind === "sameIndividual").length})`,
                },
                {
                  id: "unsatisfiableClass",
                  label: `Unsatisfiable ⊥ (${model.inferredFacts.filter((f) => f.kind === "unsatisfiableClass").length})`,
                },
              ] as Array<{ id: "all" | InferredFactKind; label: string }>
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setInferredFilter(pill.id)}
                style={{
                  padding: "4px 9px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: inferredFilter === pill.id ? 700 : 500,
                  cursor: "pointer",
                  border:
                    inferredFilter === pill.id ? "1px solid rgba(245, 158, 11, 0.6)" : "1px solid var(--ms-border)",
                  background: inferredFilter === pill.id ? "rgba(245, 158, 11, 0.16)" : "var(--ms-bg-alt)",
                  color: "var(--ms-text)",
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Inferred Fact Cards */}
          {filteredInferredFacts.length === 0 ? (
            <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--ms-text-2)", textAlign: "center" }}>
              No newly inferred facts in this category. Add transitive <code>SubClassOf</code> chains,{" "}
              <code>ObjectPropertyDomain</code>/<code>Range</code>, <code>TransitiveObjectProperty</code>, or{" "}
              <code>SubPropertyChainOf</code> axioms to see live inferences.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredInferredFacts.map((fact) => {
                const isUnsat = fact.kind === "unsatisfiableClass";
                return (
                  <div
                    key={fact.id}
                    onClick={() => {
                      if (model.classes.has(fact.subject)) navigateToEntity(fact.subject, "Class");
                      else if (model.individuals.has(fact.subject)) navigateToEntity(fact.subject, "Individual");
                    }}
                    style={{
                      padding: "8px 11px",
                      borderRadius: 7,
                      border: isUnsat ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid rgba(245, 158, 11, 0.38)",
                      background: isUnsat ? "rgba(239, 68, 68, 0.08)" : "rgba(245, 158, 11, 0.08)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span
                        style={{
                          fontFamily: "var(--ms-font-mono)",
                          fontSize: 12,
                          fontWeight: 700,
                          color: isUnsat ? "#ef4444" : "var(--ms-text)",
                        }}
                      >
                        {fact.displayText}
                      </span>
                      <InferredBadge />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ms-text-2)" }}>{fact.explanation}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: FACETED ENTITY BROWSER ───────────────────────────────────── */}
      {activeTab === "faceted" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {/* Left Facet Rail */}
          <div
            style={{
              width: 210,
              flexShrink: 0,
              borderRight: "1px solid var(--ms-border)",
              overflow: "auto",
              padding: "10px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--ms-text-2)",
                }}
              >
                Facets
              </span>
              {(facetKinds.size > 0 || facetStatus !== "all" || facetChars.size > 0 || facetBranch || facetSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setFacetKinds(new Set());
                    setFacetStatus("all");
                    setFacetChars(new Set());
                    setFacetBranch(null);
                    setFacetSearch("");
                  }}
                  style={{
                    fontSize: 10,
                    background: "none",
                    border: "none",
                    color: "var(--ms-brand, #0969da)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Kind Facet */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Entity Kind</div>
              {(["Class", "ObjectProperty", "DataProperty", "Individual"] as Owl2EntityKind[]).map((kind) => {
                const count = model.facetedEntities.filter((e) => e.kind === kind).length;
                const checked = facetKinds.has(kind);
                return (
                  <label
                    key={kind}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: 4,
                      background: checked ? "rgba(56, 189, 248, 0.12)" : "transparent",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleFacetKind(kind)} />
                      <EntityDot kind={kind} />
                      <span>{kind}</span>
                    </span>
                    <span style={{ color: "var(--ms-text-2)", fontSize: 10 }}>{count}</span>
                  </label>
                );
              })}
            </div>

            {/* Reasoning Status Facet */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Reasoning Status</div>
              {(
                [
                  { id: "all", label: "All Entities" },
                  { id: "inferred", label: "Has Inferred Facts" },
                  { id: "unsatisfiable", label: "Unsatisfiable (⊥)" },
                  { id: "asserted", label: "Asserted Only" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name="owl2-facet-status"
                    checked={facetStatus === opt.id}
                    onChange={() => setFacetStatus(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {/* Property Characteristics Facet */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Property Characteristics</div>
              {(Object.keys(CHAR_ABBR) as Owl2PropertyCharacteristic[]).map((ch) => {
                const count = model.facetedEntities.filter((e) => e.characteristics.includes(ch)).length;
                if (count === 0) return null;
                return (
                  <label
                    key={ch}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={facetChars.has(ch)} onChange={() => toggleFacetChar(ch)} />
                      <span>{ch}</span>
                    </span>
                    <span style={{ color: "var(--ms-text-2)", fontSize: 10 }}>{count}</span>
                  </label>
                );
              })}
            </div>

            {/* Top-Level Branch Facet */}
            {model.topLevelBranches.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>Taxonomy Branch</div>
                {model.topLevelBranches.slice(0, 12).map((branch) => {
                  const active = facetBranch === branch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      onClick={() => setFacetBranch(active ? null : branch)}
                      style={{
                        textAlign: "left",
                        padding: "3px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: "pointer",
                        border: active ? "1px solid var(--ms-brand, #0969da)" : "1px solid transparent",
                        background: active ? "rgba(56, 189, 248, 0.14)" : "transparent",
                        color: "var(--ms-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {shortOwlLabel(branch)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Faceted Results */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--ms-border)",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                value={facetSearch}
                onChange={(e) => setFacetSearch(e.target.value)}
                placeholder="Search IRIs, classes, properties, individuals, axioms..."
                style={{
                  flex: 1,
                  padding: "6px 9px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg)",
                  color: "var(--ms-text)",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--ms-text-2)", whiteSpace: "nowrap" }}>
                {filteredFacetedEntities.length} / {model.facetedEntities.length}
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {filteredFacetedEntities.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ms-text-2)", textAlign: "center", padding: 16 }}>
                  No ontology entities match the active facet filters.
                </div>
              ) : (
                filteredFacetedEntities.map((ent) => (
                  <div
                    key={`${ent.kind}:${ent.iri}`}
                    onClick={() => navigateToEntity(ent.iri, ent.kind)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: ent.unsatisfiable
                        ? "rgba(239, 68, 68, 0.08)"
                        : ent.hasInferredFacts
                          ? "rgba(245, 158, 11, 0.06)"
                          : "var(--ms-bg-alt)",
                      border: ent.unsatisfiable ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--ms-border)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <EntityDot kind={ent.kind} unsatisfiable={ent.unsatisfiable} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{ent.label}</span>
                          {ent.hasInferredFacts && <InferredBadge />}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: "var(--ms-font-mono)", color: "var(--ms-text-2)" }}>
                          {ent.kind} • {ent.iri}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--ms-font-mono)",
                        color: "var(--ms-text-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "45%",
                      }}
                    >
                      {ent.summary}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 5: KNOWLEDGE GRAPH & TAXONOMY SVG ───────────────────────────── */}
      {activeTab === "graph" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "6px 10px",
              borderBottom: "1px solid var(--ms-border)",
              background: "var(--ms-bg-alt)",
            }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  { id: "kg", label: "Interactive Knowledge Graph" },
                  { id: "taxonomy", label: "Class Taxonomy SVG" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setGraphSubMode(m.id)}
                  style={{
                    padding: "3px 9px",
                    fontSize: 11,
                    fontWeight: graphSubMode === m.id ? 700 : 500,
                    borderRadius: 5,
                    cursor: "pointer",
                    border: graphSubMode === m.id ? "1px solid var(--ms-brand, #0969da)" : "1px solid var(--ms-border)",
                    background: graphSubMode === m.id ? "rgba(56, 189, 248, 0.14)" : "transparent",
                    color: "var(--ms-text)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)" }}>
              {materializedKb.triples.length} triples ({materializedKb.inferredTripleKeys.size} inferred)
            </span>
          </div>

          {graphSubMode === "kg" ? (
            <Owl2KnowledgeGraph
              graph={fullKg}
              colorMode={colorMode}
              showInferred={showInferred}
              onRevealLine={host.onRevealLine}
              emptyMessage="Add classes, individuals, or axioms to explore the interactive OWL 2 Knowledge Graph."
            />
          ) : (
            <PanelSvgStage
              svg={graphSvg}
              onRevealLine={host.onRevealLine}
              emptyMessage="Add Declaration(Class(:...)) and SubClassOf(...) axioms to render the OWL 2 taxonomy."
            />
          )}
        </div>
      )}

      {/* ── TAB 6: EMBEDDED SPARQL 1.1 & DL QUERY BROWSER ───────────────────── */}
      {activeTab === "query" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Mode Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "7px 12px",
              borderBottom: "1px solid var(--ms-border)",
              background: "var(--ms-bg-alt)",
            }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  { id: "sparql", label: "SPARQL 1.1 Engine" },
                  { id: "dl", label: "DL Query Shortcuts" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setQueryMode(m.id)}
                  style={{
                    padding: "3px 9px",
                    fontSize: 11,
                    fontWeight: queryMode === m.id ? 700 : 500,
                    borderRadius: 5,
                    cursor: "pointer",
                    border: queryMode === m.id ? "1px solid var(--ms-brand, #0969da)" : "1px solid var(--ms-border)",
                    background: queryMode === m.id ? "rgba(56, 189, 248, 0.14)" : "transparent",
                    color: "var(--ms-text)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 10, color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)" }}>
              @modelscript/sparql • {showInferred ? "Asserted + Inferred KB" : "Asserted KB Only"} (
              {materializedKb.quads.length} quads)
            </span>
          </div>

          {queryMode === "sparql" ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* SPARQL Editor + Presets */}
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--ms-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {[
                    {
                      label: "All Types (Inferred)",
                      q: "SELECT ?individual ?class WHERE {\n  ?individual a ?class .\n  ?class a owl:Class .\n} ORDER BY ?individual",
                    },
                    {
                      label: "Class Hierarchy",
                      q: "SELECT ?subClass ?superClass WHERE {\n  ?subClass rdfs:subClassOf ?superClass .\n} ORDER BY ?subClass",
                    },
                    {
                      label: "Transitive Ancestors (+)",
                      q: `SELECT ?sub ?ancestor WHERE {\n  ?sub rdfs:subClassOf+ ?ancestor .\n} LIMIT 50`,
                    },
                    {
                      label: "Role Assertions",
                      q: "SELECT ?subject ?property ?object WHERE {\n  ?subject ?property ?object .\n  ?property a owl:ObjectProperty .\n}",
                    },
                    {
                      label: "CONSTRUCT Graph",
                      q: "CONSTRUCT { ?s ?p ?o }\nWHERE {\n  ?s ?p ?o .\n  FILTER(?p != rdf:type || ?o != owl:Class)\n} LIMIT 60",
                    },
                    {
                      label: "Count by Class",
                      q: "SELECT ?class (COUNT(?ind) AS ?count) WHERE {\n  ?ind a ?class .\n  ?class a owl:Class .\n} GROUP BY ?class",
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setSparqlQuery(preset.q);
                        void runSparql(preset.q);
                      }}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: 10.5,
                        cursor: "pointer",
                        border: "1px solid var(--ms-border)",
                        background: "var(--ms-bg-alt)",
                        color: "var(--ms-text)",
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={sparqlQuery}
                  onChange={(e) => setSparqlQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      void runSparql();
                    }
                  }}
                  rows={4}
                  spellCheck={false}
                  placeholder="SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 50"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 10px",
                    fontSize: 12,
                    fontFamily: "var(--ms-font-mono)",
                    borderRadius: 6,
                    border: "1px solid var(--ms-border)",
                    background: "var(--ms-bg)",
                    color: "var(--ms-text)",
                    resize: "vertical",
                    outline: "none",
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PanelButton variant="primary" onClick={() => void runSparql()} disabled={sparqlBusy}>
                      {sparqlBusy ? "Running..." : "Run SPARQL (⌘↵)"}
                    </PanelButton>
                    {sparqlResult && (
                      <span style={{ fontSize: 11, color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)" }}>
                        {sparqlResult.formattedSummary}
                      </span>
                    )}
                  </div>

                  {/* Result View Switcher + Export */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {(["table", "graph", "triples"] as const).map((rv) => (
                      <button
                        key={rv}
                        type="button"
                        onClick={() => setSparqlResultView(rv)}
                        style={{
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: sparqlResultView === rv ? 700 : 500,
                          borderRadius: 5,
                          cursor: "pointer",
                          textTransform: "capitalize",
                          border:
                            sparqlResultView === rv
                              ? "1px solid var(--ms-brand, #0969da)"
                              : "1px solid var(--ms-border)",
                          background: sparqlResultView === rv ? "rgba(56, 189, 248, 0.14)" : "transparent",
                          color: "var(--ms-text)",
                        }}
                      >
                        {rv}
                      </button>
                    ))}
                    {sparqlResult && host.exportFile && (
                      <PanelButton
                        onClick={() => {
                          const csvHeader = sparqlResult.variables.join(",");
                          const csvRows = sparqlResult.rows.map((r) =>
                            sparqlResult.variables.map((v) => `"${(r[v]?.value ?? "").replace(/"/g, '""')}"`).join(","),
                          );
                          host.exportFile?.("sparql-results.csv", [csvHeader, ...csvRows].join("\n"), "text/csv");
                        }}
                      >
                        CSV
                      </PanelButton>
                    )}
                  </div>
                </div>

                {sparqlError && (
                  <div
                    style={{
                      padding: "7px 10px",
                      borderRadius: 6,
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#ef4444",
                      fontSize: 11,
                      fontFamily: "var(--ms-font-mono)",
                    }}
                  >
                    {sparqlError}
                  </div>
                )}
              </div>

              {/* Results Surface: Table | Interactive Cytoscape-style Graph | Triples */}
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {!sparqlResult && sparqlResultView !== "triples" ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 20,
                      fontSize: 12,
                      color: "var(--ms-text-2)",
                      textAlign: "center",
                    }}
                  >
                    Click a preset chip or press <strong>Run SPARQL</strong> to query the reasoned OWL 2 knowledge base
                    using <code>@modelscript/sparql</code>.
                    <br />
                    Standard prefixes (<code>:</code>, <code>rdf:</code>, <code>rdfs:</code>, <code>owl:</code>,{" "}
                    <code>xsd:</code>) are injected automatically.
                  </div>
                ) : sparqlResultView === "graph" ? (
                  <Owl2KnowledgeGraph
                    graph={sparqlResult && sparqlResult.graph.nodes.length > 0 ? sparqlResult.graph : fullKg}
                    colorMode={colorMode}
                    showInferred={showInferred}
                    onRevealLine={host.onRevealLine}
                    emptyMessage="Run a SELECT or CONSTRUCT query returning URI relationships to visualize the result subgraph."
                  />
                ) : sparqlResultView === "triples" ? (
                  <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 11,
                        fontFamily: "var(--ms-font-mono)",
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: "1px solid var(--ms-border)",
                            textAlign: "left",
                            color: "var(--ms-text-2)",
                          }}
                        >
                          <th style={{ padding: "5px 6px" }}>Subject</th>
                          <th style={{ padding: "5px 6px" }}>Predicate</th>
                          <th style={{ padding: "5px 6px" }}>Object</th>
                          <th style={{ padding: "5px 6px" }}>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sparqlResult && sparqlResult.triples.length > 0
                          ? sparqlResult.triples
                          : materializedKb.triples
                        )
                          .slice(0, 300)
                          .map((t, idx) => (
                            <tr
                              key={idx}
                              style={{
                                borderBottom: "1px solid var(--ms-border)",
                                background: t.inferred ? "rgba(245, 158, 11, 0.06)" : "transparent",
                              }}
                            >
                              <td style={{ padding: "5px 6px" }} title={t.subject}>
                                {shortOwlLabel(t.subject)}
                              </td>
                              <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }} title={t.predicate}>
                                {shortOwlLabel(t.predicate)}
                              </td>
                              <td style={{ padding: "5px 6px" }} title={t.object}>
                                {t.objectType === "uri" ? shortOwlLabel(t.object) : `"${t.object}"`}
                              </td>
                              <td style={{ padding: "5px 6px" }}>
                                {t.inferred ? (
                                  <InferredBadge />
                                ) : (
                                  <span style={{ fontSize: 10, color: "var(--ms-text-2)" }}>asserted</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
                    {sparqlResult && sparqlResult.rows.length === 0 ? (
                      <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--ms-text-2)" }}>
                        Query returned 0 bindings.
                      </div>
                    ) : (
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 11.5,
                          fontFamily: "var(--ms-font-mono)",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: "1px solid var(--ms-border)",
                              textAlign: "left",
                              color: "var(--ms-text-2)",
                            }}
                          >
                            <th style={{ padding: "6px 8px", width: 32 }}>#</th>
                            {sparqlResult?.variables.map((v) => (
                              <th key={v} style={{ padding: "6px 8px" }}>
                                ?{v}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sparqlResult?.rows.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: "1px solid var(--ms-border)" }}>
                              <td style={{ padding: "5px 8px", color: "var(--ms-text-2)", fontSize: 10 }}>{idx + 1}</td>
                              {sparqlResult.variables.map((v) => {
                                const cell = row[v];
                                if (!cell)
                                  return (
                                    <td key={v} style={{ padding: "5px 8px", color: "var(--ms-text-2)" }}>
                                      —
                                    </td>
                                  );
                                return (
                                  <td key={v} style={{ padding: "5px 8px" }} title={cell.value}>
                                    {cell.type === "uri" ? (
                                      <span
                                        style={{
                                          color: "var(--ms-brand, #38bdf8)",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {cell.label}
                                      </span>
                                    ) : (
                                      <span>
                                        {cell.label}
                                        {cell.datatype && (
                                          <span style={{ fontSize: 9.5, color: "var(--ms-text-2)", marginLeft: 4 }}>
                                            ^^{shortOwlLabel(cell.datatype)}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* DL Query Shortcuts Mode */
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={dlQuery}
                  onChange={(e) => setDlQuery(e.target.value)}
                  placeholder={`e.g. subclasses(${firstClassSample}), instances(${firstClassSample}), unsatisfiable()`}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontFamily: "var(--ms-font-mono)",
                    borderRadius: 6,
                    border: "1px solid var(--ms-border)",
                    background: "var(--ms-bg)",
                    color: "var(--ms-text)",
                    outline: "none",
                  }}
                />
                <PanelButton onClick={() => setDlQuery("")} disabled={!dlQuery}>
                  Clear
                </PanelButton>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  `subclasses(${firstClassSample})`,
                  `superclasses(${firstClassSample})`,
                  `instances(${firstClassSample})`,
                  ...(firstIndSample ? [`types(${firstIndSample})`] : []),
                  "unsatisfiable()",
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setDlQuery(sample)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontFamily: "var(--ms-font-mono)",
                      cursor: "pointer",
                      border: "1px solid var(--ms-border)",
                      background: "var(--ms-bg-alt)",
                      color: "var(--ms-text-2)",
                    }}
                  >
                    {sample}
                  </button>
                ))}
              </div>

              <SectionCard title={dlQueryResult.title} count={dlQueryResult.matches.length}>
                {dlQueryResult.note && (
                  <div style={{ fontSize: 11, color: "var(--ms-text-2)" }}>{dlQueryResult.note}</div>
                )}
                {dlQueryResult.matches.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ms-text-2)" }}>No matching entities.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {dlQueryResult.matches.map((m, idx) => (
                      <EntityChip
                        key={`${m.iri}-${idx}`}
                        iri={m.iri}
                        kind={m.kind}
                        inferred={m.inferred}
                        onClick={() => navigateToEntity(m.iri, m.kind)}
                      />
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default Owl2Panel;
