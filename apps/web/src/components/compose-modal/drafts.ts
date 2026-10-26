// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DraftPost } from "./types";

export const getDrafts = (): DraftPost[] => {
  try {
    return JSON.parse(localStorage.getItem("post_drafts") || "[]");
  } catch {
    return [];
  }
};

export const upsertDraft = (draft: DraftPost): void => {
  try {
    const drafts = getDrafts();
    const existingIdx = drafts.findIndex((d) => d.id === draft.id);
    if (existingIdx >= 0) {
      drafts[existingIdx] = draft;
    } else {
      drafts.unshift(draft);
    }
    localStorage.setItem("post_drafts", JSON.stringify(drafts));
  } catch {
    // Ignore storage quota or security errors
  }
};

export const deleteDraft = (id: string): void => {
  try {
    const drafts = getDrafts();
    localStorage.setItem("post_drafts", JSON.stringify(drafts.filter((d) => d.id !== id)));
  } catch {
    // Ignore storage quota or security errors
  }
};
