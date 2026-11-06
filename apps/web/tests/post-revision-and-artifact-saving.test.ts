// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { computeSimpleLineDiff } from "../src/components/post/diff";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Post Revision History & In-Place Artifact Saving", () => {
  describe("computeSimpleLineDiff algorithm", () => {
    it("handles identical text with all unchanged lines", () => {
      const text = "model M\n  Real x;\nequation\n  x = 1;\nend M;";
      const diff = computeSimpleLineDiff(text, text);
      assert.strictEqual(diff.length, 5);
      assert.ok(diff.every((d) => d.type === "unchanged"));
    });

    it("detects line additions correctly", () => {
      const oldText = "line 1\nline 3";
      const newText = "line 1\nline 2\nline 3";
      const diff = computeSimpleLineDiff(oldText, newText);
      assert.strictEqual(diff.length, 3);
      assert.strictEqual(diff[0]?.type, "unchanged");
      assert.strictEqual(diff[1]?.type, "added");
      assert.strictEqual(diff[1]?.text, "line 2");
      assert.strictEqual(diff[2]?.type, "unchanged");
    });

    it("detects line removals correctly", () => {
      const oldText = "line 1\nline 2 (removed)\nline 3";
      const newText = "line 1\nline 3";
      const diff = computeSimpleLineDiff(oldText, newText);
      assert.strictEqual(diff.length, 3);
      assert.strictEqual(diff[0]?.type, "unchanged");
      assert.strictEqual(diff[1]?.type, "removed");
      assert.strictEqual(diff[1]?.text, "line 2 (removed)");
      assert.strictEqual(diff[2]?.type, "unchanged");
    });

    it("detects multiline replacements as removal + addition", () => {
      const oldText = "Hello World";
      const newText = "Hello Ansatz Engineering";
      const diff = computeSimpleLineDiff(oldText, newText);
      assert.strictEqual(diff.length, 2);
      assert.strictEqual(diff[0]?.type, "removed");
      assert.strictEqual(diff[0]?.text, "Hello World");
      assert.strictEqual(diff[1]?.type, "added");
      assert.strictEqual(diff[1]?.text, "Hello Ansatz Engineering");
    });
  });

  describe("Static Invariants & Component Wire-up", () => {
    const modalPath = path.resolve(__dirname, "../src/components/post/PostRevisionHistoryModal.tsx");
    const authorHeaderPath = path.resolve(__dirname, "../src/components/post/PostAuthorHeader.tsx");
    const actionsBarPath = path.resolve(__dirname, "../src/components/post/PostActionsBar.tsx");
    const actionMenuPath = path.resolve(__dirname, "../src/components/post/PostActionMenu.tsx");
    const postPath = path.resolve(__dirname, "../src/components/Post.tsx");
    const modelicaViewerPath = path.resolve(__dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx");
    const reqifViewerPath = path.resolve(__dirname, "../src/components/artifacts/ReqifViewer.tsx");
    const studioHeaderPath = path.resolve(__dirname, "../src/components/artifacts/card/StudioHeader.tsx");

    const modalSrc = fs.readFileSync(modalPath, "utf-8");
    const authorHeaderSrc = fs.readFileSync(authorHeaderPath, "utf-8");
    const actionsBarSrc = fs.readFileSync(actionsBarPath, "utf-8");
    const actionMenuSrc = fs.readFileSync(actionMenuPath, "utf-8");
    const postSrc = fs.readFileSync(postPath, "utf-8");
    const modelicaViewerSrc = fs.readFileSync(modelicaViewerPath, "utf-8");
    const reqifViewerSrc = fs.readFileSync(reqifViewerPath, "utf-8");
    const studioHeaderSrc = fs.readFileSync(studioHeaderPath, "utf-8");

    it("PostRevisionHistoryModal fetches from getPostRevisions and renders cryptographic evidence details", () => {
      assert.ok(modalSrc.includes("getPostRevisions(postId)"), "Must fetch revisions via getPostRevisions SDK");
      assert.ok(modalSrc.includes("computeSimpleLineDiff"), "Must compute diff between revisions");
      assert.ok(modalSrc.includes("Signed Evidence Verified"), "Must render signed verification state badge");
      assert.ok(modalSrc.includes("msx verify"), "Must mention msx verify independent verification command");
    });

    it("PostAuthorHeader wires onOpenRevisionModal to (edited) badge and PostActionMenu", () => {
      assert.ok(
        authorHeaderSrc.includes("onOpenRevisionModal"),
        "PostAuthorHeader must accept onOpenRevisionModal prop",
      );
      assert.ok(
        authorHeaderSrc.includes("onOpenRevisionModal?.()"),
        "Clicking edited badge must trigger onOpenRevisionModal",
      );
      assert.ok(
        authorHeaderSrc.includes('aria-label="View edit history"'),
        "Must have accessible label for screen readers",
      );
    });

    it("PostActionsBar wires onOpenRevisionModal to Edited badge", () => {
      assert.ok(actionsBarSrc.includes("onOpenRevisionModal"), "PostActionsBar must accept onOpenRevisionModal prop");
      assert.ok(
        actionsBarSrc.includes('aria-label="View edit history"'),
        "Must have accessible label for screen readers",
      );
    });

    it("PostActionMenu renders 'View edit history' when post was updated", () => {
      assert.ok(actionMenuSrc.includes("View edit history"), "PostActionMenu must render 'View edit history' option");
      assert.ok(actionMenuSrc.includes("<HistoryIcon"), "Must display HistoryIcon next to edit history menu button");
    });

    it("Post.tsx coordinates showRevisionModal state and mounts PostRevisionHistoryModal", () => {
      assert.ok(postSrc.includes("showRevisionModal"), "Post.tsx must declare showRevisionModal state");
      assert.ok(postSrc.includes("<PostRevisionHistoryModal"), "Post.tsx must mount PostRevisionHistoryModal");
      assert.ok(
        postSrc.includes("onOpenRevisionModal: () => setShowRevisionModal(true)"),
        "Must pass callback to header and actions bar",
      );
    });

    it("ModelicaDiagramViewer enables in-place saving back to artifact view", () => {
      assert.ok(
        modelicaViewerSrc.includes("updateArtifactView("),
        "Must call updateArtifactView to persist code changes",
      );
      assert.ok(modelicaViewerSrc.includes("hasUnsavedChanges"), "Must detect unsaved code modifications");
      assert.ok(modelicaViewerSrc.includes("Save Artifact"), "Must render 'Save Artifact' button in toolbar");
      assert.ok(
        modelicaViewerSrc.includes("modelscript:artifact-updated"),
        "Must dispatch custom event to notify feed surfaces",
      );
    });

    it("ReqifViewer enables in-place saving back to artifact view", () => {
      assert.ok(
        reqifViewerSrc.includes("updateArtifactView("),
        "Must call updateArtifactView to persist ReqIF changes",
      );
      assert.ok(reqifViewerSrc.includes("Save to Artifact"), "Must render 'Save to Artifact' button in TopBar");
      assert.ok(
        reqifViewerSrc.includes("modelscript:artifact-updated"),
        "Must dispatch custom event to notify feed surfaces",
      );
    });

    it("StudioHeader provides prominent Save Artifact button for unsaved changes in full-screen", () => {
      assert.ok(studioHeaderSrc.includes("onSaveArtifact"), "StudioHeaderProps must accept onSaveArtifact");
      assert.ok(studioHeaderSrc.includes("Save Artifact"), "Must render Save Artifact button when changes are present");
    });
  });
});
