// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormControl, Text, Textarea } from "@primer/react";
import React from "react";
import type { ThreadProposalDto } from "../../../api";
import Box from "../../Box";

export interface ThreadReviewModalProps {
  proposal: ThreadProposalDto | null;
  action: "approved" | "rejected" | "applied";
  comment: string;
  onCommentChange: (v: string) => void;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const ThreadReviewModal: React.FC<ThreadReviewModalProps> = ({
  proposal,
  action,
  comment,
  onCommentChange,
  onClose,
  isSubmitting,
  onSubmit,
}) => {
  if (!proposal) return null;

  return (
    <Dialog title={`Review Proposal: ${proposal.title}`} onClose={onClose} style={{ width: "90vw", maxWidth: 500 }}>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Text sx={{ fontSize: 13 }}>
          Confirm setting proposal status to <strong>{action.toUpperCase()}</strong>:
        </Text>

        <FormControl>
          <FormControl.Label>Review Comment & Verification Notes</FormControl.Label>
          <Textarea
            block
            rows={3}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Add regulatory compliance notes (e.g. ISO 26262 Part 4 review completed)..."
          />
        </FormControl>

        <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action === "rejected" ? "danger" : "primary"} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : `Confirm ${action.toUpperCase()}`}
          </Button>
        </Box>
      </form>
    </Dialog>
  );
};
