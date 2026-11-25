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
import { generateStandardEngineeringMtl } from "../catalog/obj-std-schemas.js";
import { renderObjMeshSvg, type ObjViewMode } from "../diagram/index.js";
import { lintMtl, lintObj } from "../lints/index.js";
import { parseMtl } from "../parser/mtl-parser.js";
import { parseObj } from "../parser/obj-parser.js";
import { objToAsciiStl } from "../projections/index.js";
import { computeMeshMetrics } from "../solver/index.js";
import type { MtlMaterial, RgbColor } from "../types.js";

type ObjTabId = "viewport" | "objects" | "materials" | "metrics" | "lints";

function rgbToHex(rgb?: RgbColor): string {
  if (!rgb) return "#94a3b8";
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

export const ObjPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  projectFiles,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<ObjTabId>("viewport");
  const [viewMode, setViewMode] = useState<ObjViewMode>("isometric");
  const [wireframe, setWireframe] = useState<boolean>(true);
  const [azimuthOffset, setAzimuthOffset] = useState<number>(0);

  const defaultMtlMap = useMemo(() => parseMtl(generateStandardEngineeringMtl()).materials, []);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        isMtl: false,
        obj: null,
        mtl: null,
        metrics: null,
        materials: new Map<string, MtlMaterial>(),
        lints: [] as ReturnType<typeof lintObj>,
        error: undefined as string | undefined,
      };
    }

    try {
      const looksLikeMtl = /^\s*newmtl\s+/m.test(code) && !/^\s*v\s+/m.test(code);
      if (looksLikeMtl) {
        const mtl = parseMtl(code);
        const lints = lintMtl(mtl);
        return {
          isMtl: true,
          obj: null,
          mtl,
          metrics: null,
          materials: mtl.materials,
          lints,
          error: undefined,
        };
      }

      const obj = parseObj(code);
      const metrics = computeMeshMetrics(obj);
      const lints = lintObj(obj);

      // Parse companion .mtl files from multi-file workspace first, then fall back to standard engineering materials
      const workspaceMats = new Map<string, MtlMaterial>();
      if (projectFiles) {
        for (const [fname, ftext] of Object.entries(projectFiles)) {
          if (fname.toLowerCase().endsWith(".mtl") && ftext.trim()) {
            try {
              const parsedMtl = parseMtl(ftext);
              for (const [mName, mVal] of parsedMtl.materials.entries()) {
                workspaceMats.set(mName, mVal);
              }
            } catch {
              // ignore malformed companion mtl
            }
          }
        }
      }

      const resolvedMats = new Map<string, MtlMaterial>();
      for (const u of obj.usedMaterials) {
        const mat = workspaceMats.get(u.name) ?? defaultMtlMap.get(u.name);
        if (mat) {
          resolvedMats.set(u.name, mat);
        }
      }
      if (resolvedMats.size > 0) {
        obj.materials = resolvedMats;
      }

      return {
        isMtl: false,
        obj,
        mtl: null,
        metrics,
        materials: resolvedMats,
        lints,
        error: undefined,
      };
    } catch (err) {
      return {
        isMtl: false,
        obj: null,
        mtl: null,
        metrics: null,
        materials: new Map<string, MtlMaterial>(),
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code, projectFiles, defaultMtlMap]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.obj?.objects[0]?.name ||
    (computed.isMtl ? "Wavefront MTL Library" : "Wavefront OBJ 3D Mesh");

  const svg = useMemo(() => {
    if (!computed.obj) return "";
    try {
      const baseAz = viewMode === "isometric" ? 38 : viewMode === "right" ? 90 : 0;
      const baseEl = viewMode === "isometric" ? 28 : viewMode === "top" ? 90 : 0;
      return renderObjMeshSvg(computed.obj, {
        view: viewMode,
        azimuthDeg: baseAz + azimuthOffset,
        elevationDeg: baseEl,
        wireframe,
        materials: computed.materials,
      });
    } catch {
      return "";
    }
  }, [computed.obj, computed.materials, viewMode, azimuthOffset, wireframe]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const diagCount = computed.lints.length;
    if (computed.isMtl) {
      return [
        { label: "Materials", value: computed.materials.size, tone: "info" },
        { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
      ];
    }
    const m = computed.metrics;
    return [
      { label: "Vertices", value: m?.vertexCount ?? 0, tone: "info" },
      { label: "Triangles", value: m?.triangleCount ?? 0 },
      { label: "Area", value: m ? m.surfaceArea.toFixed(3) : "—" },
      { label: "Volume", value: m ? m.volume.toFixed(3) : "—" },
      { label: "Euler χ", value: m ? m.eulerCharacteristic : "—" },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.isMtl, computed.materials.size, computed.metrics, computed.lints.length]);

  const materialList = useMemo(() => Array.from(computed.materials.values()), [computed.materials]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={computed.isMtl ? "Wavefront MTL Material Library" : "Wavefront OBJ 3D Geometry"}
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "OBJ/MTL", tone: "info" }}
        actions={
          <>
            {activeTab === "viewport" && computed.obj && (
              <>
                <PanelButton onClick={() => setViewMode("isometric")}>Iso</PanelButton>
                <PanelButton onClick={() => setViewMode("front")}>Front</PanelButton>
                <PanelButton onClick={() => setViewMode("top")}>Top</PanelButton>
                <PanelButton onClick={() => setAzimuthOffset((a) => (a + 30) % 360)}>Rotate +30°</PanelButton>
                <PanelButton onClick={() => setWireframe((w) => !w)}>
                  {wireframe ? "Wire: On" : "Wire: Off"}
                </PanelButton>
              </>
            )}
            {activeTab === "viewport" && host.exportFile && svg && (
              <PanelButton onClick={() => host.exportFile?.("obj-mesh.svg", svg, "image/svg+xml")}>
                Export SVG
              </PanelButton>
            )}
            {computed.obj && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("obj-mesh.stl", objToAsciiStl(computed.obj!), "model/stl")}>
                Export STL
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "obj", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<ObjTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "viewport", label: "3D Viewport" },
          {
            id: "objects",
            label: "Objects & Groups",
            count: (computed.obj?.objects.length ?? 0) + (computed.obj?.groups.length ?? 0),
          },
          { id: "materials", label: "Materials", count: materialList.length },
          { id: "metrics", label: "Metrics" },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "viewport" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ??
            (computed.isMtl
              ? "Switch to the Materials tab to inspect parsed MTL definitions."
              : "Load a Wavefront OBJ (.obj) mesh to render the interactive 3D viewport.")
          }
        />
      )}

      {activeTab === "objects" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Kind</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Faces</th>
                <th style={{ padding: "5px 6px" }}>Line</th>
              </tr>
            </thead>
            <tbody>
              {(computed.obj?.objects ?? []).map((o, idx) => (
                <tr
                  key={`obj-${o.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>object</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{o.name}</td>
                  <td style={{ padding: "4px 6px" }}>{o.faceIndices.length}</td>
                  <td style={{ padding: "4px 6px" }}>{o.line}</td>
                </tr>
              ))}
              {(computed.obj?.groups ?? []).map((g, idx) => (
                <tr
                  key={`grp-${g.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>group</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{g.name}</td>
                  <td style={{ padding: "4px 6px" }}>{g.faceIndices.length}</td>
                  <td style={{ padding: "4px 6px" }}>{g.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "materials" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {materialList.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
              No MTL materials defined or bound in this document.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>Swatch</th>
                  <th style={{ padding: "5px 6px" }}>Material</th>
                  <th style={{ padding: "5px 6px" }}>Kd (RGB)</th>
                  <th style={{ padding: "5px 6px" }}>Ns</th>
                  <th style={{ padding: "5px 6px" }}>d</th>
                  <th style={{ padding: "5px 6px" }}>Ni</th>
                  <th style={{ padding: "5px 6px" }}>illum</th>
                </tr>
              </thead>
              <tbody>
                {materialList.map((mat) => (
                  <tr
                    key={mat.name}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: "14px",
                          height: "14px",
                          borderRadius: "3px",
                          background: rgbToHex(mat.Kd ?? mat.Ka),
                          border: "1px solid var(--ms-border)",
                        }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{mat.name}</td>
                    <td style={{ padding: "4px 6px" }}>{mat.Kd ? mat.Kd.map((c) => c.toFixed(2)).join(", ") : "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{mat.Ns ?? "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{mat.d ?? "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{mat.Ni ?? "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{mat.illum ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "metrics" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            fontFamily: "var(--ms-font-mono)",
            fontSize: "11px",
          }}
        >
          {computed.metrics ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Surface Area</td>
                  <td style={{ padding: "5px 6px" }}>{computed.metrics.surfaceArea.toFixed(6)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Signed Volume</td>
                  <td style={{ padding: "5px 6px" }}>{computed.metrics.signedVolume.toFixed(6)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Euler Characteristic (χ)</td>
                  <td style={{ padding: "5px 6px" }}>{computed.metrics.eulerCharacteristic}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Watertight</td>
                  <td style={{ padding: "5px 6px" }}>{computed.metrics.isWatertight ? "Yes" : "No"}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Bounding Box Size</td>
                  <td style={{ padding: "5px 6px" }}>
                    {computed.metrics.boundingBox.size.map((v) => v.toFixed(4)).join(" × ")}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>Centroid</td>
                  <td style={{ padding: "5px 6px" }}>
                    ({computed.metrics.centroid.map((v) => v.toFixed(4)).join(", ")})
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div style={{ color: "var(--ms-text-2)" }}>No mesh metrics available.</div>
          )}
        </div>
      )}

      {activeTab === "lints" && (
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
            <div style={{ color: "var(--ms-text-2)" }}>No Wavefront OBJ/MTL lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.id}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.id}] L{d.line}
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

export default ObjPanel;
