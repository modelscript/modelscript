// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationController } from "./cad-viewer/animation-controller";
import CadViewer, { type CadComponent } from "./cad-viewer/cad-viewer";
import { extractCadComponents } from "./cad-viewer/parse-cad-annotations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

function App() {
  const [components, setComponents] = useState<CadComponent[]>([]);
  const [selectedName, setSelectedName] = useState<string | undefined>(undefined);
  const [isDark, setIsDark] = useState<boolean>(true);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const [, forceUpdate] = useState(0);

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
            parsed
              .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
              .map((c) => ({
                componentName: c.name,
                bindings: (c.dynamicBindings || []).map((b) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index,
                  variable: b.variable,
                })),
              })),
          );
          for (const comp of parsed) {
            ctrl.setDefault(comp.name, {
              position: comp.cad.position ?? [0, 0, 0],
              rotation: comp.cad.rotation ?? [0, 0, 0],
              scale: comp.cad.scale ?? [1, 1, 1],
            });
          }
        }
      } else if (message.type === "selectComponent") {
        setSelectedName(message.name);
      } else if (message.type === "simulationData") {
        // Load simulation results into the animation controller
        const { t, y, states } = message.data;
        let ctrl = animationControllerRef.current;
        if (!ctrl) {
          ctrl = new AnimationController();
          animationControllerRef.current = ctrl;
        }
        ctrl.loadTimeseries(t, y, states);
        forceUpdate((n) => n + 1); // trigger re-render to show timeline
      } else if (message.type === "liveValues") {
        // Push live cosimulation values
        const ctrl = animationControllerRef.current;
        if (ctrl) {
          const values = new Map<string, number>(Object.entries(message.data.values));
          ctrl.pushLiveBatch(values, message.data.time);
          if (ctrl.mode !== "live") {
            ctrl.goLive();
            forceUpdate((n) => n + 1);
          }
        }
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
        animationController={animationControllerRef.current}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
