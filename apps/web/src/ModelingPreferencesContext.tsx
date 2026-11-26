// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getUserPreferences, updateUserPreferences } from "./api/account";
import { useAuth } from "./AuthContext";

export interface ModelingPreferences {
  // Monaco Code Editor
  fontSize: number;
  tabSize: number;
  wordWrap: "on" | "off";
  lineNumbers: "on" | "off" | "relative";
  minimapEnabled: boolean;
  bracketPairColorization: boolean;

  // Editor preference aliases
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: "on" | "off";
  editorLineNumbers: "on" | "off" | "relative";
  editorMinimap: boolean;

  // ModelScript Compiler
  flattenerBackend: "hybrid" | "wasm" | "ts";
  lintOnType: boolean;
  enableExperimentalFeatures: boolean;

  // Numerical Simulation
  defaultSolver: "cvode" | "ida" | "dopri5" | "rk4";
  defaultStopTime: number;
  defaultRelativeTolerance: number;
  solverTolerance: number;
  defaultNumberOfIntervals: number;
  diagramAutoLayout: boolean;
}

export const DEFAULT_MODELING_PREFERENCES: ModelingPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: "on",
  lineNumbers: "on",
  minimapEnabled: true,
  bracketPairColorization: true,

  editorFontSize: 14,
  editorTabSize: 2,
  editorWordWrap: "on",
  editorLineNumbers: "on",
  editorMinimap: true,

  flattenerBackend: "hybrid",
  lintOnType: true,
  enableExperimentalFeatures: false,

  defaultSolver: "cvode",
  defaultStopTime: 10,
  defaultRelativeTolerance: 1e-4,
  solverTolerance: 1e-4,
  defaultNumberOfIntervals: 500,
  diagramAutoLayout: true,
};

function syncModelingPreferences(
  base: ModelingPreferences,
  updates?: Partial<ModelingPreferences>,
): ModelingPreferences {
  const merged = updates ? { ...base, ...updates } : { ...base };

  const tolerance =
    updates?.solverTolerance !== undefined
      ? updates.solverTolerance
      : updates?.defaultRelativeTolerance !== undefined
        ? updates.defaultRelativeTolerance
        : (merged.solverTolerance ?? merged.defaultRelativeTolerance ?? DEFAULT_MODELING_PREFERENCES.solverTolerance);

  const fontSize =
    updates?.editorFontSize !== undefined
      ? updates.editorFontSize
      : updates?.fontSize !== undefined
        ? updates.fontSize
        : (merged.fontSize ?? merged.editorFontSize ?? DEFAULT_MODELING_PREFERENCES.fontSize);

  const tabSize =
    updates?.editorTabSize !== undefined
      ? updates.editorTabSize
      : updates?.tabSize !== undefined
        ? updates.tabSize
        : (merged.tabSize ?? merged.editorTabSize ?? DEFAULT_MODELING_PREFERENCES.tabSize);

  const wordWrap =
    updates?.editorWordWrap !== undefined
      ? updates.editorWordWrap
      : updates?.wordWrap !== undefined
        ? updates.wordWrap
        : (merged.wordWrap ?? merged.editorWordWrap ?? DEFAULT_MODELING_PREFERENCES.wordWrap);

  const lineNumbers =
    updates?.editorLineNumbers !== undefined
      ? updates.editorLineNumbers
      : updates?.lineNumbers !== undefined
        ? updates.lineNumbers
        : (merged.lineNumbers ?? merged.editorLineNumbers ?? DEFAULT_MODELING_PREFERENCES.lineNumbers);

  const minimapEnabled =
    updates?.editorMinimap !== undefined
      ? updates.editorMinimap
      : updates?.minimapEnabled !== undefined
        ? updates.minimapEnabled
        : (merged.minimapEnabled ?? merged.editorMinimap ?? DEFAULT_MODELING_PREFERENCES.minimapEnabled);

  return {
    ...merged,
    fontSize,
    editorFontSize: fontSize,
    tabSize,
    editorTabSize: tabSize,
    wordWrap,
    editorWordWrap: wordWrap,
    lineNumbers,
    editorLineNumbers: lineNumbers,
    minimapEnabled,
    editorMinimap: minimapEnabled,
    defaultRelativeTolerance: tolerance,
    solverTolerance: tolerance,
  };
}

const STORAGE_KEY = "modelscript_modeling_preferences";

interface ModelingPreferencesContextType {
  preferences: ModelingPreferences;
  updatePreferences: (updates: Partial<ModelingPreferences>) => void;
  resetPreferences: () => void;
}

const ModelingPreferencesContext = createContext<ModelingPreferencesContextType | undefined>(undefined);

export const ModelingPreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const [preferences, setPreferences] = useState<ModelingPreferences>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ModelingPreferences>;
        return syncModelingPreferences(DEFAULT_MODELING_PREFERENCES, parsed);
      }
    } catch {
      // Fallback on defaults
    }
    return DEFAULT_MODELING_PREFERENCES;
  });
  const preferencesRef = useRef<ModelingPreferences>(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage write errors (e.g. incognito quota)
    }
  }, [preferences]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void getUserPreferences()
      .then((remote) => {
        if (cancelled) return;
        const remoteModeling = remote?.modeling;
        if (remoteModeling && typeof remoteModeling === "object" && !Array.isArray(remoteModeling)) {
          const merged = syncModelingPreferences(
            DEFAULT_MODELING_PREFERENCES,
            remoteModeling as Partial<ModelingPreferences>,
          );
          preferencesRef.current = merged;
          setPreferences(merged);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          } catch {
            // Ignore storage write errors
          }
        }
      })
      .catch(() => {
        // Silent fallback to localStorage when offline or request fails
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (!e.newValue) {
        preferencesRef.current = DEFAULT_MODELING_PREFERENCES;
        setPreferences(DEFAULT_MODELING_PREFERENCES);
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue) as Partial<ModelingPreferences>;
        const synced = syncModelingPreferences(DEFAULT_MODELING_PREFERENCES, parsed);
        preferencesRef.current = synced;
        setPreferences(synced);
      } catch {
        // Ignore malformed storage payload from other tabs
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const updatePreferences = (updates: Partial<ModelingPreferences>) => {
    const next = syncModelingPreferences(preferencesRef.current, updates);
    preferencesRef.current = next;
    setPreferences(next);
    if (token) {
      void updateUserPreferences({ modeling: { ...next } }).catch(() => {
        // Silent fallback to localStorage when offline or request fails
      });
    }
  };

  const resetPreferences = () => {
    preferencesRef.current = DEFAULT_MODELING_PREFERENCES;
    setPreferences(DEFAULT_MODELING_PREFERENCES);
    if (token) {
      void updateUserPreferences({ modeling: { ...DEFAULT_MODELING_PREFERENCES } }).catch(() => {
        // Silent fallback to localStorage when offline or request fails
      });
    }
  };

  return (
    <ModelingPreferencesContext.Provider value={{ preferences, updatePreferences, resetPreferences }}>
      {children}
    </ModelingPreferencesContext.Provider>
  );
};

export const useModelingPreferences = (): ModelingPreferencesContextType => {
  const context = useContext(ModelingPreferencesContext);
  if (!context) {
    return {
      preferences: DEFAULT_MODELING_PREFERENCES,
      updatePreferences: () => {},
      resetPreferences: () => {},
    };
  }
  return context;
};
