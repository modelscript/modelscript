// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import StepViewer, { type StepMeshPayload } from "./step-viewer/step-viewer";

const vscode = (
  window as unknown as {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState<T = unknown>(): T | undefined;
      setState<T = unknown>(state: T): T;
    };
  }
).acquireVsCodeApi?.();

interface RawStepMesh {
  id: number;
  name: string;
  type: string;
  color?: [number, number, number] | undefined;
  vertices?: Float32Array | Record<string, number> | number[] | undefined;
  normals?: Float32Array | Record<string, number> | number[] | undefined;
  indices?: Uint32Array | Record<string, number> | number[] | undefined;
}

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

        const rawMeshes: StepMeshPayload[] = ((message.data as RawStepMesh[]) || []).map((m) => ({
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
