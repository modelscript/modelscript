// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { NotebookCell } from "../util/notebook";
import type { SpatialPin } from "./artifacts/spatial-pin";

export interface ComposeInitialState {
  content?: string | undefined;
  defaultText?: string | undefined;
  artifactId?: number | null | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  forkedFromArtifactId?: number | null | undefined;
  notebookMode?: boolean | undefined;
  notebookTitle?: string | undefined;
  notebookCells?: NotebookCell[] | undefined;
  morselPayload?:
    | {
        code: string;
        title?: string | undefined;
        dialect?: string | undefined;
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
