// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useContext, useEffect, useState } from "react";

export interface ModelingPreferences {
  // Monaco Code Editor
  fontSize: number;
  tabSize: number;
  wordWrap: "on" | "off";
  minimapEnabled: boolean;
  bracketPairColorization: boolean;

  // ModelScript Compiler
  flattenerBackend: "hybrid" | "wasm" | "ts";
  lintOnType: boolean;
  enableExperimentalFeatures: boolean;

  // Numerical Simulation
  defaultSolver: "cvode" | "ida" | "dopri5" | "rk4";
  defaultRelativeTolerance: number;
  diagramAutoLayout: boolean;
}

export const DEFAULT_MODELING_PREFERENCES: ModelingPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: "on",
  minimapEnabled: true,
  bracketPairColorization: true,

  flattenerBackend: "hybrid",
  lintOnType: true,
  enableExperimentalFeatures: false,

  defaultSolver: "cvode",
  defaultRelativeTolerance: 1e-4,
  diagramAutoLayout: true,
};

const STORAGE_KEY = "modelscript_modeling_preferences";

interface ModelingPreferencesContextType {
  preferences: ModelingPreferences;
  updatePreferences: (updates: Partial<ModelingPreferences>) => void;
  resetPreferences: () => void;
}

const ModelingPreferencesContext = createContext<ModelingPreferencesContextType | undefined>(undefined);

export const ModelingPreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<ModelingPreferences>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_MODELING_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch {
      // Fallback on defaults
    }
    return DEFAULT_MODELING_PREFERENCES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage write errors (e.g. incognito quota)
    }
  }, [preferences]);

  const updatePreferences = (updates: Partial<ModelingPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...updates }));
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_MODELING_PREFERENCES);
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
