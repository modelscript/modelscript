// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useContext, useEffect, useState } from "react";

export type ModelScriptEnvironment = "web" | "tauri" | "vscode";

export interface ModelScriptContextValue {
  theme: "dark" | "light";
  environment: ModelScriptEnvironment;
  isReady: boolean;
  version: string;
}

const ModelScriptContext = createContext<ModelScriptContextValue>({
  theme: "dark",
  environment: "web",
  isReady: true,
  version: "0.0.1",
});

export interface ModelScriptProviderProps {
  children: React.ReactNode;
  theme?: "dark" | "light";
  wasmPath?: string;
}

export function ModelScriptProvider({ children, theme = "dark" }: ModelScriptProviderProps) {
  const [environment, setEnvironment] = useState<ModelScriptEnvironment>("web");
  const [isReady] = useState(true);

  useEffect(() => {
    // Detect host runtime environment
    if (typeof window !== "undefined") {
      if ((window as any).__TAURI__) {
        setEnvironment("tauri");
      } else if ((window as any).acquireVsCodeApi || window.parent !== window) {
        setEnvironment("vscode");
      } else {
        setEnvironment("web");
      }
    }
  }, []);

  return (
    <ModelScriptContext.Provider
      value={{
        theme,
        environment,
        isReady,
        version: "0.0.1",
      }}
    >
      {children}
    </ModelScriptContext.Provider>
  );
}

export function useModelScript(): ModelScriptContextValue {
  return useContext(ModelScriptContext);
}
