// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ChevronDownIcon,
  CpuIcon,
  DownloadIcon,
  FileCodeIcon,
  LinkExternalIcon,
  PlayIcon,
  RocketIcon,
  ScreenFullIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Heading, Spinner, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getUserSolutions, type Solution } from "../api";
import Box from "./Box";

const SolutionCard = styled(Box)`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

  &:hover {
    border-color: var(--color-accent-emphasis);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
  }
`;

const FormatPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(139, 92, 246, 0.1);
  color: var(--color-accent-emphasis);
  border: 1px solid rgba(139, 92, 246, 0.25);
`;

const InlineAppContainer = styled(Box)`
  margin-top: 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
`;

const IframeWrapper = styled.div`
  width: 100%;
  height: 520px;
  position: relative;
  background: #0f172a;
`;

export default function ProfileSolutions({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const navigate = useNavigate();
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);
  const [downloadDropdownId, setDownloadDropdownId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadSolutions = async () => {
      try {
        const data = await getUserSolutions(username);
        if (mounted) {
          setSolutions(data.solutions || []);
        }
      } catch (err) {
        console.error("Failed to fetch user solutions:", err);
        if (mounted) {
          setSolutions([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    loadSolutions();
    return () => {
      mounted = false;
    };
  }, [username]);

  if (loading) {
    return (
      <Box p={4} textAlign="center">
        <Spinner size="medium" />
        <Text color="var(--color-fg-muted)" style={{ display: "block", marginTop: "8px" }}>
          Loading engineering solutions...
        </Text>
      </Box>
    );
  }

  if (solutions.length === 0) {
    return (
      <Box p={4} textAlign="center">
        <RocketIcon size={32} style={{ color: "var(--color-fg-muted)", marginBottom: "8px" }} />
        <Heading as="h3" style={{ fontSize: "18px" }}>
          No published solutions yet
        </Heading>
        <Text color="var(--color-fg-muted)" style={{ display: "block", marginTop: "4px", fontSize: "14px" }}>
          {isOwnProfile
            ? "Publish your TypeScript/React apps by pushing a release tag to your connected GitHub/GitLab repository."
            : `@${username} hasn't published any engineering solutions yet.`}
        </Text>
        {isOwnProfile && (
          <Box mt={3}>
            <a
              href="https://modelscript.org/docs/solutions/publishing"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                background: "var(--gradient-cta)",
                color: "white",
                borderRadius: "9999px",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Learn How to Publish Solutions <LinkExternalIcon size={12} />
            </a>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Box mb={3} display="flex" justifyContent="space-between" alignItems="center">
        <Text color="var(--color-fg-muted)" fontSize="13px">
          Showing {solutions.length} published engineering {solutions.length === 1 ? "solution" : "solutions"}
        </Text>
        <span
          style={{
            fontSize: "12px",
            color: "var(--color-accent-emphasis)",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <ZapIcon size={13} /> WebAssembly Sandboxed Execution
        </span>
      </Box>

      {solutions.map((solution) => {
        const isAppActive = activeAppId === solution.id;
        const solutionUrl = `/solutions/${solution.author_username}/${solution.slug}`;

        return (
          <SolutionCard key={solution.id}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3}>
              <Box display="flex" gap={3} alignItems="flex-start">
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    background: "rgba(139, 92, 246, 0.15)",
                    color: "var(--color-accent-emphasis)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                  }}
                >
                  <CpuIcon size={24} />
                </div>
                <div>
                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    <Link
                      to={solutionUrl}
                      style={{
                        fontSize: "16px",
                        fontWeight: 700,
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent-emphasis)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-fg-default)")}
                    >
                      {solution.name}
                    </Link>
                    {solution.latest_version && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "10px",
                          background: "var(--color-canvas-default)",
                          border: "1px solid var(--color-border-default)",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        v{solution.latest_version}
                      </span>
                    )}
                    {solution.category && (
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "1px 8px",
                          borderRadius: "10px",
                          background: "rgba(59, 130, 246, 0.1)",
                          color: "#60a5fa",
                          border: "1px solid rgba(59, 130, 246, 0.25)",
                        }}
                      >
                        {solution.category}
                      </span>
                    )}
                  </Box>

                  {solution.description && (
                    <Text
                      color="var(--color-fg-muted)"
                      style={{
                        display: "block",
                        fontSize: "13px",
                        marginTop: "6px",
                        lineHeight: 1.45,
                      }}
                    >
                      {solution.description}
                    </Text>
                  )}

                  {solution.supported_formats && solution.supported_formats.length > 0 && (
                    <Box mt={2} display="flex" gap={1} flexWrap="wrap">
                      {solution.supported_formats.map((fmt) => (
                        <FormatPill key={fmt}>
                          <FileCodeIcon size={11} /> {fmt}
                        </FormatPill>
                      ))}
                    </Box>
                  )}
                </div>
              </Box>

              {/* Action Buttons */}
              <Box display="flex" gap={2} alignItems="center" flexShrink={0}>
                <Button
                  size="small"
                  variant={isAppActive ? "primary" : "default"}
                  onClick={() => setActiveAppId(isAppActive ? null : solution.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontWeight: 600,
                  }}
                >
                  <PlayIcon size={14} />
                  {isAppActive ? "Close App" : "Run in Browser"}
                </Button>

                {/* Download Desktop Binary Dropdown */}
                {(solution.tauri_windows_url || solution.tauri_linux_url || solution.tauri_darwin_url) && (
                  <div style={{ position: "relative" }}>
                    <Button
                      size="small"
                      onClick={() => setDownloadDropdownId(downloadDropdownId === solution.id ? null : solution.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <DownloadIcon size={14} /> Desktop <ChevronDownIcon size={12} />
                    </Button>

                    {downloadDropdownId === solution.id && (
                      <div
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "100%",
                          marginTop: "4px",
                          zIndex: 50,
                          minWidth: "180px",
                          backgroundColor: "var(--color-canvas-default)",
                          border: "1px solid var(--color-border-default)",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
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
                          Tauri Native Binaries
                        </Text>
                        {solution.tauri_windows_url && (
                          <a
                            href={solution.tauri_windows_url}
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
                        {solution.tauri_linux_url && (
                          <a
                            href={solution.tauri_linux_url}
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
                        {solution.tauri_darwin_url && (
                          <a
                            href={solution.tauri_darwin_url}
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

                <Button
                  size="small"
                  onClick={() => navigate(solutionUrl)}
                  title="Open Dedicated Solution Page"
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  <ScreenFullIcon size={14} />
                </Button>
              </Box>
            </Box>

            {/* Inline App Execution Container */}
            {isAppActive && (
              <InlineAppContainer>
                <Box
                  p={2}
                  px={3}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  style={{
                    backgroundColor: "rgba(0, 0, 0, 0.4)",
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
                      Live Sandbox: {solution.name}
                    </Text>
                  </Box>

                  <Box display="flex" alignItems="center" gap={2}>
                    <Button size="small" onClick={() => navigate(solutionUrl)}>
                      <ScreenFullIcon size={12} /> Fullscreen
                    </Button>
                    <button
                      onClick={() => setActiveAppId(null)}
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

                <IframeWrapper>
                  <iframe
                    title={solution.name}
                    src={solution.bundle_url || `/embed/solution/${solution.id}`}
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
          </SolutionCard>
        );
      })}
    </Box>
  );
}
