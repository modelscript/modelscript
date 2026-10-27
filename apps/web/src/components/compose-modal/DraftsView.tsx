// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, TrashIcon } from "@primer/octicons-react";
import { Heading, IconButton } from "@primer/react";
import React from "react";
import Box from "../Box";
import { Header } from "./styles";
import type { DraftPost } from "./types";

interface DraftsViewProps {
  draftsList: DraftPost[];
  onBack: () => void;
  onSelectDraft: (draft: DraftPost) => void;
  onDeleteDraft: (id: string) => void;
}

export const DraftsView: React.FC<DraftsViewProps> = ({ draftsList, onBack, onSelectDraft, onDeleteDraft }) => {
  return (
    <Box display="flex" flexDirection="column" height="100%">
      <Header style={{ paddingBottom: "12px", borderBottom: "1px solid var(--color-border)" }}>
        <IconButton icon={ArrowLeftIcon} variant="invisible" onClick={onBack} aria-label="Back" />
        <Heading as="h3" style={{ margin: "0 0 0 16px", fontSize: "20px", color: "var(--color-text-heading)" }}>
          Drafts
        </Heading>
      </Header>
      <Box flex={1} overflowY="auto">
        {draftsList.length === 0 ? (
          <Box p={5} textAlign="center" color="var(--color-text-muted)">
            No drafts yet.
          </Box>
        ) : (
          draftsList.map((draft) => (
            <Box
              key={draft.id}
              p={3}
              borderBottom="1px solid var(--color-border)"
              style={{ cursor: "pointer", transition: "background-color 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              onClick={() => onSelectDraft(draft)}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <span style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                  {new Date(draft.timestamp).toLocaleString()}
                </span>
                <IconButton
                  icon={TrashIcon}
                  variant="invisible"
                  size="small"
                  aria-label="Delete draft"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDraft(draft.id);
                  }}
                  sx={{ color: "var(--color-error)" }}
                />
              </Box>
              <Box
                mt={2}
                style={{
                  fontSize: "15px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "100px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "var(--color-text-primary)",
                }}
              >
                {draft.content ||
                  (draft.artifactId ? "[Artifact Attached]" : "") ||
                  (draft.quotePost ? "[Quoted Post]" : "") ||
                  (draft.replyToPost ? "[Reply]" : "")}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
