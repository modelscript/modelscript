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
    targets: ("vscode" | "ansatz" | "artifact")[];
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

  export interface LanguageToolbarButtonEntry {
    languageId: string;
    id: string;
    label: string;
    shortLabel?: string;
    tooltip?: string;
    icon?: string;
    views: ("diagram" | "icon" | "3d" | "simulation" | "inspector" | "code" | "*")[];
    targets: ("vscode" | "ansatz" | "artifact")[];
    placement: "primary" | "overflow";
    order: number;
    kind: "action" | "toggle";
    actionId?: string;
    command?: string;
    shortcut?: string;
    featureFlag?: string;
  }

  export type LanguagePanelLoader = () => Promise<{ default: React.ComponentType<LanguagePanelProps> }>;

  export const LANGUAGE_PANEL_META: LanguagePanelMetaEntry[];
  export const ANSATZ_PANEL_LOADERS: Record<string, LanguagePanelLoader>;
  export const ARTIFACT_PANEL_LOADERS: Record<string, LanguagePanelLoader>;
  export const LANGUAGE_STENCILS: Record<string, LanguageStencilEntry[]>;
  export const LANGUAGE_SIMULATION_CARDS: LanguageSimulationCardEntry[];
  export const LANGUAGE_TOOLBAR_BUTTONS: Record<string, LanguageToolbarButtonEntry[]>;
}
