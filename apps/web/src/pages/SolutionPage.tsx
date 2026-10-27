// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  DownloadIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
} from "@primer/octicons-react";
import { Button, Heading, Spinner, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { getSolution, type Solution, type SolutionRelease } from "../api";
import Box from "../components/Box";
import { usePageTitle } from "../util/title";

const SolutionHeader = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-default);
  z-index: 20;
`;

const ViewportContainer = styled.main`
  flex: 1;
  width: 100%;
  height: calc(100vh - 65px);
  position: relative;
  background: #090d16;
  overflow: hidden;
`;

export default function SolutionPage() {
  const { username, slug } = useParams<{ username: string; slug: string }>();
  const navigate = useNavigate();

  const [solution, setSolution] = useState<Solution | null>(null);
  const [release, setRelease] = useState<SolutionRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  usePageTitle(solution ? `${solution.name} — @${username}` : "Engineering Solution");

  useEffect(() => {
    if (!username || !slug) return;
    const fetch = async () => {
      setLoading(true);
      try {
        const data = await getSolution(username, slug);
        setSolution(data.solution);
        setRelease(data.release);
      } catch (err: any) {
        setError(err.response?.data?.error || `Solution '${username}/${slug}' could not be loaded.`);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [username, slug]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <Box
        p={6}
        textAlign="center"
        height="100vh"
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Spinner size="large" />
        <Text color="var(--color-fg-muted)" style={{ display: "block", marginTop: "16px", fontSize: "15px" }}>
          Initializing sandboxed WebAssembly runtime...
        </Text>
      </Box>
    );
  }

  if (error || !solution) {
    return (
      <Box p={6} textAlign="center" maxWidth="600px" mx="auto" mt={6}>
        <CpuIcon size={48} style={{ color: "var(--color-danger-fg)", marginBottom: "16px" }} />
        <Heading as="h2" style={{ fontSize: "24px", marginBottom: "8px" }}>
          Solution Not Found
        </Heading>
        <Text color="var(--color-fg-muted)" style={{ display: "block", marginBottom: "24px" }}>
          {error || "The requested engineering application does not exist or has been made private."}
        </Text>
        <Button onClick={() => navigate(username ? `/${username}` : "/explore")}>
          <ArrowLeftIcon size={16} /> Return to Profile
        </Button>
      </Box>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top Professional Header Bar */}
      <SolutionHeader>
        <Box display="flex" alignItems="center" gap={3}>
          <Button size="small" onClick={() => navigate(`/${username}`)} title="Back to user profile">
            <ArrowLeftIcon size={14} /> Back
          </Button>

          <Box display="flex" alignItems="center" gap={2}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "rgba(139, 92, 246, 0.15)",
                color: "var(--color-accent-emphasis)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CpuIcon size={16} />
            </div>
            <div>
              <Box display="flex" alignItems="center" gap={2}>
                <Text fontWeight={700} fontSize="15px" color="var(--color-fg-default)">
                  {solution.name}
                </Text>
                {release?.version && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "10px",
                      background: "var(--color-canvas-subtle)",
                      border: "1px solid var(--color-border-default)",
                      color: "var(--color-fg-muted)",
                    }}
                  >
                    v{release.version}
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
              <Text fontSize="12px" color="var(--color-fg-muted)">
                by{" "}
                <Link to={`/${username}`} style={{ color: "var(--color-accent-emphasis)", textDecoration: "none" }}>
                  @{username}
                </Link>
              </Text>
            </div>
          </Box>
        </Box>

        {/* Right Action Bar */}
        <Box display="flex" alignItems="center" gap={2}>
          {solution.supported_formats && solution.supported_formats.length > 0 && (
            <Box display="flex" gap={1} mr={2}>
              {solution.supported_formats.map((fmt) => (
                <span
                  key={fmt}
                  style={{
                    fontSize: "11px",
                    fontFamily: "ui-monospace, monospace",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-muted)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  {fmt}
                </span>
              ))}
            </Box>
          )}

          {/* Desktop Binary Download Dropdown */}
          {(release?.tauri_windows_url || release?.tauri_linux_url || release?.tauri_darwin_url) && (
            <div style={{ position: "relative" }}>
              <Button
                size="small"
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}
              >
                <DownloadIcon size={14} /> Download Desktop App <ChevronDownIcon size={12} />
              </Button>

              {showDownloadMenu && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "4px",
                    zIndex: 50,
                    minWidth: "220px",
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
                    Air-Gapped Offline Binaries
                  </Text>
                  {release.tauri_windows_url && (
                    <a
                      href={release.tauri_windows_url}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px",
                        borderRadius: "4px",
                        fontSize: "13px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={14} /> Windows (.exe / .msi)
                    </a>
                  )}
                  {release.tauri_linux_url && (
                    <a
                      href={release.tauri_linux_url}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px",
                        borderRadius: "4px",
                        fontSize: "13px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={14} /> Linux (.AppImage)
                    </a>
                  )}
                  {release.tauri_darwin_url && (
                    <a
                      href={release.tauri_darwin_url}
                      download
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px",
                        borderRadius: "4px",
                        fontSize: "13px",
                        color: "var(--color-fg-default)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <DownloadIcon size={14} /> macOS (.dmg)
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          <Button size="small" onClick={handleCopyLink} title="Copy shareable solution link">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? "Copied" : "Share"}
          </Button>

          <Button size="small" onClick={toggleFullscreen} title="Toggle fullscreen view">
            {isFullscreen ? <ScreenNormalIcon size={14} /> : <ScreenFullIcon size={14} />}
          </Button>
        </Box>
      </SolutionHeader>

      {/* Main Sandbox Iframe Viewport */}
      <ViewportContainer>
        <iframe
          src={release?.bundle_url || `/embed/solution/${solution.id}`}
          title={solution.name}
          sandbox="allow-scripts allow-downloads allow-forms allow-same-origin"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            backgroundColor: "#090d16",
          }}
        />
      </ViewportContainer>
    </div>
  );
}
