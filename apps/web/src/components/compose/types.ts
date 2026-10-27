// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NotebookCell, TutorialDifficulty } from "../../util/notebook";
import type { SpatialPin } from "../artifacts/spatial-pin";

export interface ComposeBoxProps {
  onPostCreated?: ((post: any) => void) | undefined;
  editPostId?: string | number | null | undefined;
  forkedFromArtifactId?: number | null | undefined;
  quotePost?: any;
  replyToPost?: any;
  placeholder?: string | undefined;
  minRows?: number | undefined;
  autoFocus?: boolean | undefined;
  pendingPin?: SpatialPin | undefined;
  content?: string | undefined;
  setContent?: ((val: string) => void) | undefined;
  artifactId?: number | null | undefined;
  setArtifactId?: ((val: number | null) => void) | undefined;
  isModal?: boolean | undefined;
  hideInput?: boolean | undefined;
  notebookMode?: boolean | undefined;
  setNotebookMode?: ((val: boolean) => void) | undefined;
  notebookTitle?: string | undefined;
  setNotebookTitle?: ((val: string) => void) | undefined;
  notebookSummary?: string | undefined;
  setNotebookSummary?: ((val: string) => void) | undefined;
  notebookDifficulty?: TutorialDifficulty | undefined;
  setNotebookDifficulty?: ((val: TutorialDifficulty | undefined) => void) | undefined;
  notebookSeries?: string | undefined;
  setNotebookSeries?: ((val: string) => void) | undefined;
  notebookDialect?: string | undefined;
  setNotebookDialect?: ((val: string) => void) | undefined;
  notebookCompanionRepo?: string | undefined;
  setNotebookCompanionRepo?: ((val: string) => void) | undefined;
  notebookCells?: NotebookCell[] | undefined;
  setNotebookCells?: ((cells: NotebookCell[]) => void) | undefined;
}
