// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormControl, Heading, Select, Text, Textarea } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";

export interface UnblockModalProps {
  username: string;
  onUnblock: () => Promise<void>;
  onClose: () => void;
}

export const UnblockModal: React.FC<UnblockModalProps> = ({ username, onUnblock, onClose }) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
      }}
    >
      <Box
        style={{
          backgroundColor: "var(--surface-overlay, rgba(14, 20, 36, 0.95))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
          borderRadius: "16px",
          padding: "24px",
          minWidth: "300px",
          maxWidth: "340px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
        }}
      >
        <Heading as="h3" style={{ fontSize: "20px", marginBottom: "8px" }}>
          Unblock @{username}?
        </Heading>
        <Text color="var(--color-fg-muted)" style={{ display: "block", marginBottom: "24px", lineHeight: "1.4" }}>
          They will be able to follow you and engage with your public posts.
        </Text>
        <Button
          style={{
            width: "100%",
            marginBottom: "12px",
            borderRadius: "9999px",
            padding: "10px",
            fontWeight: "bold",
            background: "var(--gradient-cta)",
            color: "white",
            border: "none",
            boxShadow: "0 2px 8px rgba(139, 92, 246, 0.3)",
          }}
          onClick={onUnblock}
        >
          Unblock
        </Button>
        <Button
          style={{
            width: "100%",
            borderRadius: "9999px",
            padding: "10px",
            fontWeight: "bold",
            border: "1px solid var(--color-border-default)",
            background: "rgba(255, 255, 255, 0.04)",
            color: "var(--color-fg-default)",
          }}
          onClick={onClose}
        >
          Cancel
        </Button>
      </Box>
    </div>
  );
};

export interface ReportModalProps {
  username: string;
  reportReason: string;
  setReportReason: (reason: string) => void;
  reportDetails: string;
  setReportDetails: (details: string) => void;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  username,
  reportReason,
  setReportReason,
  reportDetails,
  setReportDetails,
  onSubmit,
  onClose,
}) => {
  return (
    <Dialog title={`Report @${username}`} onClose={onClose}>
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        <FormControl>
          <FormControl.Label>Reason</FormControl.Label>
          <Select value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
            <Select.Option value="Spam or automated bot">Spam or automated bot</Select.Option>
            <Select.Option value="Harassment or abuse">Harassment or abuse</Select.Option>
            <Select.Option value="Copyright or license violation">Copyright or license violation</Select.Option>
            <Select.Option value="Malicious or harmful code">Malicious or harmful code</Select.Option>
            <Select.Option value="Other">Other</Select.Option>
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Additional Details (Optional)</FormControl.Label>
          <Textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder="Describe why you are reporting this account..."
            rows={4}
            block
          />
        </FormControl>
        <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onSubmit}>
            Submit Report
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};
