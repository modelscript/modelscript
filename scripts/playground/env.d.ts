// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "*.css" {}

declare module "virtual:modelscript-playground-lang" {
  import type { LanguagePanelMode, LanguagePanelProps, LanguageSimulationCardProps } from "@modelscript/react";
  import type React from "react";

  export interface PlaygroundPanelEntry {
    id: string;
    title: string;
    shortTitle: string;
    viewType: string;
    targets: string[];
    Component: React.ComponentType<LanguagePanelProps>;
  }

  export interface PlaygroundSimulationCardEntry {
    id: string;
    title: string;
    standards: string[];
    Component: React.ComponentType<LanguageSimulationCardProps>;
  }

  export interface PlaygroundStencilEntry {
    label: string;
    snippet: string;
    className?: string;
    category?: string;
    icon?: string;
  }

  export interface PlaygroundSampleEntry {
    label: string;
    path: string;
  }

  export interface PlaygroundTreeViewEntry {
    id: string;
    name: string;
  }

  export interface PlaygroundToolbarButtonEntry {
    languageId: string;
    id: string;
    label: string;
    shortLabel?: string;
    tooltip?: string;
    icon?: string;
    views: ("diagram" | "icon" | "3d" | "simulation" | "inspector" | "code" | "*")[];
    targets: ("vscode" | "morsel" | "artifact")[];
    placement: "primary" | "overflow";
    order: number;
    kind: "action" | "toggle";
    actionId?: string;
    command?: string;
    shortcut?: string;
    featureFlag?: string;
  }

  export const PLAYGROUND_LANG: {
    id: string;
    name: string;
    displayName: string;
    packageName: string;
    fileExtensions: string[];
    primaryExtension: string;
    hasWasm: boolean;
    hasBindings: boolean;
    hasLsp: boolean;
    highlight: {
      keywords: string[];
      typeKeywords: string[];
      operators: string[];
      lineComment?: string;
      blockComment?: { open: string; close: string };
    };
    initialMode: LanguagePanelMode;
    initialTheme: "dark" | "light";
    initialDocumentUri: string;
    initialCode: string;
    initialSamplePath: string;
    stencils: PlaygroundStencilEntry[];
    toolbarButtons: PlaygroundToolbarButtonEntry[];
    treeViews: PlaygroundTreeViewEntry[];
    samples: PlaygroundSampleEntry[];
    panels: PlaygroundPanelEntry[];
    simulationCards: PlaygroundSimulationCardEntry[];
  };
}
