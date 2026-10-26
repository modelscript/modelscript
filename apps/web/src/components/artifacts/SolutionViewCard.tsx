// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  DownloadIcon,
  FileCodeIcon,
  LinkExternalIcon,
  PlayIcon,
  ScreenFullIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getSolution, type Solution, type SolutionRelease } from "../../api";
import Box from "../Box";

interface SolutionViewCardProps {
  viewConfig: {
    author?: string | undefined;
    slug?: string | undefined;
    name?: string | undefined;
    version?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    supported_formats?: string[] | undefined;
    bundle_url?: string | undefined;
    tauri_windows_url?: string | undefined;
    tauri_linux_url?: string | undefined;
    tauri_darwin_url?: string | undefined;
    [key: string]: any;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen?: boolean }>`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);

  &:hover {
    border-color: rgba(139, 92, 246, 0.4);
    box-shadow: 0 6px 24px rgba(139, 92, 246, 0.15);
  }
`;

const FormatPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.12);
  color: var(--color-accent-emphasis, #a855f7);
  border: 1px solid rgba(139, 92, 246, 0.25);
  font-weight: 600;
`;

const InlineAppContainer = styled.div`
  margin-top: 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, #334155);
  background: #090d16;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
`;

const IframeWrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "calc(100vh - 160px)" : "480px")};
  position: relative;
  background: #090d16;
`;

export default function SolutionViewCard({ viewConfig, isFullScreen }: SolutionViewCardProps) {
  const navigate = useNavigate();

  const author = viewConfig.author || "modelscript";
  const slug = viewConfig.slug || "solution";

  const [solution, setSolution] = useState<Solution | null>(null);
  const [release, setRelease] = useState<SolutionRelease | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // If full config is not pre-populated, fetch from API
  useEffect(() => {
    if (viewConfig.name && viewConfig.bundle_url) {
      setSolution({
        id: viewConfig.id || 0,
        user_id: 0,
        slug,
        name: viewConfig.name,
        description: viewConfig.description,
        category: viewConfig.category,
        supported_formats: viewConfig.supported_formats || [],
        is_public: 1,
        created_at: "",
        updated_at: "",
        author_username: author,
        latest_version: viewConfig.version,
        bundle_url: viewConfig.bundle_url,
        tauri_windows_url: viewConfig.tauri_windows_url,
        tauri_linux_url: viewConfig.tauri_linux_url,
        tauri_darwin_url: viewConfig.tauri_darwin_url,
      });
    } else if (author && slug) {
      setLoading(true);
      getSolution(author, slug)
        .then((data) => {
          setSolution(data.solution);
          setRelease(data.release);
        })
        .catch((err) => {
          console.warn("Could not load solution for card:", err);
        })
        .finally(() => setLoading(false));
    }
  }, [author, slug, viewConfig]);

  const name = solution?.name || viewConfig.name || slug;
  const version = release?.version || solution?.latest_version || viewConfig.version || "1.0.0";
  const category = solution?.category || viewConfig.category || "Engineering Application";
  const description = solution?.description || viewConfig.description || "";
  const supportedFormats = solution?.supported_formats || viewConfig.supported_formats || [];
  const bundleUrl = release?.bundle_url || solution?.bundle_url || viewConfig.bundle_url;
  const tauriWindows = release?.tauri_windows_url || solution?.tauri_windows_url || viewConfig.tauri_windows_url;
  const tauriLinux = release?.tauri_linux_url || solution?.tauri_linux_url || viewConfig.tauri_linux_url;
  const tauriDarwin = release?.tauri_darwin_url || solution?.tauri_darwin_url || viewConfig.tauri_darwin_url;
  const dedicatedUrl = `/solutions/${author}/${slug}`;

  const handleCopyLink = () => {
    const fullUrl = `${window.location.origin}${dedicatedUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <CardWrapper>
        <Box p={3} display="flex" alignItems="center" justifyContent="center" gap={2}>
          <Spinner size="small" />
          <Text fontSize="13px" color="var(--color-fg-muted)">
            Loading engineering application...
          </Text>
        </Box>
      </CardWrapper>
    );
  }

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      {/* Top Meta Bar */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
        <Box display="flex" gap={3} alignItems="flex-start">
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "rgba(139, 92, 246, 0.15)",
              color: "var(--color-accent-emphasis, #a855f7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: "1px solid rgba(139, 92, 246, 0.3)",
            }}
          >
            <CpuIcon size={22} />
          </div>
          <div>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <Link
                to={dedicatedUrl}
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--color-fg-default)",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent-emphasis, #a855f7)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-fg-default)")}
              >
                {name}
              </Link>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-fg-muted)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                v{version}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 7px",
                  borderRadius: "8px",
                  background: "rgba(59, 130, 246, 0.12)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                }}
              >
                {category}
              </span>
            </Box>

            <Text fontSize="12px" color="var(--color-fg-muted)" style={{ marginTop: "2px", display: "block" }}>
              Published by{" "}
              <Link
                to={`/${author}`}
                style={{ color: "var(--color-accent-emphasis, #a855f7)", textDecoration: "none" }}
              >
                @{author}
              </Link>
            </Text>
          </div>
        </Box>

        <span
          style={{
            fontSize: "11px",
            color: "#10b981",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            background: "rgba(16, 185, 129, 0.1)",
            padding: "2px 8px",
            borderRadius: "12px",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            flexShrink: 0,
          }}
        >
          <ZapIcon size={12} /> Live Wasm
        </span>
      </Box>

      {/* Description */}
      {description && (
        <Text fontSize="13px" color="var(--color-fg-muted)" style={{ lineHeight: 1.45 }}>
          {description}
        </Text>
      )}

      {/* Supported Formats Pills */}
      {supportedFormats.length > 0 && (
        <Box display="flex" gap={1} flexWrap="wrap">
          {supportedFormats.map((fmt: string) => (
            <FormatPill key={fmt}>
              <FileCodeIcon size={11} /> {fmt}
            </FormatPill>
          ))}
        </Box>
      )}

      {/* Action Buttons Bar */}
      <Box display="flex" justifyContent="space-between" alignItems="center" pt={1}>
        <Box display="flex" gap={2} alignItems="center">
          <Button
            size="small"
            variant={isRunning ? "primary" : "default"}
            onClick={() => setIsRunning(!isRunning)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: 600,
            }}
          >
            <PlayIcon size={14} />
            {isRunning ? "Hide App" : "Run Live in Post"}
          </Button>

          {/* Download Desktop Dropdown */}
          {(tauriWindows || tauriLinux || tauriDarwin) && (
            <div style={{ position: "relative" }}>
              <Button
                size="small"
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
              >
                <DownloadIcon size={14} /> Desktop <ChevronDownIcon size={12} />
              </Button>

              {showDownloadMenu && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "100%",
                    marginTop: "4px",
                    zIndex: 50,
                    minWidth: "190px",
                    backgroundColor: "var(--color-canvas-default, #0f172a)",
                    border: "1px solid var(--color-border-default, #334155)",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
                    padding: "6px",
                  }}
                >
                  <Text
                    color="var(--color-fg-muted)"
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "4px 8px",
                      display: "block",
                      textTransform: "uppercase",
                    }}
                  >
                    Tauri Offline Binaries
                  </Text>
                  {tauriWindows && (
                    <a
                      href={tauriWindows}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={12} /> Windows (.exe / .msi)
                    </a>
                  )}
                  {tauriLinux && (
                    <a
                      href={tauriLinux}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={12} /> Linux (.AppImage)
                    </a>
                  )}
                  {tauriDarwin && (
                    <a
                      href={tauriDarwin}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={12} /> macOS (.dmg)
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          <Button size="small" onClick={() => navigate(dedicatedUrl)} title="Open Fullscreen Solution Page">
            <LinkExternalIcon size={14} /> Fullscreen App
          </Button>
        </Box>

        <Button size="small" onClick={handleCopyLink} title="Copy share link">
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </Button>
      </Box>

      {/* Inline App Running Sandbox */}
      {isRunning && (
        <InlineAppContainer>
          <Box
            p={2}
            px={3}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              borderBottom: "1px solid var(--color-border-default)",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#10b981",
                  boxShadow: "0 0 8px #10b981",
                }}
              />
              <Text fontSize="12px" fontWeight={600} color="var(--color-fg-default)">
                Interactive Sandbox: {name}
              </Text>
            </Box>

            <Box display="flex" alignItems="center" gap={2}>
              <Button size="small" onClick={() => navigate(dedicatedUrl)}>
                <ScreenFullIcon size={12} /> Theater Mode
              </Button>
              <button
                onClick={() => setIsRunning(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                  padding: "4px",
                }}
                title="Close App"
              >
                <XIcon size={14} />
              </button>
            </Box>
          </Box>

          <IframeWrapper $isFullScreen={isFullScreen}>
            <iframe
              title={name}
              src={bundleUrl || `/embed/solution/${solution?.id || 1}`}
              sandbox="allow-scripts allow-downloads allow-forms allow-same-origin"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                backgroundColor: "#090d16",
              }}
            />
          </IframeWrapper>
        </InlineAppContainer>
      )}
    </CardWrapper>
  );
}
