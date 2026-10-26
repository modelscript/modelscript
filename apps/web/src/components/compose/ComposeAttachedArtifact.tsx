// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";

export interface ComposeAttachedArtifactProps {
  artifactId: number | null;
  onRemove: () => void;
}

export const ComposeAttachedArtifact: React.FC<ComposeAttachedArtifactProps> = ({ artifactId, onRemove }) => {
  if (artifactId === null) return null;

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
      <div style={{ position: "absolute", top: "8px", right: "8px", zIndex: 10 }}>
        <IconButton
          icon={XIcon}
          variant="invisible"
          onClick={onRemove}
          aria-label="Remove artifact"
          sx={{
            backgroundColor: "rgba(0, 0, 0, 0.75) !important",
            color: "white !important",
            border: "none !important",
            boxShadow: "none !important",
            borderRadius: "50%",
            width: "32px",
            height: "32px",
            "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.9) !important" },
          }}
        />
      </div>
    </div>
  );
};
