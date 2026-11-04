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

export function ModelScriptProvider({ children, theme: propTheme }: ModelScriptProviderProps) {
  const [environment, setEnvironment] = useState<ModelScriptEnvironment>("web");
  const [isReady] = useState(true);
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return "dark";
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    const legacyMedia = media as unknown as {
      addListener?: (h: (e: MediaQueryListEvent | MediaQueryList) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent | MediaQueryList) => void) => void;
    };
    if (typeof legacyMedia.addListener === "function") {
      legacyMedia.addListener(handler);
      return () => legacyMedia.removeListener?.(handler);
    }
    return undefined;
  }, []);

  const theme = propTheme ?? systemTheme;

  useEffect(() => {
    // Detect host runtime environment
    if (typeof window !== "undefined") {
      const hostWindow = window as unknown as {
        __TAURI__?: unknown;
        acquireVsCodeApi?: unknown;
      };
      if (hostWindow.__TAURI__) {
        setEnvironment("tauri");
      } else if (hostWindow.acquireVsCodeApi || window.parent !== window) {
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
