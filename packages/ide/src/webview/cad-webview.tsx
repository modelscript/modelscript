// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  DynamicBindingConfig,
  GdtOverlayPayload,
  SampledTelemetryFrame,
  Verification3DOverlayPayload,
} from "@modelscript/cad";
import CadViewer, {
  type CadComponent,
  type CommitAssemblyJointPayload,
  type CommitDimensionPayload,
  type CommitFaceTagPayload,
  type GizmoCommitPayload,
} from "@modelscript/cad-viewer/CadViewer.js";
import type { PodSurrogateDataPayload } from "@modelscript/cad-viewer/SurrogateLiveExplorer.js";
import { AnimationController } from "@modelscript/cad-viewer/animation-controller.js";
import { extractCadComponents } from "@modelscript/cad-viewer/parse-cad-annotations.js";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerSharedVsCodeApi } from "./cad-viewer/vr-mode";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

const vscodeApi = getVsCodeWebviewApi();
registerSharedVsCodeApi(vscodeApi);

function App() {
  const actions = useVsCodeHostActions();
  const [components, setComponents] = useState<CadComponent[]>([]);
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  const [isDark, setIsDark] = useState<boolean>(true);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const [vtkBuffer, setVtkBuffer] = useState<Uint8Array | null>(null);
  const [gdtOverlay, setGdtOverlay] = useState<GdtOverlayPayload | null>(null);
  const [verificationOverlay, setVerificationOverlay] = useState<Verification3DOverlayPayload | null>(null);
  const [surrogateData, setSurrogateData] = useState<PodSurrogateDataPayload | null>(null);
  const [surrogateModelName, setSurrogateModelName] = useState<string | undefined>(undefined);
  const [telemetryFrame, setTelemetryFrame] = useState<SampledTelemetryFrame | null>(null);
  const [sourceCode, setSourceCode] = useState<string | undefined>(undefined);
  const [caeSourceCode, setCaeSourceCode] = useState<string | undefined>(undefined);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // Check initial theme from VS Code
    const updateTheme = () => {
      const isDarkTheme =
        document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
      setIsDark(isDarkTheme);
    };
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Listen for messages from the extension host
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "cadComponents") {
        setLockNotice(null);
        const rawComponents = message.data || [];
        const parsed = extractCadComponents(rawComponents);
        setComponents(parsed);

        // Initialize/update the AnimationController with component bindings
        let ctrl = animationControllerRef.current;
        if (!ctrl && parsed.length > 0) {
          ctrl = new AnimationController();
          animationControllerRef.current = ctrl;
        }
        if (ctrl && parsed.length > 0) {
          ctrl.setBindings(
            parsed.map((c) => ({
              componentName: c.name,
              bindings: (c.dynamicBindings || []).map((b) => ({
                property: b.property as
                  | "position"
                  | "rotation"
                  | "scale"
                  | "shapeOffset"
                  | "lengthDirection"
                  | "widthDirection"
                  | "vectorCoordinates"
                  | "color",
                index: b.index,
                variable: b.variable,
              })),
              defaults: (c.defaults as Record<string, unknown> | undefined) ?? {
                position: c.cad.position ?? [0, 0, 0],
                rotation: c.cad.rotation ?? [0, 0, 0],
                scale: c.cad.scale ?? [1, 1, 1],
              },
            })),
          );
        }
      } else if (message.type === "sourceContext" && message.data) {
        if (typeof message.data.sourceCode === "string") {
          setSourceCode(message.data.sourceCode);
        }
        setCaeSourceCode(typeof message.data.caeSourceCode === "string" ? message.data.caeSourceCode : undefined);
      } else if (message.type === "writebackLocked") {
        setLockNotice(
          typeof message.reason === "string" && message.reason.length > 0
            ? message.reason
            : "Expression is locked (multi-variable or non-affine constraint). Edit in source.",
        );
      } else if (message.type === "selectComponent" || message.type === "focusPart") {
        setSelectedName(message.name ?? message.partName);
      } else if (message.type === "simulationData") {
        const { t, y, states } = message.data;
        let ctrl = animationControllerRef.current;
        if (!ctrl) {
          ctrl = new AnimationController();
          animationControllerRef.current = ctrl;
        }
        ctrl.loadTimeseries(t, y, states);
        ctrl.play();
        forceUpdate((n) => n + 1);
      } else if (message.type === "liveValues") {
        const ctrl = animationControllerRef.current;
        if (ctrl) {
          const values = new Map<string, number>(Object.entries(message.data.values));
          ctrl.pushLiveBatch(values, message.data.time);
          if (ctrl.mode !== "live") {
            ctrl.goLive();
            forceUpdate((n) => n + 1);
          }
        }
      } else if (message.type === "VTK_BUFFER" || message.type === "VTK_PAYLOAD") {
        try {
          const rawBuffer = message.data?.buffer ?? message.data;
          if (rawBuffer instanceof Uint8Array) {
            setVtkBuffer(rawBuffer);
          } else if (Array.isArray(rawBuffer)) {
            setVtkBuffer(new Uint8Array(rawBuffer));
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to parse VTK buffer:", e);
        }
      } else if (message.type === "FEA_PAYLOAD") {
        try {
          const payload = message.data?.payload || message.data;
          if (payload?.vtkBuffer instanceof Uint8Array) {
            setVtkBuffer(payload.vtkBuffer);
          } else if (Array.isArray(payload?.vtkBuffer)) {
            setVtkBuffer(new Uint8Array(payload.vtkBuffer));
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to handle FEA_PAYLOAD:", e);
        }
      } else if (message.type === "GDT_OVERLAY" || message.type === "QIF_INSPECTION_OVERLAY") {
        try {
          const payload = (message.data?.payload || message.data) as GdtOverlayPayload;
          if (payload && (Array.isArray(payload.callouts) || Array.isArray(payload.datums))) {
            setGdtOverlay(payload);
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to handle GD&T/QIF overlay:", e);
        }
      } else if (message.type === "VERIFICATION_OVERLAY") {
        try {
          const payload = (message.data?.payload || message.data) as Verification3DOverlayPayload;
          if (payload) {
            setVerificationOverlay(payload);
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to handle VERIFICATION_OVERLAY:", e);
        }
      } else if (message.type === "SURROGATE_PAYLOAD") {
        try {
          const payload = (message.data?.payload || message.data) as PodSurrogateDataPayload;
          if (payload && Array.isArray(payload.parameterNames)) {
            setSurrogateData(payload);
            setSurrogateModelName(typeof message.data?.modelName === "string" ? message.data.modelName : undefined);
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to handle SURROGATE_PAYLOAD:", e);
        }
      } else if (message.type === "TELEMETRY_FRAME") {
        try {
          const frame = (message.data?.frame || message.data) as SampledTelemetryFrame;
          if (frame && typeof frame === "object") {
            setTelemetryFrame(frame);
          }
        } catch (e) {
          console.warn("[CadWebview] Failed to handle TELEMETRY_FRAME:", e);
        }
      } else if (message.type === "FOCUS_VIOLATION_3D" || message.type === "focusViolationIn3D") {
        const { time, lhsName } = message;
        if (time !== undefined && Number.isFinite(time)) {
          animationControllerRef.current?.seek(time);
        }
        if (lhsName) {
          setSelectedName(lhsName);
        }
        forceUpdate((n) => n + 1);
      }
    };
    window.addEventListener("message", handleMessage);

    // Let the extension know the webview is ready to receive data
    vscodeApi.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
    };
  }, []);

  const handleSelect = (name: string | null) => {
    setSelectedName(name || undefined);
    vscodeApi.postMessage({ type: "select", name });
  };

  const handleCommitGizmoDelta = (payload: GizmoCommitPayload) => {
    vscodeApi.postMessage({
      type: "commitGizmoDelta",
      payload,
    });
  };

  const handleCommitDimensionDelta = (payload: CommitDimensionPayload) => {
    vscodeApi.postMessage({
      type: "commitDimensionDelta",
      payload,
    });
  };

  const handleCommitFaceTag = (payload: CommitFaceTagPayload) => {
    vscodeApi.postMessage({
      type: "commitFaceTag",
      payload,
    });
  };

  const handleCommitAssemblyJoint = (spec: CommitAssemblyJointPayload) => {
    vscodeApi.postMessage({
      type: "commitAssemblyJoint",
      payload: spec,
    });
  };

  const handleSaveBindings = (componentName: string, bindings: DynamicBindingConfig[]) => {
    const comp = components.find((c) => c.name === componentName);
    vscodeApi.postMessage({
      type: "commitCadBinding",
      payload: {
        componentName,
        bindings,
        uri: comp?.cad.uri,
      },
    });
  };

  const assetBaseUrl =
    (window as unknown as { __CAD_ASSET_BASE_URL__?: string }).__CAD_ASSET_BASE_URL__ ?? "/api/v1/libraries";

  return (
    <div
      className="cad-webview-container"
      style={{ position: "relative", width: "100%", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
    >
      {lockNotice && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "rgba(180, 83, 9, 0.94)",
            color: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "85%",
            boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
          }}
        >
          <span>🔒 {lockNotice}</span>
          <button
            type="button"
            onClick={() => setLockNotice(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fef3c7",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>
      )}
      <CadViewer
        components={components}
        selectedName={selectedName}
        onSelect={handleSelect}
        onCommitGizmoDelta={handleCommitGizmoDelta}
        onCommitDimensionDelta={handleCommitDimensionDelta}
        onCommitFaceTag={handleCommitFaceTag}
        onCommitAssemblyJoint={handleCommitAssemblyJoint}
        onSaveBindings={handleSaveBindings}
        dark={isDark}
        assetBaseUrl={assetBaseUrl}
        animationController={animationControllerRef.current}
        vtkBuffer={vtkBuffer}
        gdtOverlay={gdtOverlay}
        verificationOverlay={verificationOverlay}
        surrogateData={surrogateData}
        surrogateModelName={surrogateModelName}
        onCloseSurrogateExplorer={() => setSurrogateData(null)}
        telemetryHud={telemetryFrame ? { frame: telemetryFrame, dark: isDark } : null}
        sourceCode={sourceCode}
        caeSourceCode={caeSourceCode}
        onRevealLine={(line, identifier) => actions.revealLine(line, identifier)}
        onInsertCaeSnippet={(snippet) => vscodeApi.postMessage({ type: "insertCaeSnippet", snippet })}
        onOpenVrRotunda={() => {
          actions.openInVr({
            environment: "dark-lab",
            kind: vtkBuffer ? "cfd" : "cad",
            title: "3D CAD Viewer",
          });
        }}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <App />
    </VsCodeEditorHostProvider>,
  );
}
