// SPDX-License-Identifier: AGPL-3.0-or-later

import { PencilIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getArtifactView } from "../../api";
import { buildEditorUrlForArtifact, isMultiFileArtifact } from "../../util/editor-routing";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";

export interface ComposeAttachedArtifactProps {
  artifactId: number | null;
  editPostId?: string | number | null | undefined;
  onRemove: () => void;
}

export const ComposeAttachedArtifact: React.FC<ComposeAttachedArtifactProps> = ({
  artifactId,
  editPostId,
  onRemove,
}) => {
  const navigate = useNavigate();
  const [artifactView, setArtifactView] = useState<any>(null);
  const [isMultiFile, setIsMultiFile] = useState(false);

  useEffect(() => {
    if (artifactId === null) return;
    getArtifactView(artifactId)
      .then((res) => {
        const view = (res as any)?.artifactView || (res as any)?.artifact_view || res;
        const viewType = view?.view_type || view?.artifact_type || "";
        setArtifactView(view);
        setIsMultiFile(
          isMultiFileArtifact({
            ...view,
            view_type: viewType,
          }),
        );
      })
      .catch(() => {
        setArtifactView(null);
        setIsMultiFile(false);
      });
  }, [artifactId]);

  if (artifactId === null) return null;

  const numericEditPostId =
    editPostId !== null && editPostId !== undefined && !Number.isNaN(Number(editPostId))
      ? Number(editPostId)
      : undefined;

  const targetUrl = buildEditorUrlForArtifact({
    artifactId,
    viewType: artifactView?.view_type || artifactView?.artifact_type,
    viewConfig: artifactView?.view_config,
    title: artifactView?.title,
    mode: numericEditPostId !== undefined ? "edit" : "open",
    editPostId: numericEditPostId,
  });

  return (
    <div
      style={{
        position: "relative",
        marginTop: "8px",
        marginBottom: "8px",
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid var(--color-border)",
      }}
    >
      <ArtifactViewCard artifactId={artifactId} />
      <div
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(targetUrl);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            backgroundColor: "rgba(0, 0, 0, 0.78)",
            color: "var(--color-accent-cyan, #06b6d4)",
            border: "1px solid rgba(6, 182, 212, 0.4)",
            borderRadius: "999px",
            padding: "5px 11px",
            fontSize: "11.5px",
            fontFamily: "var(--font-mono, monospace)",
            fontWeight: 600,
            cursor: "pointer",
          }}
          title={isMultiFile ? "Edit in Web IDE" : "Edit in Playground"}
        >
          <PencilIcon size={12} />
          <span>{isMultiFile ? "Edit in IDE" : "Edit in Playground"}</span>
        </button>
        <IconButton
          icon={XIcon}
          variant="invisible"
          onClick={onRemove}
          aria-label="Remove artifact"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            color: "white",
            border: "none",
            boxShadow: "none",
            borderRadius: "50%",
            width: "32px",
            height: "32px",
          }}
        />
      </div>
    </div>
  );
};
