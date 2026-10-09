// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownloadIcon, FileIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useMemo } from "react";
import styled from "styled-components";
import Box from "../Box";

interface PdfViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "520px")};
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
`;

const PdfViewer: React.FC<PdfViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = viewConfig?.url;

  const isMobile = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }, []);

  if (!url) {
    return (
      <Box p={3} color="var(--color-danger-fg)">
        <Text>No PDF document URL provided.</Text>
      </Box>
    );
  }

  const title = viewConfig?.title || url.split("/").pop() || "Technical Specification PDF";

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <FileIcon size={16} fill="var(--color-accent-emphasis, #06b6d4)" />
          <Text
            fontWeight="bold"
            fontSize="13px"
            color="var(--color-text-primary)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <Button
            size="small"
            as="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            leadingVisual={LinkExternalIcon}
          >
            Open in Tab
          </Button>
          <Button size="small" as="a" href={url} download leadingVisual={DownloadIcon}>
            Download
          </Button>
        </Box>
      </Toolbar>

      {isMobile ? (
        <Box
          p={4}
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flex={1}
          textAlign="center"
          gap={3}
          bg="var(--color-canvas-subtle)"
        >
          <FileIcon size={48} fill="var(--color-accent-emphasis, #06b6d4)" />
          <Text fontSize="15px" fontWeight="600" color="var(--color-text-primary)">
            {title}
          </Text>
          <Text fontSize="13px" color="var(--color-text-muted)" maxWidth="320px">
            Mobile browsers block inline PDF iframes. Tap below to view this document in your browser's native PDF
            reader.
          </Text>
          <Button
            as="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
            leadingVisual={LinkExternalIcon}
          >
            View Full PDF
          </Button>
        </Box>
      ) : (
        <Box flex={1} width="100%" height="100%" bg="var(--color-canvas-subtle)">
          <iframe
            src={`${url}#toolbar=0`}
            width="100%"
            height="100%"
            style={{ border: "none", display: "block" }}
            title={title}
          />
        </Box>
      )}
    </Wrapper>
  );
};

export default PdfViewer;
