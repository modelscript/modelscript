// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, FileIcon, LinkExternalIcon, PlayIcon, XIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";

interface PdfViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

interface PdfDynamicMeta {
  pageCount?: number | undefined;
  fileSize?: number | undefined;
  pdfTitle?: string | undefined;
  pdfAuthor?: string | undefined;
  pageSize?: string | undefined;
  thumbnailUrl?: string | undefined;
}

function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "420px")};
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Toolbar = styled.div`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
`;

const ThumbnailStage = styled.div`
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 20px 24px 0;
  box-sizing: border-box;
  overflow: hidden;
  cursor: pointer;
  background: radial-gradient(
    circle at 50% 25%,
    var(--color-canvas-subtle, #161b22) 0%,
    var(--color-canvas-default, #0d1117) 100%
  );

  &:hover .pdf-preview-cta {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(14, 116, 144, 0.45);
    background: var(--ms-brand, #0e7490);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.25);
  }

  &:hover .pdf-sheet-frame {
    transform: translateY(-3px);
    box-shadow:
      0 18px 40px rgba(0, 0, 0, 0.28),
      0 4px 12px rgba(0, 0, 0, 0.16);
  }
`;

const PaperStackBack = styled.div`
  position: absolute;
  top: 14px;
  width: min(84%, 496px);
  height: 100%;
  background: #f1f5f9;
  border-radius: 6px 6px 0 0;
  border: 1px solid rgba(148, 163, 184, 0.35);
  transform: rotate(0.6deg);
  opacity: 0.65;
  pointer-events: none;
`;

const PaperSheetFrame = styled.div`
  position: relative;
  z-index: 1;
  width: min(86%, 512px);
  height: 100%;
  background: #ffffff;
  border-radius: 6px 6px 0 0;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-bottom: none;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.22),
    0 2px 6px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  display: flex;
  flex-direction: column;
`;

const PageFadeOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(15, 23, 42, 0) 62%,
    rgba(15, 23, 42, 0.08) 84%,
    rgba(15, 23, 42, 0.28) 100%
  );
  pointer-events: none;
  z-index: 2;
`;

const FloatingBadgeRow = styled.div`
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
`;

const PreviewCtaPill = styled.button`
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 16px;
  color: #ffffff;
  background: rgba(14, 116, 144, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
`;

const PageCountBadge = styled.div`
  pointer-events: auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  font-family: var(--font-mono, monospace);
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
  white-space: nowrap;
`;

const PdfViewer: React.FC<PdfViewerProps> = ({ viewConfig, isFullScreen }) => {
  const url = sanitizeHttpUrl(viewConfig?.url, { allowRelative: true });
  const [inlinePreview, setInlinePreview] = useState(Boolean(isFullScreen));
  const [thumbFailed, setThumbFailed] = useState(false);
  const [dynamicMeta, setDynamicMeta] = useState<PdfDynamicMeta | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFullScreen) {
      setInlinePreview(true);
    }
  }, [isFullScreen]);

  // Reset thumbnail state when URL changes
  useEffect(() => {
    setThumbFailed(false);
    setDynamicMeta(null);
  }, [url]);

  // Lazily fetch PDF metadata (.meta.json) for uploaded PDFs if pageCount isn't already in viewConfig
  useEffect(() => {
    if (!url) return;
    const existingPages = viewConfig?.pageCount ?? viewConfig?.metadata?.pageCount;
    if (typeof existingPages === "number" && existingPages > 0) return;

    const cleanPath = url.split("?")[0]?.split("#")[0] || "";
    if (!cleanPath.startsWith("/api/v1/storage/uploads/") || !cleanPath.toLowerCase().endsWith(".pdf")) {
      return;
    }

    let cancelled = false;
    fetch(`${cleanPath}.meta.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setDynamicMeta(data as PdfDynamicMeta);
        }
      })
      .catch(() => {
        // Ignore metadata fetch failure
      });

    return () => {
      cancelled = true;
    };
  }, [url, viewConfig?.pageCount, viewConfig?.metadata?.pageCount]);

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

  const cleanUrlPath = url ? url.split("?")[0]?.split("#")[0] || "" : "";
  const isStorageUploadPdf =
    cleanUrlPath.startsWith("/api/v1/storage/uploads/") && cleanUrlPath.toLowerCase().endsWith(".pdf");

  const resolvedThumbUrl = useMemo(() => {
    const rawThumb =
      viewConfig?.thumbnailUrl ||
      viewConfig?.thumbnail_url ||
      dynamicMeta?.thumbnailUrl ||
      (isStorageUploadPdf ? `${cleanUrlPath}.thumb.png` : undefined);
    return rawThumb ? sanitizeHttpUrl(rawThumb, { allowRelative: true }) : null;
  }, [
    viewConfig?.thumbnailUrl,
    viewConfig?.thumbnail_url,
    dynamicMeta?.thumbnailUrl,
    isStorageUploadPdf,
    cleanUrlPath,
  ]);

  if (!url) {
    return (
      <Box p={3} color="var(--color-danger-fg)">
        <Text>No valid PDF document URL provided.</Text>
      </Box>
    );
  }

  const pageCount: number | undefined =
    viewConfig?.pageCount ?? viewConfig?.metadata?.pageCount ?? dynamicMeta?.pageCount;
  const fileSize: number | undefined =
    viewConfig?.fileSize ?? viewConfig?.size ?? viewConfig?.metadata?.fileSize ?? dynamicMeta?.fileSize;
  const pdfTitle: string | undefined = viewConfig?.pdfTitle ?? viewConfig?.metadata?.pdfTitle ?? dynamicMeta?.pdfTitle;
  const pdfAuthor: string | undefined =
    viewConfig?.pdfAuthor ?? viewConfig?.metadata?.pdfAuthor ?? dynamicMeta?.pdfAuthor;

  const title =
    viewConfig?.title || viewConfig?.filename || pdfTitle || url.split("/").pop() || "Technical Specification PDF";

  const formattedSize = formatFileSize(fileSize);
  const badgeLabel =
    typeof pageCount === "number" && pageCount > 0
      ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}${formattedSize ? ` · ${formattedSize}` : ""}`
      : formattedSize
        ? `PDF · ${formattedSize}`
        : "PDF Document";

  const isStandalone = Boolean(viewConfig?.standalone);
  const showTopToolbar = isFullScreen || inlinePreview || isStandalone;

  const handleStageClick = () => {
    if (isMobile) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setInlinePreview(true);
  };

  return (
    <Wrapper ref={containerRef} $isFullScreen={isFullScreen}>
      {showTopToolbar && (
        <Toolbar>
          <Box display="flex" alignItems="center" gap={2} overflow="hidden" style={{ minWidth: 0, flex: 1 }}>
            <FileIcon size={15} fill="var(--color-accent-emphasis, #06b6d4)" />
            <Text
              fontWeight="bold"
              fontSize="12.5px"
              color="var(--color-text-primary)"
              style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
              title={title}
            >
              {title}
            </Text>
            {typeof pageCount === "number" && pageCount > 0 && (
              <span
                style={{
                  fontSize: "11px",
                  lineHeight: "14px",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "var(--color-canvas-default)",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-fg-muted)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {pageCount} {pageCount === 1 ? "page" : "pages"}
              </span>
            )}
          </Box>
          <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
            {!isFullScreen && !isMobile && (
              <Button
                size="small"
                variant={inlinePreview ? "default" : "primary"}
                leadingVisual={inlinePreview ? XIcon : PlayIcon}
                onClick={() => setInlinePreview((prev) => !prev)}
              >
                {inlinePreview ? "Close Preview" : "Preview Inline"}
              </Button>
            )}
            {isStandalone && (
              <>
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
              </>
            )}
          </Box>
        </Toolbar>
      )}

      {!inlinePreview && !isFullScreen ? (
        <ThumbnailStage
          onClick={handleStageClick}
          role="button"
          tabIndex={0}
          aria-label={`Preview ${title}${typeof pageCount === "number" ? ` (${pageCount} pages)` : ""}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStageClick();
            }
          }}
        >
          <PaperStackBack />
          <PaperSheetFrame className="pdf-sheet-frame">
            {resolvedThumbUrl && !thumbFailed ? (
              <img
                src={resolvedThumbUrl}
                alt={`First page of ${title}`}
                onError={() => setThumbFailed(true)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "top center",
                  display: "block",
                  background: "#ffffff",
                }}
              />
            ) : (
              <Box
                p={4}
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                flex={1}
                textAlign="center"
                gap={2}
                style={{ background: "#ffffff", color: "#0f172a" }}
              >
                <FileIcon size={44} fill="#0e7490" />
                <Text
                  fontSize="16px"
                  fontWeight="700"
                  style={{ color: "#0f172a", maxWidth: "380px", lineHeight: 1.35 }}
                >
                  {pdfTitle || title}
                </Text>
                {pdfAuthor && (
                  <Text fontSize="13px" style={{ color: "#475569" }}>
                    {pdfAuthor}
                  </Text>
                )}
                <Text fontSize="12px" style={{ color: "#64748b", marginTop: "4px" }}>
                  {isMobile ? "Tap to open PDF document" : "Click to open interactive PDF reader"}
                </Text>
              </Box>
            )}
            <PageFadeOverlay />
          </PaperSheetFrame>

          <FloatingBadgeRow>
            <PreviewCtaPill
              type="button"
              className="pdf-preview-cta"
              onClick={(e) => {
                e.stopPropagation();
                handleStageClick();
              }}
            >
              {isMobile ? (
                <>
                  <LinkExternalIcon size={12} /> View Full PDF
                </>
              ) : (
                <>
                  <PlayIcon size={12} /> Preview Inline
                </>
              )}
            </PreviewCtaPill>

            <PageCountBadge title={pdfTitle ? `${pdfTitle} — ${badgeLabel}` : badgeLabel}>
              <FileIcon size={12} />
              <span>{badgeLabel}</span>
            </PageCountBadge>
          </FloatingBadgeRow>
        </ThumbnailStage>
      ) : (
        <Box flex={1} width="100%" height="100%" bg="var(--color-canvas-subtle)" position="relative">
          <iframe
            src={`${url}#page=1&view=FitH`}
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
