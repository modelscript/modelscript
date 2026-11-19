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
    initialMode: LanguagePanelMode;
    initialTheme: "dark" | "light";
    initialDocumentUri: string;
    initialCode: string;
    initialSamplePath: string;
    stencils: PlaygroundStencilEntry[];
    treeViews: PlaygroundTreeViewEntry[];
    samples: PlaygroundSampleEntry[];
    panels: PlaygroundPanelEntry[];
    simulationCards: PlaygroundSimulationCardEntry[];
  };
}
