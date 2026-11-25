// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PostItem } from "../../types/api";
import type { NotebookCell, TutorialDifficulty } from "../../util/notebook";
import type { SpatialPin } from "../artifacts/spatial-pin";
import type { NestedQuoteData } from "./ComposeQuoteAndPin";

export interface ComposePostRef {
  id?: number | string | null | undefined;
  username?: string | null | undefined;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  author_username?: string | null | undefined;
  author_display_name?: string | null | undefined;
  content?: string | null | undefined;
  created_at?: string | null | undefined;
  author?:
    | {
        username?: string | null | undefined;
        display_name?: string | null | undefined;
        displayName?: string | null | undefined;
        avatar_url?: string | null | undefined;
      }
    | null
    | undefined;
  user?:
    | {
        username?: string | null | undefined;
        avatar_url?: string | null | undefined;
      }
    | null
    | undefined;
  quote_post?: NestedQuoteData | null | undefined;
  quotePost?: NestedQuoteData | null | undefined;
  quote_post_id?: number | string | null | undefined;
  quotePostId?: number | string | null | undefined;
}

export interface CreatedPostItem extends PostItem {
  author?: { username?: string | null | undefined } | null | undefined;
  content_warning?: string | null | undefined;
}

export interface ComposeBoxProps {
  onPostCreated?: ((post: CreatedPostItem) => void) | undefined;
  editPostId?: string | number | null | undefined;
  forkedFromArtifactId?: number | string | null | undefined;
  quotePost?: ComposePostRef | null | undefined;
  replyToPost?: ComposePostRef | null | undefined;
  placeholder?: string | undefined;
  minRows?: number | undefined;
  autoFocus?: boolean | undefined;
  pendingPin?: SpatialPin | undefined;
  content?: string | undefined;
  setContent?: ((val: string) => void) | undefined;
  contentWarning?: string | undefined;
  setContentWarning?: ((val: string) => void) | undefined;
  artifactId?: number | string | null | undefined;
  setArtifactId?: ((val: number | string | null) => void) | undefined;
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
  notebookTopics?: string[] | undefined;
  setNotebookTopics?: ((val: string[]) => void) | undefined;
  notebookCells?: NotebookCell[] | undefined;
  setNotebookCells?: ((cells: NotebookCell[]) => void) | undefined;
  onCloseModal?: (() => void) | undefined;
  onOpenDrafts?: (() => void) | undefined;
  editorLayout?: "write" | "split" | "preview" | undefined;
  setEditorLayout?: ((layout: "write" | "split" | "preview") => void) | undefined;
}
