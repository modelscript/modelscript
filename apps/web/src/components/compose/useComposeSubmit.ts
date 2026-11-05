// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createArtifactView,
  createPost,
  getArtifactView,
  listMyArtifactViews,
  updateArtifactView,
  updatePost,
  uploadStorageFile,
} from "../../api";
import { getAllPrivateKeyIds, getPrivateKey, migrateLegacyKeys } from "../../util/keystore";
import {
  estimateReadingTimeMinutes,
  extractArtifactIdsFromCells,
  hasArtifactDirectives,
  type NotebookCell,
  parseNotebookFromContent,
  serializeCellsToMarkdown,
} from "../../util/notebook";
import { getPostUrl } from "../../util/url";
import type { SpatialPin } from "../artifacts/spatial-pin";
import { useToast } from "../ToastContext";
import { type AttachContext, extractArtifactSourceText, toEditableView, useAttachFlow } from "./attach";

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
  artifactId: number | string | null;
  setArtifactId: (val: number | string | null) => void;
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
  notebookTopics: string[];
  setNotebookTopics: (val: string[]) => void;
  notebookCells: NotebookCell[];
  setNotebookCells: (cells: NotebookCell[]) => void;
  attachArtifactToComposer: (newArtifactId: number | string, title?: string, suggestedCaption?: string) => void;
  contentWarning: string;
  setContentWarning: (val: string) => void;
  setShowContentWarning: (val: boolean) => void;
  visibility?: "public" | "unlisted" | "followers" | "direct" | undefined;
  replyVisibility: "everyone" | "following" | "mentioned";
  quotePost?: any;
  replyToPost?: any;
  editPostId?: string | number | null | undefined;
  forkedFromArtifactId?: number | string | null | undefined;
  pendingPin?: SpatialPin | undefined;
  excludedUsers?: Set<string> | undefined;
  onPostCreated?: ((post: any) => void) | undefined;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** Called after the attach wizard saved a customization to an existing artifact. */
  onArtifactEdited?: ((artifactId: number | string) => void) | undefined;
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
  notebookTopics,
  setNotebookTopics,
  notebookCells,
  setNotebookCells,
  attachArtifactToComposer,
  contentWarning,
  setContentWarning,
  setShowContentWarning,
  visibility = "public",
  replyVisibility,
  quotePost,
  replyToPost,
  editPostId,
  forkedFromArtifactId,
  pendingPin,
  excludedUsers,
  onPostCreated,
  fileInputRef,
  onArtifactEdited,
}: UseComposeSubmitParams) {
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const attachCtx = useMemo<AttachContext>(
    () => ({
      uploadFile: async (file, options) => {
        const formData = new FormData();
        for (const [key, value] of Object.entries(options?.fields ?? {})) formData.append(key, value);
        formData.append("file", file);
        return uploadStorageFile(formData);
      },
      createArtifact: async (input) => {
        const created = await createArtifactView({
          artifact_type: input.artifact_type,
          view_config: JSON.stringify(input.view_config),
          title: input.title,
        });
        return { id: created.id };
      },
      listArtifacts: async ({ types }) => {
        const rows = await listMyArtifactViews({ types, limit: 100 });
        return rows.map((r) => ({
          id: r.id,
          title: r.title || `Artifact ${r.id}`,
          viewType: r.view_type,
          ...(r.thumbnail_url ? { thumbnailUrl: r.thumbnail_url } : {}),
        }));
      },
      loadArtifactSource: async (id) => {
        const view = await getArtifactView(id);
        return extractArtifactSourceText(view);
      },
      loadArtifactView: async (id) => toEditableView(await getArtifactView(id)),
      updateArtifact: async (id, patch) => {
        await updateArtifactView(id, { view_config: patch.view_config });
      },
    }),
    [],
  );

  const attachFlow = useAttachFlow({
    ctx: attachCtx,
    onAttached: attachArtifactToComposer,
    onEdited: onArtifactEdited,
  });
  const uploadingFile = attachFlow.busy;

  /** Entry point for the file picker, drag-drop and paste: hands each file to its language's attach profile. */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files || e.target.files.length === 0) return;
    attachFlow.startMany(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
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
        : notebookCells.some((c) => Boolean(c.artifactId))
          ? notebookCells.filter((c) => Boolean(c.artifactId))
          : hasArtifactDirectives(content)
            ? parseNotebookFromContent(content, resolvedArtifactId).cells
            : null;

      const effectiveArtIds = effectiveCells
        ? extractArtifactIdsFromCells(effectiveCells)
        : resolvedArtifactId
          ? [resolvedArtifactId]
          : [];
      const primaryArtifactId = effectiveArtIds[0] ?? resolvedArtifactId ?? undefined;
      const text = isNotebookMode
        ? serializeCellsToMarkdown(effectiveCells || [], notebookTitle).trim()
        : content.trim();

      const signatureObj = await signContent(text);

      const notebookPayload =
        isNotebookMode && effectiveCells
          ? {
              isNotebook: true,
              ...(notebookTitle.trim() ? { title: notebookTitle.trim() } : {}),
              ...(notebookSummary.trim() ? { summary: notebookSummary.trim() } : {}),
              ...(notebookDifficulty ? { difficulty: notebookDifficulty } : {}),
              ...(notebookSeries.trim() ? { series: notebookSeries.trim() } : {}),
              ...(notebookDialect.trim() ? { dialect: notebookDialect.trim() } : {}),
              ...(notebookCompanionRepo.trim() ? { companionRepo: notebookCompanionRepo.trim() } : {}),
              ...(notebookTopics.length > 0 ? { topics: notebookTopics } : {}),
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
        visibility,
        reply_visibility: replyVisibility,
        ...(excludedList ? { excluded_mentions: excludedList } : {}),
        ...(notebookPayload ? { notebook: notebookPayload } : {}),
        metadata: {
          ...(pendingPin ? { spatialPin: pendingPin } : {}),
          ...(contentWarning.trim() ? { contentWarning: contentWarning.trim() } : {}),
          ...(notebookPayload ? { notebook: notebookPayload } : {}),
          ...(!isNotebookMode && effectiveArtIds.length > 0 ? { artifactIds: effectiveArtIds.slice(0, 4) } : {}),
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
      setNotebookTopics([]);
      setNotebookCells([{ id: "md-1", type: "markdown", content: "" }]);
      setIsNotebookMode(false);

      const post = data?.post;
      const postUrl = getPostUrl(post);

      toast.toast({
        type: "success",
        title: editPostId ? "Post updated" : replyToPost ? "Reply posted" : "Post published",
        message: editPostId
          ? "Your changes have been saved."
          : replyToPost
            ? "Your reply is now live."
            : "Your post is now live.",
        duration: 6000,
        action: postUrl
          ? {
              label: "View post",
              href: postUrl,
              onClick: () => {
                navigate(postUrl);
              },
            }
          : undefined,
      });

      onPostCreated?.(data.post);
    } catch (err: unknown) {
      console.error(err);
      const errObj = err as { response?: { data?: { error?: string } }; message?: string } | undefined;
      toast.error(errObj?.response?.data?.error || errObj?.message || "Failed to publish post. Please try again.");
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
    attachFlow,
  };
}
