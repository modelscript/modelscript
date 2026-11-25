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
import { parseInpDeck } from "../dialects/inp.js";
import type { FeaModelData } from "../types.js";

type FeaTabId = "mesh" | "materials" | "boundaries" | "steps";

function renderFeaIsometricSvg(model: FeaModelData, yawDeg: number, pitchDeg: number): string {
  const nodes = Array.from(model.nodes.values());
  if (nodes.length === 0) return "";

  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const projected = new Map<number, { sx: number; sy: number; depth: number }>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const x1 = n.x * cy - n.z * sy;
    const z1 = n.x * sy + n.z * cy;
    const y2 = n.y * cp - z1 * sp;
    const z2 = n.y * sp + z1 * cp;
    projected.set(n.id, { sx: x1, sy: -y2, depth: z2 });
    if (x1 < minX) minX = x1;
    if (x1 > maxX) maxX = x1;
    if (-y2 < minY) minY = -y2;
    if (-y2 > maxY) maxY = -y2;
  }

  const width = 720;
  const height = 440;
  const pad = 48;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const cx = (minX + maxX) / 2;
  const cyMid = (minY + maxY) / 2;
  const mapX = (x: number) => width / 2 + (x - cx) * scale;
  const mapY = (y: number) => height / 2 + (y - cyMid) * scale;

  const edgeLines: string[] = [];
  const seenEdges = new Set<string>();
  const elements = Array.from(model.elements.values()).slice(0, 1200);
  for (const el of elements) {
    const nids = el.nodes;
    for (let i = 0; i < nids.length; i++) {
      const a = nids[i]!;
      const b = nids[(i + 1) % nids.length]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const pa = projected.get(a);
      const pb = projected.get(b);
      if (!pa || !pb) continue;
      const lineAttr = model.elementLines?.get(el.id);
      edgeLines.push(
        `<line x1="${mapX(pa.sx).toFixed(1)}" y1="${mapY(pa.sy).toFixed(1)}" x2="${mapX(pb.sx).toFixed(1)}" y2="${mapY(pb.sy).toFixed(1)}" stroke="#38bdf8" stroke-opacity="0.65" stroke-width="1.1"${lineAttr ? ` data-line="${lineAttr}"` : ""}/>`,
      );
    }
  }

  const nodeCircles: string[] = [];
  for (const n of nodes.slice(0, 800)) {
    const p = projected.get(n.id);
    if (!p) continue;
    const isFixed = model.fixedNodes.has(n.id);
    const hasLoad = model.nodalLoads.has(n.id);
    const fill = hasLoad ? "#f43f5e" : isFixed ? "#22c55e" : "#94a3b8";
    const r = hasLoad || isFixed ? 4.2 : 2.1;
    const lineAttr = model.nodeLines?.get(n.id);
    nodeCircles.push(
      `<circle cx="${mapX(p.sx).toFixed(1)}" cy="${mapY(p.sy).toFixed(1)}" r="${r}" fill="${fill}"${lineAttr ? ` data-line="${lineAttr}"` : ""}><title>Node ${n.id} (${n.x}, ${n.y}, ${n.z})${isFixed ? " [FIXED]" : ""}${hasLoad ? " [LOAD]" : ""}</title></circle>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="max-height:100%;">
  <rect width="${width}" height="${height}" fill="transparent"/>
  <g>${edgeLines.join("")}</g>
  <g>${nodeCircles.join("")}</g>
  <g font-family="ui-monospace, monospace" font-size="11" fill="#94a3b8">
    <circle cx="24" cy="24" r="4" fill="#22c55e"/><text x="34" y="28">Fixed BC (${model.fixedNodes.size})</text>
    <circle cx="150" cy="24" r="4" fill="#f43f5e"/><text x="160" y="28">Nodal Load (${model.nodalLoads.size})</text>
  </g>
</svg>`;
}

export const FeaPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<FeaTabId>("mesh");
  const [yaw, setYaw] = useState(35);
  const [pitch, setPitch] = useState(25);

  const parsed = useMemo(() => {
    if (!code.trim()) return { model: null as FeaModelData | null, error: undefined as string | undefined };
    try {
      return { model: parseInpDeck(code), error: undefined };
    } catch (err) {
      return { model: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    parsed.model?.heading ||
    "FEA Structural Deck";

  const meshSvg = useMemo(() => {
    if (!parsed.model) return "";
    return renderFeaIsometricSvg(parsed.model, yaw, pitch);
  }, [parsed.model, yaw, pitch]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const m = parsed.model;
    return [
      { label: "Nodes", value: m?.nodes.size ?? 0, tone: "info" },
      { label: "Elements", value: m?.elements.size ?? 0 },
      { label: "Materials", value: m?.materials.size ?? 0 },
      { label: "Fixed Nodes", value: m?.fixedNodes.size ?? 0, tone: "success" },
      {
        label: "Nodal Loads",
        value: m?.nodalLoads.size ?? 0,
        tone: (m?.nodalLoads.size ?? 0) > 0 ? "warning" : "neutral",
      },
    ];
  }, [parsed.model]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={parsed.model?.dialect ? `Dialect: ${parsed.model.dialect}` : "FEA / CalculiX"}
        badge={parsed.error ? { label: "Parse Error", tone: "danger" } : { label: "FEA", tone: "info" }}
        actions={
          <>
            {activeTab === "mesh" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("fea-mesh.svg", meshSvg, "image/svg+xml")}
                disabled={!meshSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "fea", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<FeaTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "mesh", label: "3D Mesh Preview" },
          { id: "materials", label: "Materials", count: parsed.model?.materials.size ?? 0 },
          {
            id: "boundaries",
            label: "BCs & Loads",
            count: (parsed.model?.boundaries?.length ?? 0) + (parsed.model?.cloads?.length ?? 0),
          },
          { id: "steps", label: "Analysis Steps", count: parsed.model?.steps?.length ?? 0 },
        ]}
      />

      {activeTab === "mesh" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "5px 12px",
              borderBottom: "1px solid var(--ms-border)",
              background: "var(--ms-bg-alt)",
              fontSize: "11px",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Yaw {yaw}°
              <input type="range" min={-180} max={180} value={yaw} onChange={(e) => setYaw(Number(e.target.value))} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Pitch {pitch}°
              <input type="range" min={-89} max={89} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
            </label>
          </div>
          <PanelSvgStage
            svg={meshSvg}
            onRevealLine={host.onRevealLine}
            emptyMessage={parsed.error ?? "Provide an Abaqus/CalculiX .inp deck with *NODE and *ELEMENT cards."}
          />
        </>
      )}

      {activeTab === "materials" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Material</th>
                <th style={{ padding: "5px 6px" }}>Young&apos;s E (Pa)</th>
                <th style={{ padding: "5px 6px" }}>Poisson ν</th>
                <th style={{ padding: "5px 6px" }}>Density ρ</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(parsed.model?.materials.values() ?? []).map((mat) => {
                const line = parsed.model?.materialLines?.get(mat.name);
                return (
                  <tr
                    key={mat.name}
                    onClick={() => line && host.onRevealLine?.(line, mat.name)}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      cursor: line ? "pointer" : "default",
                      fontFamily: "var(--ms-font-mono)",
                    }}
                  >
                    <td style={{ padding: "5px 6px", fontWeight: 600 }}>{mat.name}</td>
                    <td style={{ padding: "5px 6px" }}>{mat.E?.toExponential(3) ?? "—"}</td>
                    <td style={{ padding: "5px 6px" }}>{mat.nu ?? "—"}</td>
                    <td style={{ padding: "5px 6px" }}>{mat.rho ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "boundaries" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ fontWeight: 600 }}>Boundary Constraints ({parsed.model?.boundaries?.length ?? 0})</div>
          {(parsed.model?.boundaries ?? []).map((b, i) => (
            <div
              key={`bc-${i}`}
              onClick={() => b.line && host.onRevealLine?.(b.line)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: b.line ? "pointer" : "default",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              Target: {String(b.target)} | DOFs: [{b.dofs.join(", ")}]{" "}
              {b.value !== undefined ? `= ${b.value}` : "(fixed)"}
            </div>
          ))}
          <div style={{ fontWeight: 600, marginTop: "6px" }}>
            Concentrated Loads ({parsed.model?.cloads?.length ?? 0})
          </div>
          {(parsed.model?.cloads ?? []).map((c, i) => (
            <div
              key={`cload-${i}`}
              onClick={() => c.line && host.onRevealLine?.(c.line)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                cursor: c.line ? "pointer" : "default",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              Target: {String(c.target)} | DOF {c.dof} | Magnitude: {c.magnitude}
            </div>
          ))}
        </div>
      )}

      {activeTab === "steps" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {(parsed.model?.steps ?? []).length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No *STEP analysis definitions found.</div>
          ) : (
            (parsed.model?.steps ?? []).map((st, idx) => (
              <div
                key={`step-${idx}`}
                onClick={() => st.line && host.onRevealLine?.(st.line)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: st.line ? "pointer" : "default",
                }}
              >
                <div style={{ fontWeight: 600 }}>{st.name || `Step ${idx + 1}`}</div>
                <div style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", marginTop: "2px" }}>
                  Type: {st.analysisType} {st.nlgeom ? "| NLGEOM=YES" : ""}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default FeaPanel;
