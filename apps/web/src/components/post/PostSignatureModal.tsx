// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShieldCheckIcon } from "@primer/octicons-react";
import { Button, Dialog, Text } from "@primer/react";
import React, { useState } from "react";
import Box from "../Box";

export interface PostSignatureModalProps {
  onClose: () => void;
  displayPost: {
    username: string;
    display_name?: string | null;
    ap_id?: string | null;
  };
  signatureScheme: string;
  keyIdentifier: string;
  signatureDigest?: string | null;
}

export const PostSignatureModal: React.FC<PostSignatureModalProps> = ({
  onClose,
  displayPost,
  signatureScheme,
  keyIdentifier,
  signatureDigest,
}) => {
  const [copiedDigest, setCopiedDigest] = useState(false);

  return (
    <Dialog title="Cryptographic Signature Verification" onClose={onClose} width="large">
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        <Box
          display="flex"
          alignItems="center"
          gap={3}
          p={3}
          style={{
            backgroundColor: "rgba(63, 185, 80, 0.1)",
            border: "1px solid rgba(63, 185, 80, 0.3)",
            borderRadius: "8px",
          }}
        >
          <ShieldCheckIcon size={24} fill="var(--color-status-verified, #3fb950)" />
          <Box>
            <Text style={{ fontWeight: 600, color: "var(--color-status-verified, #3fb950)", display: "block" }}>
              Verified Authenticity & Integrity
            </Text>
            <Text as="p" style={{ fontSize: "12px", color: "var(--color-fg-muted)", margin: 0 }}>
              This post was cryptographically signed at the author's client terminal and verified against their
              published ActivityPub actor public key.
            </Text>
          </Box>
        </Box>

        <Box
          display="grid"
          style={{
            gridTemplateColumns: "110px 1fr",
            rowGap: "8px",
            columnGap: "12px",
            fontSize: "13px",
          }}
        >
          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Author:</Text>
          <Text>
            @{displayPost.username} {displayPost.display_name && `(${displayPost.display_name})`}
          </Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Algorithm:</Text>
          <Text style={{ fontFamily: "monospace", fontSize: "12px" }}>{signatureScheme}</Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Key ID:</Text>
          <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>{keyIdentifier}</Text>

          <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Protocol:</Text>
          <Text>W3C ActivityPub / ActivityStreams 2.0</Text>

          {displayPost.ap_id && (
            <>
              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Activity ID:</Text>
              <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
                {displayPost.ap_id}
              </Text>
            </>
          )}
        </Box>

        {signatureDigest && (
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Text style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Cryptographic Proof Value (Base64)
              </Text>
              <Button
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(signatureDigest);
                  setCopiedDigest(true);
                  setTimeout(() => setCopiedDigest(false), 2000);
                }}
              >
                {copiedDigest ? "Copied!" : "Copy Proof"}
              </Button>
            </Box>
            <Box
              as="pre"
              p={2}
              style={{
                backgroundColor: "var(--color-canvas-subtle, #161b22)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "monospace",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: "120px",
                margin: 0,
              }}
            >
              {signatureDigest}
            </Box>
          </Box>
        )}

        <Box display="flex" justifyContent="flex-end" pt={2}>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};
