// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NotebookCell, TutorialDifficulty } from "../../util/notebook";
import type { SpatialPin } from "../artifacts/spatial-pin";
import type { ComposeInitialState } from "../ComposeContext";

export interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: ((post: any) => void) | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  initialState?: ComposeInitialState | undefined;
}

export interface DraftPost {
  id: string;
  content: string;
  artifactId: number | null;
  notebookMode?: boolean | undefined;
  notebookTitle?: string | undefined;
  notebookSummary?: string | undefined;
  notebookDifficulty?: TutorialDifficulty | undefined;
  notebookSeries?: string | undefined;
  notebookDialect?: string | undefined;
  notebookCompanionRepo?: string | undefined;
  notebookCells?: NotebookCell[] | undefined;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin | undefined;
  timestamp: number;
}
