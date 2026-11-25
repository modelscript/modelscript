// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NotebookCell, TutorialDifficulty } from "../../util/notebook";
import type { SpatialPin } from "../artifacts/spatial-pin";
import type { ComposePostRef, CreatedPostItem } from "../compose/types";
import type { ComposeInitialState } from "../ComposeContext";

export interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: ((post: CreatedPostItem) => void) | undefined;
  quotePost?: ComposePostRef | null | undefined;
  replyToPost?: ComposePostRef | null | undefined;
  pendingPin?: SpatialPin | undefined;
  initialState?: ComposeInitialState | undefined;
}

export interface DraftPost {
  id: string;
  content: string;
  artifactId: number | string | null;
  notebookMode?: boolean | undefined;
  notebookTitle?: string | undefined;
  notebookSummary?: string | undefined;
  notebookDifficulty?: TutorialDifficulty | undefined;
  notebookSeries?: string | undefined;
  notebookDialect?: string | undefined;
  notebookCompanionRepo?: string | undefined;
  notebookTopics?: string[] | undefined;
  notebookCells?: NotebookCell[] | undefined;
  quotePost?: ComposePostRef | null | undefined;
  replyToPost?: ComposePostRef | null | undefined;
  pendingPin?: SpatialPin | undefined;
  timestamp: number;
}
