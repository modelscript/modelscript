// SPDX-License-Identifier: AGPL-3.0-or-later

import { PinIcon } from "@primer/octicons-react";
import React from "react";
import type { SpatialPin } from "../artifacts/spatial-pin";
import Box from "../Box";
import { QuoteWrapper, formatRelativeTime } from "./styles";

export interface ComposeQuoteAndPinProps {
  pendingPin?: SpatialPin | undefined;
  quotePost?: any;
}

export const ComposeQuoteAndPin: React.FC<ComposeQuoteAndPinProps> = ({ pendingPin, quotePost }) => {
  return (
    <>
      {pendingPin && (
        <Box
          mb={2}
          p={2}
          border="1px solid var(--color-border)"
          borderRadius="8px"
          backgroundColor="rgba(255, 255, 255, 0.03)"
        >
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
              <PinIcon size={12} />
            </span>
            <span>
              Pinned to <b>{pendingPin.fieldName}</b> = {pendingPin.scalarValue.toFixed(2)}
            </span>
          </span>
        </Box>
      )}

      {quotePost && (
        <QuoteWrapper>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <span style={{ fontWeight: "bold", fontSize: "14px" }}>{quotePost.display_name || quotePost.username}</span>
            <span style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>@{quotePost.username}</span>
            <span style={{ color: "var(--color-fg-muted)", fontSize: "14px", margin: "0 4px" }}>·</span>
            <span style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>
              {formatRelativeTime(quotePost.created_at)}
            </span>
          </Box>
          <span style={{ fontSize: "14px" }}>{quotePost.content}</span>
        </QuoteWrapper>
      )}
    </>
  );
};
