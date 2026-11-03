// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, FileIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";

interface PdfViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
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
  const url = sanitizeHttpUrl(viewConfig?.url, { allowRelative: true });
  const [inlinePreview, setInlinePreview] = useState(Boolean(isFullScreen));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFullScreen) {
      setInlinePreview(true);
    }
  }, [isFullScreen]);

  // Hibernate inline PDF iframe when scrolled completely out of view
  useEffect(() => {
    if (!inlinePreview || isFullScreen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            setInlinePreview(false);
          }
        });
      },
      { threshold: 0.0 },
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [inlinePreview, isFullScreen]);

  const isMobile = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }, []);

  if (!url) {
    return (
      <Box p={3} color="var(--color-danger-fg)">
        <Text>No valid PDF document URL provided.</Text>
      </Box>
    );
  }

  const title = viewConfig?.title || url.split("/").pop() || "Technical Specification PDF";

  return (
    <Wrapper ref={containerRef} $isFullScreen={isFullScreen}>
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
          {!isFullScreen && !isMobile && (
            <Button
              size="small"
              variant={inlinePreview ? "default" : "primary"}
              onClick={() => setInlinePreview((prev) => !prev)}
            >
              {inlinePreview ? "✕ Hide Preview" : "▶ Preview Inline"}
            </Button>
          )}
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
      ) : !inlinePreview && !isFullScreen ? (
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
          <Box display="flex" flexDirection="column" gap={1} alignItems="center">
            <Text fontSize="15px" fontWeight="600" color="var(--color-text-primary)">
              {title}
            </Text>
            <Text fontSize="12.5px" color="var(--color-text-muted)">
              PDF Engineering Document &middot; Click Preview Inline to load interactive viewer
            </Text>
          </Box>
          <Box display="flex" gap={2}>
            <Button variant="primary" onClick={() => setInlinePreview(true)}>
              ▶ Preview Inline
            </Button>
            <Button as="a" href={url} target="_blank" rel="noopener noreferrer" leadingVisual={LinkExternalIcon}>
              Open in Tab
            </Button>
          </Box>
        </Box>
      ) : (
        <Box flex={1} width="100%" height="100%" bg="var(--color-canvas-subtle)">
          <iframe
            src={`${url}#toolbar=0`}
            sandbox="allow-scripts allow-same-origin"
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
