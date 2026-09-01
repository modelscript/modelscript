import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import StepViewer, { type StepMeshPayload } from "./step-viewer/step-viewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

/* ─── types ─── */
interface MsimConfig {
  type?: string;
  stepFile?: string;
  mesh?: { min?: number; max?: number; algorithm?: string; order?: number };
  material?: { name?: string; E?: number; nu?: number; density?: number };
  loads?: { type?: string; face?: string; value?: number[] }[];
  constraints?: { type?: string; face?: string }[];
  fluid?: { name?: string; density?: number; viscosity?: number };
  inlet?: { velocity?: number[]; turbulenceIntensity?: number };
  solver?: { type?: string; maxIterations?: number; tolerance?: number };
  output?: { scalars?: string[] };
}

/* ─── collapsible section ─── */
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-header" onClick={() => setOpen(!open)}>
        <span className="chevron">{open ? "▾" : "▸"}</span>
        <span>{title}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

/* ─── field row ─── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

/* ─── main app ─── */
function App() {
  const [meshes, setMeshes] = useState<StepMeshPayload[]>([]);
  const [isDark, setIsDark] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<MsimConfig>({});
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  // Debounced save to document
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveConfig = useCallback((newConfig: MsimConfig) => {
    setConfig(newConfig);
    configRef.current = newConfig;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      vscode?.postMessage({ type: "update", text: JSON.stringify(newConfig, null, 2) });
    }, 400);
  }, []);

  const updateField = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (path: string, value: any) => {
      const c = JSON.parse(JSON.stringify(configRef.current)) as Record<string, unknown>;
      const keys = path.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = c;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i] as string]) obj[keys[i] as string] = {};
        obj = obj[keys[i] as string];
      }
      obj[keys[keys.length - 1] as string] = value;
      saveConfig(c as unknown as MsimConfig);
    },
    [saveConfig],
  );

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(
        document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast"),
      );
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "stepMeshes") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: StepMeshPayload[] = (msg.data || []).map((m: any) => ({
          ...m,
          vertices: m.vertices instanceof Float32Array ? m.vertices : new Float32Array(Object.values(m.vertices || {})),
          normals: m.normals instanceof Float32Array ? m.normals : new Float32Array(Object.values(m.normals || {})),
          indices: m.indices instanceof Uint32Array ? m.indices : new Uint32Array(Object.values(m.indices || {})),
        }));
        setMeshes(raw);
        setIsLoading(false);
      } else if (msg.type === "setLoading") {
        setIsLoading(msg.data);
      } else if (msg.type === "configData") {
        setConfig(msg.data || {});
        configRef.current = msg.data || {};
      }
    };
    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
    };
  }, []);

  const simType = (config.type || "Meshing").toUpperCase();
  const stepFileName = config.stepFile ? config.stepFile.split("/").pop() : "—";

  /* ─── floating panel contents ─── */
  const panelContent = useMemo(() => {
    const parameters = config.parameters || {};
    const parameterKeys = Object.keys(parameters).filter((k) => k !== "stepFile");

    return (
      <>
        {/* ── Geometry ── */}
        <Section title="Geometry" defaultOpen={true}>
          <Field label="STEP File">
            <div className="file-badge">{stepFileName}</div>
          </Field>
        </Section>

        {/* ── Study Parameters ── */}
        {parameterKeys.length > 0 && (
          <Section title="Study Parameters" defaultOpen={true}>
            {parameterKeys.map((key) => (
              <Field label={key} key={key}>
                <input
                  type={typeof parameters[key] === "number" ? "number" : "text"}
                  step="any"
                  value={parameters[key]}
                  onChange={(e) => {
                    const val = typeof parameters[key] === "number" ? parseFloat(e.target.value) : e.target.value;
                    updateField(`parameters.${key}`, val);
                  }}
                />
              </Field>
            ))}
          </Section>
        )}

        {/* ── Run ── */}
        <div className="run-section">
          <button className="run-btn" onClick={() => vscode?.postMessage({ type: "runSimulation" })}>
            ▶ Run {config.workflowClass?.split(".").pop() || "Study"}
          </button>
        </div>
      </>
    );
  }, [config, simType, stepFileName, updateField, saveConfig]);

  return (
    <div className="root">
      {/* Full-screen 3D background */}
      <div className="viewer-bg">
        <StepViewer meshes={meshes} dark={isDark} isLoading={isLoading} />
      </div>

      {/* Floating config panel */}
      <div className={`floating-panel ${panelCollapsed ? "collapsed" : ""}`}>
        <div className="panel-header">
          <div className="panel-title">
            <span className="panel-icon">{simType === "FEA" ? "🔩" : simType === "CFD" ? "🌊" : "🔷"}</span>
            <span>{config.type || "Meshing"} Setup</span>
          </div>
          <button className="collapse-btn" onClick={() => setPanelCollapsed(!panelCollapsed)}>
            {panelCollapsed ? "▶" : "◀"}
          </button>
        </div>
        {!panelCollapsed && <div className="panel-body">{panelContent}</div>}
      </div>
    </div>
  );
}

/* ─── mount ─── */
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
