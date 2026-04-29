import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import StepViewer, { type StepMeshPayload } from "./step-viewer/step-viewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

function App() {
  const [meshes, setMeshes] = useState<StepMeshPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [isDark, setIsDark] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const updateTheme = () => {
      const isDarkTheme =
        document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
      setIsDark(isDarkTheme);
    };
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "stepMeshes") {
        // postMessage serializes typed arrays to plain objects — convert back
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMeshes: StepMeshPayload[] = (message.data || []).map((m: any) => ({
          ...m,
          vertices: m.vertices instanceof Float32Array ? m.vertices : new Float32Array(Object.values(m.vertices || {})),
          normals: m.normals instanceof Float32Array ? m.normals : new Float32Array(Object.values(m.normals || {})),
          indices: m.indices instanceof Uint32Array ? m.indices : new Uint32Array(Object.values(m.indices || {})),
        }));
        setMeshes(rawMeshes);
      } else if (message.type === "selectMesh") {
        setSelectedId(message.id);
      } else if (message.type === "setLoading") {
        setIsLoading(message.data);
      }
    };
    window.addEventListener("message", handleMessage);

    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
    };
  }, []);

  const handleSelect = (id: number | null) => {
    setSelectedId(id || undefined);
    vscode?.postMessage({ command: "cadFeatureSelected", id });
  };

  return (
    <div
      className="step-webview-container"
      style={{ width: "100%", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
    >
      <StepViewer meshes={meshes} selectedId={selectedId} onSelect={handleSelect} dark={isDark} isLoading={isLoading} />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
