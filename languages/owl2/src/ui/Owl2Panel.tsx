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
import React, { useMemo, useState } from "react";

type Owl2TabId = "graph" | "classes" | "properties" | "individuals";

interface Owl2ParsedSummary {
  ontologyIri?: string | undefined;
  classes: { name: string; line: number; parents: string[] }[];
  objectProperties: { name: string; line: number; domain?: string; range?: string }[];
  dataProperties: { name: string; line: number; domain?: string; range?: string }[];
  individuals: { name: string; line: number; types: string[] }[];
  subClassEdges: { child: string; parent: string; line: number }[];
}

function cleanTerm(raw: string): string {
  return raw
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/^.*[#:/]/, "");
}

function parseOwl2Text(code: string): Owl2ParsedSummary {
  const lines = code.split(/\r?\n/);
  const classMap = new Map<string, { name: string; line: number; parents: Set<string> }>();
  const objPropMap = new Map<string, { name: string; line: number; domain?: string; range?: string }>();
  const dataPropMap = new Map<string, { name: string; line: number; domain?: string; range?: string }>();
  const indMap = new Map<string, { name: string; line: number; types: Set<string> }>();
  const subClassEdges: { child: string; parent: string; line: number }[] = [];
  let ontologyIri: string | undefined;

  const ensureClass = (raw: string, line: number) => {
    const name = cleanTerm(raw);
    if (!name || name === "Thing" || name === "Nothing") return name;
    if (!classMap.has(name)) {
      classMap.set(name, { name, line, parents: new Set() });
    }
    return name;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const l = lines[i]!.trim();
    if (!l || l.startsWith("#") || l.startsWith("//")) continue;

    if (!ontologyIri) {
      const ontoMatch = /Ontology\s*\(\s*<([^>]+)>/i.exec(l);
      if (ontoMatch) ontologyIri = ontoMatch[1];
    }

    const declClass = /Declaration\s*\(\s*Class\s*\(\s*([^\s)]+)\s*\)\s*\)/i.exec(l);
    if (declClass) ensureClass(declClass[1]!, lineNum);

    const declObj = /Declaration\s*\(\s*ObjectProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/i.exec(l);
    if (declObj) {
      const name = cleanTerm(declObj[1]!);
      if (name && !objPropMap.has(name)) objPropMap.set(name, { name, line: lineNum });
    }

    const declData = /Declaration\s*\(\s*DataProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/i.exec(l);
    if (declData) {
      const name = cleanTerm(declData[1]!);
      if (name && !dataPropMap.has(name)) dataPropMap.set(name, { name, line: lineNum });
    }

    const declInd = /Declaration\s*\(\s*NamedIndividual\s*\(\s*([^\s)]+)\s*\)\s*\)/i.exec(l);
    if (declInd) {
      const name = cleanTerm(declInd[1]!);
      if (name && !indMap.has(name)) indMap.set(name, { name, line: lineNum, types: new Set() });
    }

    const subClass = /SubClassOf\s*\(\s*([^\s()]+)\s+([^\s()]+)\s*\)/i.exec(l);
    if (subClass) {
      const child = ensureClass(subClass[1]!, lineNum);
      const parent = ensureClass(subClass[2]!, lineNum);
      if (child && parent && child !== parent) {
        classMap.get(child)?.parents.add(parent);
        subClassEdges.push({ child, parent, line: lineNum });
      }
    }

    const classAssertion = /ClassAssertion\s*\(\s*([^\s()]+)\s+([^\s()]+)\s*\)/i.exec(l);
    if (classAssertion) {
      const cls = ensureClass(classAssertion[1]!, lineNum);
      const ind = cleanTerm(classAssertion[2]!);
      if (ind) {
        if (!indMap.has(ind)) indMap.set(ind, { name: ind, line: lineNum, types: new Set() });
        if (cls) indMap.get(ind)!.types.add(cls);
      }
    }

    const objDomain = /ObjectPropertyDomain\s*\(\s*([^\s()]+)\s+([^\s()]+)\s*\)/i.exec(l);
    if (objDomain) {
      const p = cleanTerm(objDomain[1]!);
      const d = cleanTerm(objDomain[2]!);
      if (p) {
        const entry = objPropMap.get(p) ?? { name: p, line: lineNum };
        entry.domain = d;
        objPropMap.set(p, entry);
      }
    }

    const objRange = /ObjectPropertyRange\s*\(\s*([^\s()]+)\s+([^\s()]+)\s*\)/i.exec(l);
    if (objRange) {
      const p = cleanTerm(objRange[1]!);
      const r = cleanTerm(objRange[2]!);
      if (p) {
        const entry = objPropMap.get(p) ?? { name: p, line: lineNum };
        entry.range = r;
        objPropMap.set(p, entry);
      }
    }
  }

  return {
    ontologyIri,
    classes: Array.from(classMap.values()).map((c) => ({ name: c.name, line: c.line, parents: Array.from(c.parents) })),
    objectProperties: Array.from(objPropMap.values()),
    dataProperties: Array.from(dataPropMap.values()),
    individuals: Array.from(indMap.values()).map((ind) => ({
      name: ind.name,
      line: ind.line,
      types: Array.from(ind.types),
    })),
    subClassEdges,
  };
}

function renderOwl2TaxonomySvg(summary: Owl2ParsedSummary): string {
  if (summary.classes.length === 0) return "";

  // Compute topological depth for clean layered hierarchy layout
  const depthMap = new Map<string, number>();
  const parentLookup = new Map<string, string[]>();
  for (const c of summary.classes) parentLookup.set(c.name, c.parents);

  const getDepth = (name: string, visited = new Set<string>()): number => {
    if (depthMap.has(name)) return depthMap.get(name)!;
    if (visited.has(name)) return 0;
    visited.add(name);
    const parents = parentLookup.get(name) ?? [];
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => getDepth(p, visited)));
    depthMap.set(name, d);
    return d;
  };

  const layers = new Map<number, typeof summary.classes>();
  for (const c of summary.classes.slice(0, 60)) {
    const d = getDepth(c.name);
    const arr = layers.get(d) ?? [];
    arr.push(c);
    layers.set(d, arr);
  }

  const nodeW = 148;
  const nodeH = 34;
  const gapX = 28;
  const gapY = 64;
  const positions = new Map<string, { x: number; y: number; line: number }>();

  let maxCols = 1;
  for (const arr of layers.values()) maxCols = Math.max(maxCols, arr.length);
  const totalWidth = Math.max(520, maxCols * (nodeW + gapX) + 60);
  const maxDepth = Math.max(0, ...Array.from(layers.keys()));
  const totalHeight = Math.max(280, (maxDepth + 1) * (nodeH + gapY) + 60);

  for (const [depth, arr] of layers.entries()) {
    const rowWidth = arr.length * nodeW + Math.max(0, arr.length - 1) * gapX;
    const startX = (totalWidth - rowWidth) / 2;
    const y = 36 + depth * (nodeH + gapY);
    arr.forEach((cls, idx) => {
      positions.set(cls.name, { x: startX + idx * (nodeW + gapX), y, line: cls.line });
    });
  }

  const edgesSvg = summary.subClassEdges
    .map((e) => {
      const from = positions.get(e.child);
      const to = positions.get(e.parent);
      if (!from || !to) return "";
      const x1 = from.x + nodeW / 2;
      const y1 = from.y;
      const x2 = to.x + nodeW / 2;
      const y2 = to.y + nodeH;
      const midY = (y1 + y2) / 2;
      return `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="#38bdf8" stroke-width="1.6" marker-end="url(#owl-arrow)" data-line="${e.line}"/>`;
    })
    .join("");

  const nodesSvg = Array.from(positions.entries())
    .map(([name, pos]) => {
      const label = name.length > 18 ? `${name.slice(0, 17)}…` : name;
      return `<g data-line="${pos.line}" data-id="${name}" style="cursor:pointer;">
        <rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="7" fill="#1e293b" stroke="#0891b2" stroke-width="1.4"/>
        <text x="${pos.x + nodeW / 2}" y="${pos.y + 21}" text-anchor="middle" fill="#e2e8f0" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600">${label}</text>
      </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="max-height:100%;">
  <defs>
    <marker id="owl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="none" stroke="#38bdf8" stroke-width="1.4"/>
    </marker>
  </defs>
  <g>${edgesSvg}</g>
  <g>${nodesSvg}</g>
</svg>`;
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
  const [activeTab, setActiveTab] = useState<Owl2TabId>("graph");

  const summary = useMemo(() => parseOwl2Text(code), [code]);
  const graphSvg = useMemo(() => renderOwl2TaxonomySvg(summary), [summary]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (summary.ontologyIri ? cleanTerm(summary.ontologyIri) : "OWL 2 Ontology");

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Classes", value: summary.classes.length, tone: "info" },
      { label: "SubClassOf", value: summary.subClassEdges.length },
      { label: "Object Props", value: summary.objectProperties.length },
      { label: "Data Props", value: summary.dataProperties.length },
      { label: "Individuals", value: summary.individuals.length, tone: "success" },
    ],
    [summary],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={summary.ontologyIri ?? "OWL 2 Functional Syntax"}
        badge={{ label: "OWL 2", tone: "info" }}
        actions={
          <>
            {activeTab === "graph" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("owl2-taxonomy.svg", graphSvg, "image/svg+xml")}
                disabled={!graphSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "owl2", title)}>
                Open in Morsel
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
          { id: "graph", label: "Taxonomy Graph" },
          { id: "classes", label: "Classes", count: summary.classes.length },
          {
            id: "properties",
            label: "Properties",
            count: summary.objectProperties.length + summary.dataProperties.length,
          },
          { id: "individuals", label: "Individuals", count: summary.individuals.length },
        ]}
      />

      {activeTab === "graph" && (
        <PanelSvgStage
          svg={graphSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage="Add Declaration(Class(:...)) and SubClassOf(...) axioms to render the OWL 2 taxonomy."
        />
      )}

      {activeTab === "classes" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {summary.classes.map((cls) => (
            <div
              key={cls.name}
              onClick={() => host.onRevealLine?.(cls.line, cls.name)}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: host.onRevealLine ? "pointer" : "default",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600 }}>{cls.name}</span>
              <span style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}>
                {cls.parents.length > 0 ? `⊑ ${cls.parents.join(", ")}` : "owl:Thing"}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "properties" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {summary.objectProperties.map((p) => (
            <div
              key={`obj-${p.name}`}
              onClick={() => host.onRevealLine?.(p.line, p.name)}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: host.onRevealLine ? "pointer" : "default",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}>
                ObjectProperty {p.domain || p.range ? `(${p.domain ?? "?"} → ${p.range ?? "?"})` : ""}
              </span>
            </div>
          ))}
          {summary.dataProperties.map((p) => (
            <div
              key={`data-${p.name}`}
              onClick={() => host.onRevealLine?.(p.line, p.name)}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: host.onRevealLine ? "pointer" : "default",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}>
                DataProperty
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "individuals" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {summary.individuals.map((ind) => (
            <div
              key={ind.name}
              onClick={() => host.onRevealLine?.(ind.line, ind.name)}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: host.onRevealLine ? "pointer" : "default",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600 }}>{ind.name}</span>
              <span style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}>
                {ind.types.length > 0 ? `: ${ind.types.join(", ")}` : "NamedIndividual"}
              </span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default Owl2Panel;
