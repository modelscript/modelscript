// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "virtual:modelscript-language-ui" {
  import type { LanguagePanelProps, LanguageSimulationCardProps } from "@modelscript/react";
  import type React from "react";

  export interface LanguagePanelMetaEntry {
    languageId: string;
    id: string;
    viewType: string;
    title: string;
    shortTitle?: string;
    targets: ("vscode" | "morsel" | "artifact")[];
    artifactViewTypes: string[];
  }

  export interface LanguageStencilEntry {
    label: string;
    snippet: string;
    className?: string;
    category?: string;
    icon?: string;
  }

  export interface LanguageSimulationCardEntry {
    languageId: string;
    id: string;
    title: string;
    load: () => Promise<{ default: React.ComponentType<LanguageSimulationCardProps> }>;
  }

  export type LanguagePanelLoader = () => Promise<{ default: React.ComponentType<LanguagePanelProps> }>;

  export const LANGUAGE_PANEL_META: LanguagePanelMetaEntry[];
  export const MORSEL_PANEL_LOADERS: Record<string, LanguagePanelLoader>;
  export const ARTIFACT_PANEL_LOADERS: Record<string, LanguagePanelLoader>;
  export const LANGUAGE_STENCILS: Record<string, LanguageStencilEntry[]>;
  export const LANGUAGE_SIMULATION_CARDS: LanguageSimulationCardEntry[];
}
