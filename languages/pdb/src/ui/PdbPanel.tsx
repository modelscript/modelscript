// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parsePdb } from "../parser/pdb-parser.js";
import type { PdbDocument } from "../types.js";

type PdbTabId = "backbone" | "chains" | "residues";

function renderPdbBackboneSvg(doc: PdbDocument, yawDeg: number): string {
  const caAtoms = (doc.atoms ?? []).filter((a) => a.name.trim() === "CA");
  const pts = caAtoms.length > 0 ? caAtoms : (doc.atoms ?? []).slice(0, 600);
  if (pts.length === 0) return "";

  const yaw = (yawDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  const projected = pts.map((a) => ({
    a,
    sx: a.x * cy - a.z * sy,
    sy: -a.y,
  }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of projected) {
    if (p.sx < minX) minX = p.sx;
    if (p.sx > maxX) maxX = p.sx;
    if (p.sy < minY) minY = p.sy;
    if (p.sy > maxY) maxY = p.sy;
  }

  const width = 700;
  const height = 420;
  const pad = 40;
  const scale = Math.min(
    (width - pad * 2) / Math.max(1e-6, maxX - minX),
    (height - pad * 2) / Math.max(1e-6, maxY - minY),
  );
  const cx = (minX + maxX) / 2;
  const cyMid = (minY + maxY) / 2;
  const mx = (x: number) => width / 2 + (x - cx) * scale;
  const my = (y: number) => height / 2 + (y - cyMid) * scale;

  const chainColors = ["#38bdf8", "#10b981", "#f59e0b", "#f43f5e", "#a855f7", "#06b6d4"];
  const chainOrder = new Map<string, string>();
  const getColor = (chainId: string) => {
    if (!chainOrder.has(chainId)) {
      chainOrder.set(chainId, chainColors[chainOrder.size % chainColors.length]!);
    }
    return chainOrder.get(chainId)!;
  };

  const segments: string[] = [];
  for (let i = 1; i < projected.length; i++) {
    const prev = projected[i - 1]!;
    const curr = projected[i]!;
    if (prev.a.chainId !== curr.a.chainId) continue;
    const col = getColor(curr.a.chainId);
    segments.push(
      `<line x1="${mx(prev.sx).toFixed(1)}" y1="${my(prev.sy).toFixed(1)}" x2="${mx(curr.sx).toFixed(1)}" y2="${my(curr.sy).toFixed(1)}" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>`,
    );
  }

  const dots = projected
    .slice(0, 600)
    .map((p) => {
      const col = getColor(p.a.chainId);
      return `<circle cx="${mx(p.sx).toFixed(1)}" cy="${my(p.sy).toFixed(1)}" r="2.8" fill="${col}"><title>${p.a.resName} ${p.a.chainId}:${p.a.resSeq} (${p.a.name})</title></circle>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="max-height:100%;">
  <g>${segments.join("")}</g>
  <g>${dots}</g>
</svg>`;
}

export const PdbPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<PdbTabId>("backbone");
  const [yaw, setYaw] = useState(25);

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null as PdbDocument | null, error: undefined as string | undefined };
    try {
      return { doc: parsePdb(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.title ||
    computed.doc?.id ||
    "PDB Macromolecular Structure";

  const svg = useMemo(() => (computed.doc ? renderPdbBackboneSvg(computed.doc, yaw) : ""), [computed.doc, yaw]);

  const chains = useMemo(() => {
    const map = new Map<string, { chainId: string; atoms: number; residues: Set<number> }>();
    for (const a of computed.doc?.atoms ?? []) {
      const id = a.chainId || "A";
      const entry = map.get(id) ?? { chainId: id, atoms: 0, residues: new Set<number>() };
      entry.atoms++;
      entry.residues.add(a.resSeq);
      map.set(id, entry);
    }
    return Array.from(map.values());
  }, [computed.doc]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Atoms", value: computed.doc?.atoms?.length ?? 0, tone: "info" },
      { label: "HETATM", value: computed.doc?.hetAtoms?.length ?? 0 },
      { label: "Chains", value: chains.length },
      { label: "Resolution", value: computed.doc?.resolution !== undefined ? `${computed.doc.resolution} Å` : "—" },
    ],
    [computed.doc, chains.length],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={computed.doc?.id ? `PDB ID: ${computed.doc.id}` : "RCSB PDB / mmCIF"}
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "PDB", tone: "info" }}
        actions={
          <>
            {activeTab === "backbone" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("pdb-backbone.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "pdb", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<PdbTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "backbone", label: "3D Cα Backbone" },
          { id: "chains", label: "Chains", count: chains.length },
          { id: "residues", label: "Atoms", count: computed.doc?.atoms?.length ?? 0 },
        ]}
      />

      {activeTab === "backbone" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "5px 12px",
              borderBottom: "1px solid var(--ms-border)",
              background: "var(--ms-bg-alt)",
              fontSize: "11px",
            }}
          >
            <span>Rotation {yaw}°</span>
            <input type="range" min={-180} max={180} value={yaw} onChange={(e) => setYaw(Number(e.target.value))} />
          </div>
          <PanelSvgStage
            svg={svg}
            onRevealLine={host.onRevealLine}
            emptyMessage={
              computed.error ?? "Load a PDB (.pdb / .cif) structure to inspect its macromolecular backbone."
            }
          />
        </>
      )}

      {activeTab === "chains" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Chain</th>
                <th style={{ padding: "5px 6px" }}>Residues</th>
                <th style={{ padding: "5px 6px" }}>Atoms</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((ch) => (
                <tr
                  key={ch.chainId}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{ch.chainId}</td>
                  <td style={{ padding: "4px 6px" }}>{ch.residues.size}</td>
                  <td style={{ padding: "4px 6px" }}>{ch.atoms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "residues" && (
        <PanelDataGrid
          rows={computed.doc?.atoms ?? []}
          columns={
            [
              {
                key: "serial",
                label: "Serial",
                align: "right",
                mono: true,
                sortValue: (a) => a.serial,
                render: (a) => a.serial,
              },
              {
                key: "name",
                label: "Atom",
                mono: true,
                sortValue: (a) => a.name,
                render: (a) => <strong>{a.name}</strong>,
              },
              {
                key: "residue",
                label: "Residue",
                mono: true,
                sortValue: (a) => `${a.resName} ${a.resSeq}`,
                render: (a) => `${a.resName} ${a.resSeq}`,
              },
              { key: "chainId", label: "Chain", mono: true, sortValue: (a) => a.chainId, render: (a) => a.chainId },
              {
                key: "coords",
                label: "Coords (Å)",
                mono: true,
                sortable: false,
                render: (a) => (
                  <span style={{ color: "var(--ms-text-2)" }}>
                    ({a.x.toFixed(1)}, {a.y.toFixed(1)}, {a.z.toFixed(1)})
                  </span>
                ),
              },
            ] as PanelDataGridColumn<NonNullable<typeof computed.doc>["atoms"][number]>[]
          }
          rowKey={(a, idx) => `${a.serial}-${idx}`}
          searchPlaceholder="Filter atoms by serial, name, residue, or chain…"
          emptyMessage="No PDB atoms parsed."
        />
      )}
    </PanelShell>
  );
};

export default PdbPanel;
