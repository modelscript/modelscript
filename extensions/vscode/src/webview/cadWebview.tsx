// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CadViewer, { type CadComponent } from "./cad-viewer/cad-viewer";
import { parseCadAnnotationString } from "./cad-viewer/parse-cad-annotations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

function App() {
  const [components, setComponents] = useState<CadComponent[]>([]);
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  const [isDark, setIsDark] = useState<boolean>(true);

  useEffect(() => {
    // Check initial theme from VSCode
    const updateTheme = () => {
      const isDarkTheme =
        document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
      setIsDark(isDarkTheme);
    };
    updateTheme();

    // Create an observer to watch for theme class changes on body
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Listen for messages from the extension host
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "cadComponents") {
        const rawComponents = message.data || [];
        const parsed = rawComponents
          .map((c: { cad: unknown; [key: string]: unknown }) => ({
            ...c,
            cad: typeof c.cad === "string" ? parseCadAnnotationString(c.cad) : c.cad,
          }))
          .filter((c: { cad: unknown }) => c.cad !== null);
        setComponents(parsed);
      } else if (message.type === "selectComponent") {
        setSelectedName(message.name);
      }
    };
    window.addEventListener("message", handleMessage);

    // Let the extension know the webview is ready to receive data
    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
    };
  }, []);

  const handleSelect = (name: string | null) => {
    setSelectedName(name || undefined);
    // optionally notify VSCode to select the text/diagram
    vscode?.postMessage({ type: "select", name });
  };

  return (
    <div
      className="cad-webview-container"
      style={{ width: "100%", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
    >
      <CadViewer
        components={components}
        selectedName={selectedName}
        onSelect={handleSelect}
        dark={isDark}
        assetBaseUrl={(window as unknown as { __CAD_ASSET_BASE_URL__: string }).__CAD_ASSET_BASE_URL__}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
