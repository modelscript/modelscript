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
import { renderStlMeshSvg, type StlProjectionView } from "../diagram/index.js";
import { lintStl } from "../lints/index.js";
import { parseAsciiStl } from "../parser/ascii-parser.js";
import { stlToObj, stlToStep } from "../projections/index.js";
import { analyzeStlTopology, computeStlMassProperties } from "../solver/index.js";

type StlTabId = "mesh" | "mass" | "topology" | "diagnostics";

const VIEWS: readonly StlProjectionView[] = ["iso", "xy", "xz", "yz"];

export const StlPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<StlTabId>("mesh");
  const [view, setView] = useState<StlProjectionView>("iso");
  const [wireframe, setWireframe] = useState<boolean>(false);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        props: null,
        topo: null,
        lints: [] as ReturnType<typeof lintStl>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseAsciiStl(code);
      const props = computeStlMassProperties(doc);
      const topo = analyzeStlTopology(doc);
      const lints = lintStl(doc);
      return { doc, props, topo, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        props: null,
        topo: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.solids[0]?.name ||
    "STL 3D Mesh";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderStlMeshSvg(computed.doc, { view, wireframe });
    } catch {
      return "";
    }
  }, [computed.doc, view, wireframe]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const tris = computed.doc?.facets.length ?? 0;
    const vol = computed.props ? computed.props.volume.toPrecision(4) : "—";
    const area = computed.props ? computed.props.surfaceArea.toPrecision(4) : "—";
    const watertight = computed.topo ? (computed.topo.isWatertight ? "Watertight" : "Open") : "—";
    const diagCount = computed.lints.length;
    return [
      { label: "Triangles", value: tris, tone: "info" },
      { label: "Volume", value: vol },
      { label: "Area", value: area },
      { label: "Shell", value: watertight, tone: computed.topo?.isWatertight ? "success" : "warning" },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, computed.props, computed.topo, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="3D Systems STL Stereolithography"
        badge={
          computed.error
            ? { label: "Parse Error", tone: "danger" }
            : computed.topo?.isWatertight
              ? { label: "STL · Manifold", tone: "success" }
              : { label: "STL", tone: "info" }
        }
        actions={
          <>
            {activeTab === "mesh" && (
              <>
                {VIEWS.map((v) => (
                  <PanelButton key={v} variant={view === v ? "primary" : "default"} onClick={() => setView(v)}>
                    {v.toUpperCase()}
                  </PanelButton>
                ))}
                <PanelButton variant={wireframe ? "primary" : "default"} onClick={() => setWireframe((w) => !w)}>
                  {wireframe ? "Shaded" : "Wireframe"}
                </PanelButton>
              </>
            )}
            {host.exportFile && computed.doc && (
              <>
                <PanelButton onClick={() => host.exportFile?.(`${title}.svg`, svg, "image/svg+xml")} disabled={!svg}>
                  SVG
                </PanelButton>
                <PanelButton
                  onClick={() =>
                    computed.doc && host.exportFile?.(`${title}.obj`, stlToObj(computed.doc), "text/plain")
                  }
                >
                  OBJ
                </PanelButton>
                <PanelButton
                  onClick={() =>
                    computed.doc && host.exportFile?.(`${title}.step`, stlToStep(computed.doc), "application/step")
                  }
                >
                  STEP
                </PanelButton>
              </>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "stl", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<StlTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "mesh", label: "3D Viewport" },
          { id: "mass", label: "Mass Properties" },
          { id: "topology", label: "Topology" },
          { id: "diagnostics", label: "Diagnostics", count: computed.lints.length },
        ]}
      />

      {activeTab === "mesh" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an ASCII STL (.stl) mesh to render the 3D viewport."}
        />
      )}

      {activeTab === "mass" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.props ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>Property</th>
                  <th style={{ padding: "5px 6px" }}>Value</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--ms-font-mono)" }}>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Signed Volume</td>
                  <td style={{ padding: "4px 6px" }}>{computed.props.signedVolume.toPrecision(8)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Surface Area</td>
                  <td style={{ padding: "4px 6px" }}>{computed.props.surfaceArea.toPrecision(8)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Centroid (x, y, z)</td>
                  <td style={{ padding: "4px 6px" }}>
                    ({computed.props.centroid.map((c) => c.toPrecision(6)).join(", ")})
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Inertia Diagonal (Ixx, Iyy, Izz)</td>
                  <td style={{ padding: "4px 6px" }}>
                    ({computed.props.inertiaTensor[0][0].toPrecision(6)},{" "}
                    {computed.props.inertiaTensor[1][1].toPrecision(6)},{" "}
                    {computed.props.inertiaTensor[2][2].toPrecision(6)})
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Bounding Box Min</td>
                  <td style={{ padding: "4px 6px" }}>
                    ({computed.props.boundingBox.min.map((v) => v.toPrecision(6)).join(", ")})
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Bounding Box Max</td>
                  <td style={{ padding: "4px 6px" }}>
                    ({computed.props.boundingBox.max.map((v) => v.toPrecision(6)).join(", ")})
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div style={{ color: "var(--ms-text-2)" }}>No mesh loaded.</div>
          )}
        </div>
      )}

      {activeTab === "topology" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.topo ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <tbody style={{ fontFamily: "var(--ms-font-mono)" }}>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Welded Vertices (V)</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.vertexCount}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Unique Edges (E)</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.edgeCount}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Triangular Faces (F)</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.faceCount}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Euler Characteristic (V - E + F)</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.eulerCharacteristic}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Open Boundary Edges</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.openBoundaryEdges}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Non-Manifold Edges</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.nonManifoldEdges}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px" }}>Watertight</td>
                  <td style={{ padding: "4px 6px" }}>{computed.topo.isWatertight ? "Yes" : "No"}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div style={{ color: "var(--ms-text-2)" }}>No mesh loaded.</div>
          )}
        </div>
      )}

      {activeTab === "diagnostics" && (
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
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No STL manifold or geometry diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}]
                </span>
                <span>{d.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default StlPanel;
