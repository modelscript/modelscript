// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import {
  buildEditorUrlForArtifact,
  isEditableCodeOrModelArtifact,
  isMultiFileArtifact,
  openArtifactInVsCodeWindow,
} from "../../../util/editor-routing";
import { sanitizeHttpUrl } from "../../../util/url";
import Box from "../../Box";

const InspectorContainer = styled(Box)`
  width: 320px;
  background: var(--color-canvas-subtle, rgba(15, 23, 42, 0.95));
  border-left: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
  color: var(--color-fg-default, #e2e8f0);
  flex-shrink: 0;

  .inspector-mobile-grabber,
  .inspector-mobile-close {
    display: none;
  }

  @media (max-width: 767px) {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-height: 55dvh;
    border-left: none;
    border-top: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.16));
    border-radius: 16px 16px 0 0;
    padding: 10px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 40;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);

    .inspector-mobile-grabber {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.4);
      margin: 0 auto 10px;
      flex-shrink: 0;
    }

    .inspector-mobile-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: var(--color-fg-default, #e2e8f0);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      padding: 0;
    }
  }
`;

export interface StudioInspectorSidebarProps {
  isOpen: boolean;
  artifact: any;
  artifactId: number;
  viewConfig: any;
  onClose?: (() => void) | undefined;
}

export const StudioInspectorSidebar: React.FC<StudioInspectorSidebarProps> = ({
  isOpen,
  artifact,
  artifactId,
  viewConfig,
  onClose,
}) => {
  const navigate = useNavigate();
  const hasCloudSolver = useFeatureFlag("cae_cloud_solver");
  if (!isOpen) return null;

  const isCoarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;

  const isMultiFile = isMultiFileArtifact({
    view_type: artifact?.view_type,
    view_config: viewConfig,
  });

  const handleOpenEditor = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    if (isMultiFile) {
      openArtifactInVsCodeWindow({
        artifactId,
        viewType: artifact?.view_type,
        viewConfig,
        title: artifact?.title || artifact?.name || viewConfig?.title,
      });
      return;
    }
    const rawUrl = buildEditorUrlForArtifact({
      artifactId,
      viewType: artifact?.view_type,
      viewConfig,
      title: artifact?.title || artifact?.name || viewConfig?.title,
    });
    const safeUrl = sanitizeHttpUrl(rawUrl, { allowRelative: true });
    if (safeUrl && (safeUrl.startsWith("/") || safeUrl.startsWith("#")) && !safeUrl.startsWith("//")) {
      navigate(safeUrl);
    }
  };

  return (
    <InspectorContainer>
      <div className="inspector-mobile-grabber" aria-hidden="true" />
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Text style={{ fontSize: "13px", fontWeight: "bold", color: "var(--color-fg-default, white)" }}>
          Engineering Telemetry &amp; Specs
        </Text>
        {onClose && (
          <button
            type="button"
            className="inspector-mobile-close"
            onClick={onClose}
            aria-label="Close inspector"
            title="Close inspector"
          >
            <XIcon size={14} />
          </button>
        )}
      </Box>

      <Box display="flex" flexDirection="column" gap={2} mb={4} fontSize="12px">
        <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
          <span style={{ color: "var(--color-fg-muted)" }}>Artifact ID</span>
          <span style={{ fontFamily: "var(--font-mono, monospace)" }}>#{artifactId}</span>
        </Box>
        <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
          <span style={{ color: "var(--color-fg-muted)" }}>Format</span>
          <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{artifact.view_type}</span>
        </Box>

        {/* Domain-specific Engineering Telemetry */}
        {["fmu", "fmu-package", "fmu-simulator", "fmi"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Model Identifier</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{viewConfig.modelName || "FMU Model"}</span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>FMI Standard</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#a78bfa" }}>
                FMI {viewConfig.fmiVersion || "2.0"}
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Execution Engine</span>
              <span style={{ color: viewConfig.hasWasm ? "#22d3ee" : "var(--ms-text-3)" }}>
                {viewConfig.hasWasm ? "WASM in-browser" : "Native Binaries"}
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Variables</span>
              <span>
                {viewConfig.variables?.length ??
                  (viewConfig.inputs?.length || 0) +
                    (viewConfig.outputs?.length || 0) +
                    (viewConfig.parameters?.length || 0)}
              </span>
            </Box>
          </>
        )}

        {["sysml", "sysml2", "sysml-architecture-viewer", "kerml"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>System Model</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {viewConfig.systemName || viewConfig.title || "SysML Architecture"}
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Standard / Dialect</span>
              <span style={{ color: "#60a5fa" }}>{viewConfig.format || "SysML2"}</span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Part Definitions</span>
              <span>{viewConfig.parts?.length ?? 0} parts</span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Requirements</span>
              <span style={{ color: "#34d399" }}>{viewConfig.requirements?.length ?? 0} tracked</span>
            </Box>
          </>
        )}

        {["dataset", "dataset-table", "csv", "tsv", "json-table"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Dimensions</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {viewConfig.rowCount || viewConfig.rows?.length || 0} rows &bull; {viewConfig.columns?.length || 0} cols
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>File Format</span>
              <span style={{ textTransform: "uppercase" }}>{viewConfig.format || "CSV"}</span>
            </Box>
          </>
        )}

        {["modelica", "modelica-diagram", "msx", "modelscript"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Class / Model</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {viewConfig.modelName || viewConfig.title || "Modelica DAE"}
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Compiler Kernel</span>
              <span style={{ color: "#38bdf8" }}>WASM GLR + DAE Arena</span>
            </Box>
            {viewConfig.componentCount !== undefined && (
              <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
                <span style={{ color: "var(--color-fg-muted)" }}>Components</span>
                <span>{viewConfig.componentCount}</span>
              </Box>
            )}
          </>
        )}

        {["pscad", "pscx", "pslx", "psse", "psse-sld", "raw"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Grid Domain</span>
              <span style={{ color: "#f59e0b" }}>
                {String(artifact.view_type).toLowerCase().includes("psse") ? "PSS/E Load Flow" : "PSCAD EMT"}
              </span>
            </Box>
            {viewConfig.systemFrequencyHz !== undefined && (
              <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
                <span style={{ color: "var(--color-fg-muted)" }}>Nominal Freq</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{viewConfig.systemFrequencyHz} Hz</span>
              </Box>
            )}
            {(viewConfig.busCount !== undefined || viewConfig.componentCount !== undefined) && (
              <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
                <span style={{ color: "var(--color-fg-muted)" }}>Topology Nodes</span>
                <span>{viewConfig.busCount ?? viewConfig.componentCount}</span>
              </Box>
            )}
          </>
        )}

        {["ssp", "ssd", "ssp-topology"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Standard</span>
              <span style={{ color: "#38bdf8" }}>MA SSP 1.0 / FMI Co-Sim</span>
            </Box>
            {viewConfig.fmuCount !== undefined && (
              <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
                <span style={{ color: "var(--color-fg-muted)" }}>Coupled FMUs</span>
                <span>{viewConfig.fmuCount}</span>
              </Box>
            )}
          </>
        )}

        {["simpack", "spck", "gensys", "gensys-track"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Kinematics Engine</span>
              <span style={{ color: "#22d3ee" }}>Spatial Multibody DAE</span>
            </Box>
            {viewConfig.bodyCount !== undefined && (
              <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
                <span style={{ color: "var(--color-fg-muted)" }}>Rigid Bodies</span>
                <span>{viewConfig.bodyCount}</span>
              </Box>
            )}
          </>
        )}

        {["owl", "owl2", "ontology", "rdf", "ttl"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Reasoner</span>
              <span style={{ color: "#a78bfa" }}>W3C OWL 2 DL / HermiT</span>
            </Box>
          </>
        )}

        {["sima", "sima-mooring"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Offshore Code</span>
              <span style={{ color: "#34d399" }}>DNV-OS-E301 Mooring</span>
            </Box>
          </>
        )}

        {["reqif", "reqifz", "reqif-viewer"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Specification</span>
              <span style={{ color: "#38bdf8" }}>OMG ReqIF 1.2 + ISO 26262</span>
            </Box>
          </>
        )}

        {["qif", "qif-viewer"].includes(artifact.view_type?.toLowerCase()) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Metrology Standard</span>
              <span style={{ color: "#38bdf8" }}>ISO 23952 QIF 3.0 + STEP AP242</span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>GD&amp;T Authority</span>
              <span style={{ color: "#4ade80" }}>ASME Y14.5-2018 MBD</span>
            </Box>
          </>
        )}

        {viewConfig.url && (
          <Box display="flex" flexDirection="column" gap={1} py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
            <span style={{ color: "var(--color-fg-muted)" }}>Asset Resource</span>
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "10px",
                wordBreak: "break-all",
                color: "#38bdf8",
              }}
            >
              {viewConfig.url}
            </span>
          </Box>
        )}
        {hasCloudSolver && (viewConfig.usage || viewConfig.hpc) && (
          <>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Compute Runtime</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {viewConfig.usage?.cpuSeconds ?? viewConfig.hpc?.cpuCoreSeconds ?? 0}s
              </span>
            </Box>
            <Box display="flex" justifyContent="space-between" py={1} borderBottom="1px solid rgba(255,255,255,0.06)">
              <span style={{ color: "var(--color-fg-muted)" }}>Execution Cost</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
                {(viewConfig.usage?.costCredits ?? viewConfig.hpc?.costCredits ?? 0).toFixed(2)} credits
              </span>
            </Box>
          </>
        )}
      </Box>

      <Text style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "8px", color: "white" }}>
        Interaction Guide
      </Text>
      <Box
        p={2}
        bg="rgba(0,0,0,0.3)"
        borderRadius="8px"
        border="1px solid rgba(255,255,255,0.08)"
        fontSize="11px"
        display="flex"
        flexDirection="column"
        gap={1}
        color="var(--color-fg-muted)"
      >
        {[
          "cad",
          "cad-step",
          "cad_step",
          "cad-3d-viewer",
          "step",
          "stp",
          "3d-model",
          "simulation",
          "simulation-result",
          "fea-result",
          "cfd-result",
          "cfd-animation",
          "gcode",
          "cam-result",
          "webgpu",
          "webgpu-simulation",
          "gpu-simulation",
        ].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              {isCoarsePointer ? (
                <>
                  👆 <b>Rotate:</b> 1-finger drag
                </>
              ) : (
                <>
                  🖱️ <b>Rotate:</b> Left-click + drag
                </>
              )}
            </div>
            <div>
              {isCoarsePointer ? (
                <>
                  ✌️ <b>Pan:</b> Two-finger swipe
                </>
              ) : (
                <>
                  ✋ <b>Pan:</b> Right-click + drag / Two-finger swipe
                </>
              )}
            </div>
            <div>
              {isCoarsePointer ? (
                <>
                  🤏 <b>Zoom:</b> Pinch
                </>
              ) : (
                <>
                  🔍 <b>Zoom:</b> Hold Ctrl / ⌘ + scroll or pinch
                </>
              )}
            </div>
            <div>
              📍 <b>Spatial Pin:</b> {isCoarsePointer ? "Tap" : "Click"} in PIN mode to attach comments
            </div>
          </>
        ) : ["fmu", "fmu-package", "fmu-simulator", "fmi"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              ⚙️ <b>Tune Parameters:</b> Modify inputs in the variable table
            </div>
            <div>
              ▶️ <b>Live Co-Simulation:</b> Execute numerical integration
            </div>
            <div>
              📈 <b>Plot Trajectory:</b> View response curves in real-time
            </div>
          </>
        ) : ["sysml", "sysml2", "sysml-architecture-viewer", "kerml"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              🌳 <b>Architecture:</b> Browse IBD / BDD diagrams and pan/zoom
            </div>
            <div>
              🛡️ <b>Verification:</b> Inspect requirements satisfaction matrix
            </div>
            <div>
              🔧 <b>Interactive Edit:</b> Switch to Edit mode for bidirectional AST sync
            </div>
          </>
        ) : ["modelica", "modelica-diagram", "msx", "modelscript"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              🧩 <b>Schematic Edit:</b> Drag components, wire ports, and edit parameters
            </div>
            <div>
              ▶️ <b>Simulate DAE:</b> Run in-browser WASM DAE solver and plot trajectories
            </div>
            <div>
              🔄 <b>Split Sync:</b> Bidirectional sync between X6 diagram and Modelica code
            </div>
          </>
        ) : ["pscad", "pscx", "pslx", "psse", "psse-sld", "raw"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              ⚡ <b>Grid Schematic:</b> Pan and zoom single-line / EMT schematics
            </div>
            <div>
              📊 <b>Telemetry:</b> Toggle sidebar to inspect bus voltages &amp; IEEE 2800 status
            </div>
            <div>
              🔧 <b>Interactive Edit:</b> Edit power network topology and parameters
            </div>
          </>
        ) : ["ssp", "ssd", "ssp-topology"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              🔗 <b>FMU Topology:</b> Click any FMU block in the sidebar to highlight it on canvas
            </div>
            <div>
              ✋ <b>Pan &amp; Zoom:</b> Drag stage to pan, hold Ctrl / ⌘ + scroll or use HUD controls to zoom
            </div>
          </>
        ) : ["simpack", "spck", "gensys", "gensys-track"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              🧊 <b>3D Multibody:</b> Orbit 3D kinematic topology or inspect 2D schematic
            </div>
            <div>
              🛤️ <b>Dynamics:</b> Verify EN 14363 stability &amp; degree-of-freedom mobility
            </div>
          </>
        ) : ["owl", "owl2", "ontology", "rdf", "ttl"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              🕸️ <b>Ontology Graph:</b> Click class nodes to inspect axioms and disjointness
            </div>
            <div>
              🔍 <b>Filter &amp; Search:</b> Filter classes and object properties in real time
            </div>
          </>
        ) : ["sima", "sima-mooring"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              ⚓ <b>Mooring Spread:</b> Click mooring lines or toggle ALS line-break test
            </div>
            <div>
              📐 <b>Catenary &amp; DNV:</b> Inspect 2D catenary sag profile and DNV-OS-E301 table
            </div>
          </>
        ) : ["reqif", "reqifz", "reqif-viewer"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              📋 <b>Tabular &amp; RTM:</b> Double-click cells to edit requirements and traceability
            </div>
            <div>
              🕸️ <b>Architecture Diagram:</b> Pan/zoom requirements graph and click nodes to filter
            </div>
          </>
        ) : ["dataset", "dataset-table", "csv", "tsv", "json-table"].includes(artifact.view_type?.toLowerCase()) ? (
          <>
            <div>
              ↕️ <b>Sort:</b> Click column headers to sort rows
            </div>
            <div>
              🔍 <b>Search:</b> Real-time row filtering across all columns
            </div>
            <div>
              📊 <b>Profiling:</b> Toggle &ldquo;Stats&rdquo; for min, max, mean, unique
            </div>
          </>
        ) : (
          <>
            <div>
              🔍 <b>Pan &amp; Zoom:</b> Drag diagram stage to pan, hold Ctrl / ⌘ + scroll or use zoom HUD controls
            </div>
            <div>
              📄 <b>Source View:</b> Switch between schematic diagram and syntax-highlighted code
            </div>
          </>
        )}
        {!isCoarsePointer && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "4px", paddingTop: "4px" }}>
            ⌨️ <b>Hotkeys:</b> [Esc] Exit &bull; [I] Inspector{" "}
            {isEditableCodeOrModelArtifact({ view_type: artifact?.view_type, view_config: viewConfig }) && (
              <>
                &bull;{" "}
                <button
                  type="button"
                  onClick={handleOpenEditor}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#38bdf8",
                    textDecoration: "none",
                    cursor: "pointer",
                    font: "inherit",
                    display: "inline",
                  }}
                  title={isMultiFile ? "Open in VS Code IDE (R)" : "Open in Morsel (R)"}
                >
                  [R] {isMultiFile ? "IDE" : "Morsel"}
                </button>{" "}
              </>
            )}
            &bull; [C] Copy Link
          </div>
        )}
      </Box>
    </InspectorContainer>
  );
};
