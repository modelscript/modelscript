// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormControl, Text, TextInput, Textarea } from "@primer/react";
import React from "react";
import Box from "../../Box";
import type { DigitalThreadTwin } from "../types";

export interface ThreadProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  twin: DigitalThreadTwin | null;
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  safetyStandard: string;
  onSafetyStandardChange: (v: string) => void;
  value: string;
  onValueChange: (v: string) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const ThreadProposalModal: React.FC<ThreadProposalModalProps> = ({
  isOpen,
  onClose,
  twin,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  safetyStandard,
  onSafetyStandardChange,
  value,
  onValueChange,
  isSubmitting,
  onSubmit,
}) => {
  if (!isOpen || !twin) return null;

  return (
    <Dialog
      title="Propose Digital Twin Resolution (Merge Request)"
      onClose={onClose}
      style={{ width: "90vw", maxWidth: 640 }}
    >
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Box bg="var(--color-canvas-subtle)" p={3} borderRadius={8} border="1px solid var(--color-border-default)">
          <Text sx={{ fontSize: 13, fontWeight: 600 }}>
            {twin.source.name} ({twin.source.domain}) ⟷ {twin.target.name} ({twin.target.domain})
          </Text>
          <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)", display: "block", mt: 1 }}>
            Current Deviation: {twin.parity.deviationPercent ?? 0}% • Physical Parity: {twin.parity.status}
          </Text>
        </Box>

        <FormControl required>
          <FormControl.Label>Proposal Title</FormControl.Label>
          <TextInput
            block
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. Align Bus Voltage to 24.0V"
          />
        </FormControl>

        <FormControl>
          <FormControl.Label>Proposed Target Value / Modification</FormControl.Label>
          <TextInput block value={value} onChange={(e) => onValueChange(e.target.value)} placeholder="e.g. 24.0" />
        </FormControl>

        <FormControl>
          <FormControl.Label>Safety Standard Compliance</FormControl.Label>
          <select
            value={safetyStandard}
            onChange={(e) => onSafetyStandardChange(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: 13,
            }}
          >
            <option value="ISO-26262">ISO 26262 (Road Vehicles - Functional Safety ASIL D)</option>
            <option value="DO-178C">DO-178C (Software Considerations in Airborne Systems DAL A)</option>
            <option value="IEC-61508">IEC 61508 (Functional Safety of E/E/PE Safety-Related Systems)</option>
          </select>
        </FormControl>

        <FormControl>
          <FormControl.Label>Engineering Rationale & Description</FormControl.Label>
          <Textarea
            block
            rows={3}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="State the engineering rationale for reconciling this digital twin parameter..."
          />
        </FormControl>

        <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting || !title.trim()}>
            {isSubmitting ? "Submitting Proposal..." : "Submit Merge Proposal"}
          </Button>
        </Box>
      </form>
    </Dialog>
  );
};
