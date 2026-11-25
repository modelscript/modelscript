// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bridges `apps/web`'s app-shell contexts (`Theme`, `FeatureFlags`, `Capabilities`,
 * `ModelingPreferences`, `Toast`, `api.ts`, `react-router-dom`, and
 * `virtual:modelscript-language-ui`) into `@modelscript/editor`'s `EditorHostProvider`.
 */

import { EditorHostProvider, registerEditorLanguageUi, type EditorHostAdapter } from "@modelscript/editor";
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ANSATZ_PANEL_LOADERS,
  ARTIFACT_PANEL_LOADERS,
  LANGUAGE_SIMULATION_CARDS,
  LANGUAGE_STENCILS,
  LANGUAGE_TOOLBAR_BUTTONS,
} from "virtual:modelscript-language-ui";
import { createAnsatzShortLink, getSimulationJobResult } from "../api";
import { useCapabilities } from "../CapabilitiesContext";
import { useFeatureFlags } from "../FeatureFlagContext";
import { useModelingPreferences } from "../ModelingPreferencesContext";
import { HERO_EXAMPLES } from "../pages/ansatz-editor/constants";
import { useTheme } from "../theme";
import { CloudSimulationModal } from "./cloud-sim/CloudSimulationModal";
import { useToast } from "./ToastContext";

const LazyReqifViewer = React.lazy(() => import("./artifacts/ReqifViewer").then((m) => ({ default: m.ReqifViewer })));

registerEditorLanguageUi({
  ansatzPanels: ANSATZ_PANEL_LOADERS,
  artifactPanels: ARTIFACT_PANEL_LOADERS,
  simulationCards: LANGUAGE_SIMULATION_CARDS,
  stencils: LANGUAGE_STENCILS,
  toolbarButtons: LANGUAGE_TOOLBAR_BUTTONS,
});

export const WebEditorHostBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme, toggleTheme } = useTheme();
  const { flags, isEnabled } = useFeatureFlags();
  const capabilities = useCapabilities();
  const { preferences, updatePreferences } = useModelingPreferences();
  const toast = useToast();
  const navigate = useNavigate();

  const host = useMemo<EditorHostAdapter>(
    () => ({
      theme: theme === "light" ? "light" : "dark",
      toggleTheme,
      featureFlags: flags,
      isFeatureEnabled: (flag) => (Array.isArray(flag) ? flag.some((k) => isEnabled(k)) : isEnabled(flag as string)),
      capabilities: capabilities as unknown as Record<string, unknown>,
      modelingPreferences: preferences as unknown as Record<string, unknown>,
      updateModelingPreferences: (patch) => updatePreferences(patch as never),
      notify: (msg, level) => {
        if (level === "error") toast.error(msg);
        else if (level === "warning") toast.warning(msg);
        else if (level === "success") toast.success(msg);
        else toast.info(msg);
      },
      createShortLink: async (payload) => createAnsatzShortLink(payload),
      getSimulationJobResult: async (jobId) => getSimulationJobResult(jobId),
      heroExamples: HERO_EXAMPLES as unknown as Array<Record<string, unknown>>,
      navigate: (path) => navigate(path),
      renderCloudSimulationModal: (modalProps) => (
        <CloudSimulationModal {...(modalProps as unknown as React.ComponentProps<typeof CloudSimulationModal>)} />
      ),
      renderReqifViewer: (viewerProps) => (
        <React.Suspense fallback={null}>
          <LazyReqifViewer {...(viewerProps as unknown as React.ComponentProps<typeof LazyReqifViewer>)} />
        </React.Suspense>
      ),
    }),
    [theme, toggleTheme, flags, isEnabled, capabilities, preferences, updatePreferences, toast, navigate],
  );

  return <EditorHostProvider host={host}>{children}</EditorHostProvider>;
};
