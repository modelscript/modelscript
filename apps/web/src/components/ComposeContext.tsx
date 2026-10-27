// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { NotebookCell, TutorialDifficulty } from "../util/notebook";
import type { SpatialPin } from "./artifacts/spatial-pin";

export interface ComposeInitialState {
  editPostId?: number | null | undefined;
  replyToPostId?: number | null | undefined;
  content?: string | undefined;
  defaultText?: string | undefined;
  artifactId?: number | null | undefined;
  artifactViewId?: number | null | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  forkedFromArtifactId?: number | null | undefined;
  notebookMode?: boolean | undefined;
  isNotebookMode?: boolean | undefined;
  notebookTitle?: string | undefined;
  notebookSummary?: string | undefined;
  notebookDifficulty?: TutorialDifficulty | undefined;
  notebookSeries?: string | undefined;
  notebookDialect?: string | undefined;
  notebookCompanionRepo?: string | undefined;
  notebookCells?: NotebookCell[] | undefined;
  initialDialect?: string | undefined;
  initialTitle?: string | undefined;
  companionRepo?: string | undefined;
  morselPayload?:
    | {
        code: string;
        title?: string | undefined;
        dialect?: string | undefined;
        isMultiFile?: boolean | undefined;
        files?: Record<string, string> | undefined;
        primaryFile?: string | undefined;
        forkedFromArtifactId?: number | null | undefined;
      }
    | undefined;
  packagePayload?:
    | {
        name: string;
        version?: string | undefined;
        description?: string | undefined;
        license?: string | undefined;
        dialect?: string | undefined;
      }
    | undefined;
  repoPayload?:
    | {
        namespace: string;
        project: string;
        provider?: string | undefined;
        description?: string | undefined;
        defaultBranch?: string | undefined;
      }
    | undefined;
}

export interface ComposeContextType {
  openCompose: (initial?: string | ComposeInitialState) => void;
}

export const ComposeContext = React.createContext<ComposeContextType>({
  openCompose: () => {},
});
