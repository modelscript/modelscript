// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import { createArtifactView, createPost, updatePost, uploadStorageFile } from "../../api";
import { getAllPrivateKeyIds, getPrivateKey, migrateLegacyKeys } from "../../util/keystore";
import {
  estimateReadingTimeMinutes,
  extractArtifactIdsFromCells,
  hasArtifactDirectives,
  type NotebookCell,
  parseNotebookFromContent,
  serializeCellsToMarkdown,
} from "../../util/notebook";
import type { SpatialPin } from "../artifacts/spatial-pin";

export interface AttachedMorselDraft {
  id?: number | undefined;
  code: string;
  title: string;
  dialect?: string | undefined;
  language?: string | undefined;
}

export interface UseComposeSubmitParams {
  token: string | null;
  content: string;
  setContent: (val: string) => void;
  artifactId: number | null;
  setArtifactId: (val: number | null) => void;
  attachedMorsel?: AttachedMorselDraft | null | undefined;
  setAttachedMorsel?: ((val: AttachedMorselDraft | null) => void) | undefined;
  isNotebookMode: boolean;
  setIsNotebookMode: (val: boolean) => void;
  notebookTitle: string;
  setNotebookTitle: (val: string) => void;
  notebookSummary: string;
  setNotebookSummary: (val: string) => void;
  notebookDifficulty: any;
  notebookSeries: string;
  setNotebookSeries: (val: string) => void;
  notebookDialect: string;
  notebookCompanionRepo: string;
  setNotebookCompanionRepo: (val: string) => void;
  notebookCells: NotebookCell[];
  setNotebookCells: (cells: NotebookCell[]) => void;
  attachArtifactToComposer: (newArtifactId: number, title?: string, suggestedCaption?: string) => void;
  contentWarning: string;
  setContentWarning: (val: string) => void;
  setShowContentWarning: (val: boolean) => void;
  replyVisibility: "everyone" | "following" | "mentioned";
  quotePost?: any;
  replyToPost?: any;
  editPostId?: string | number | null | undefined;
  forkedFromArtifactId?: number | null | undefined;
  pendingPin?: SpatialPin | undefined;
  excludedUsers?: Set<string> | undefined;
  onPostCreated?: ((post: any) => void) | undefined;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useComposeSubmit({
  token,
  content,
  setContent,
  artifactId,
  setArtifactId,
  attachedMorsel,
  setAttachedMorsel,
  isNotebookMode,
  setIsNotebookMode,
  notebookTitle,
  setNotebookTitle,
  notebookSummary,
  setNotebookSummary,
  notebookDifficulty,
  notebookSeries,
  setNotebookSeries,
  notebookDialect,
  notebookCompanionRepo,
  setNotebookCompanionRepo,
  notebookCells,
  setNotebookCells,
  attachArtifactToComposer,
  contentWarning,
  setContentWarning,
  setShowContentWarning,
  replyVisibility,
  quotePost,
  replyToPost,
  editPostId,
  forkedFromArtifactId,
  pendingPin,
  excludedUsers,
  onPostCreated,
  fileInputRef,
}: UseComposeSubmitParams) {
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0]!;
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadData = await uploadStorageFile(formData);
      const view_config = JSON.stringify({
        url: uploadData.url,
        ...(uploadData.svg ? { svg: uploadData.svg } : {}),
        ...(uploadData.thumbnail_url ? { thumbnailUrl: uploadData.thumbnail_url } : {}),
        ...(uploadData.view_config_additions || {}),
        ...(uploadData.metadata || {}),
      });

      const artifactData = await createArtifactView({
        artifact_type: uploadData.view_type,
        view_config,
        title: file.name,
      });
      attachArtifactToComposer(artifactData.id, file.name);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const signContent = async (text: string) => {
    try {
      await migrateLegacyKeys();
      const keyIds = await getAllPrivateKeyIds();
      if (keyIds.length === 0) return null;

      const keyIdString = keyIds[0]!;
      const cryptoKey = await getPrivateKey(keyIdString);
      if (!cryptoKey) return null;

      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const signatureBuffer = await window.crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, data);

      const signatureBytes = new Uint8Array(signatureBuffer);
      const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

      return { signatureBase64, keyIdString };
    } catch (e) {
      console.error("Signing failed", e);
      return null;
    }
  };

  const hasNotebookContent =
    isNotebookMode &&
    (notebookTitle.trim().length > 0 ||
      notebookCells.some((c) => (c.type === "markdown" ? c.content.trim().length > 0 : Boolean(c.artifactId))));

  const hasAttachedMorsel = Boolean(attachedMorsel && (attachedMorsel.id || attachedMorsel.code?.trim()));

  const handleSubmit = async () => {
    if ((!content.trim() && !artifactId && !hasNotebookContent && !hasAttachedMorsel) || !token) return;
    setSubmitting(true);
    try {
      let resolvedArtifactId = artifactId;
      if (!resolvedArtifactId && attachedMorsel) {
        if (attachedMorsel.id) {
          resolvedArtifactId = attachedMorsel.id;
        } else if (attachedMorsel.code) {
          const morselDialect = attachedMorsel.dialect || attachedMorsel.language || "modelica";
          const morselTitle = attachedMorsel.title || "Model";
          const created = await createArtifactView({
            artifact_type: morselDialect === "modelica" ? "modelica-diagram" : morselDialect,
            dialect: morselDialect,
            title: morselTitle,
            view_config: JSON.stringify({
              code: attachedMorsel.code,
              title: morselTitle,
              dialect: morselDialect,
            }),
          });
          if (created?.id) {
            resolvedArtifactId = created.id;
            setArtifactId(created.id);
          }
        }
      }

      const effectiveCells = isNotebookMode
        ? notebookCells.filter((c) => (c.type === "markdown" ? c.content.trim().length > 0 : Boolean(c.artifactId)))
        : hasArtifactDirectives(content)
          ? parseNotebookFromContent(content, resolvedArtifactId).cells
          : null;

      const effectiveArtIds = effectiveCells ? extractArtifactIdsFromCells(effectiveCells) : [];
      const primaryArtifactId = effectiveArtIds[0] ?? resolvedArtifactId ?? undefined;
      const text = isNotebookMode
        ? serializeCellsToMarkdown(effectiveCells || [], notebookTitle).trim()
        : content.trim();

      const signatureObj = await signContent(text);

      const notebookPayload =
        effectiveCells && (isNotebookMode || effectiveArtIds.length > 1 || hasArtifactDirectives(text))
          ? {
              isNotebook: true,
              ...(notebookTitle.trim() ? { title: notebookTitle.trim() } : {}),
              ...(notebookSummary.trim() ? { summary: notebookSummary.trim() } : {}),
              ...(notebookDifficulty ? { difficulty: notebookDifficulty } : {}),
              ...(notebookSeries.trim() ? { series: notebookSeries.trim() } : {}),
              ...(notebookDialect.trim() ? { dialect: notebookDialect.trim() } : {}),
              ...(notebookCompanionRepo.trim() ? { companionRepo: notebookCompanionRepo.trim() } : {}),
              estimatedReadMinutes: estimateReadingTimeMinutes(effectiveCells),
              cells: effectiveCells,
              artifactIds: effectiveArtIds,
            }
          : undefined;

      const excludedList = excludedUsers && excludedUsers.size > 0 ? Array.from(excludedUsers) : undefined;

      const payload: any = {
        content: text,
        content_warning: contentWarning.trim() || undefined,
        artifact_view_id: primaryArtifactId,
        quote_post_id: quotePost?.id,
        reply_to_id: replyToPost?.id,
        reply_visibility: replyVisibility,
        ...(excludedList ? { excluded_mentions: excludedList } : {}),
        ...(notebookPayload ? { notebook: notebookPayload } : {}),
        metadata: {
          ...(pendingPin ? { spatialPin: pendingPin } : {}),
          ...(contentWarning.trim() ? { contentWarning: contentWarning.trim() } : {}),
          ...(notebookPayload ? { notebook: notebookPayload } : {}),
          ...(forkedFromArtifactId ? { forkedFromArtifactId } : {}),
          ...(excludedList ? { excludedMentions: excludedList } : {}),
        },
      };

      if (signatureObj) {
        payload.client_signature = signatureObj.signatureBase64;
        payload.key_id_string = signatureObj.keyIdString;
      }

      const data = editPostId ? await updatePost(editPostId, payload) : await createPost(payload);
      setContent("");
      setContentWarning("");
      setShowContentWarning(false);
      setArtifactId(null);
      setAttachedMorsel?.(null);
      setNotebookTitle("");
      setNotebookSummary("");
      setNotebookSeries("");
      setNotebookCompanionRepo("");
      setNotebookCells([{ id: "md-1", type: "markdown", content: "" }]);
      setIsNotebookMode(false);
      onPostCreated?.(data.post);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    submitting,
    uploadingFile,
    hasNotebookContent,
    handleSubmit,
    handleFileUpload,
  };
}
