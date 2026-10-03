// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, HourglassIcon, SearchIcon, SyncIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import type { LibraryListItem } from "../api";
import { getLibraries } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";

/* ─── styled helpers ─── */

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(6, 8, 15, 0.85);
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 3px;
    width: 56px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ResultCount = styled.span`
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  margin-left: 8px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
`;

const PackageIcon = ({ name, version }: { name: string; version: string }) => {
  const [error, setError] = useState(false);
  const iconUrl = `/api/v1/libraries/${name}/${version}/classes/${name}/icon.svg`;

  if (error) {
    return (
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: "10px",
          background: "var(--gradient-icon-box)",
          border: "1px solid var(--gradient-icon-box-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "18px",
          flexShrink: 0,
          boxShadow: "var(--glow-ai-sm)",
        }}
      >
        📦
      </Box>
    );
  }

  return (
    <img
      src={iconUrl}
      alt={`${name} icon`}
      style={{ width: 40, height: 40, borderRadius: "8px", flexShrink: 0, objectFit: "contain" }}
      onError={() => setError(true)}
    />
  );
};

/* ─── main page ─── */

const LibraryListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);
  const [activeTab, setActiveTab] = useState<"all" | "my">("all");

  useEffect(() => {
    document.title = "Packages | ModelScript";
  }, []);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput.trim() !== query) {
        if (searchInput.trim()) {
          setSearchParams({ q: searchInput.trim() });
        } else {
          setSearchParams({});
        }
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput, query, setSearchParams]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const fetchLibraries = async () => {
      try {
        const libs = await getLibraries(query);
        setLibraries(libs);

        // If any library is processing, poll again after 2 seconds
        const isProcessing = libs.some(
          (lib) => lib.jobStatus?.status === "pending" || lib.jobStatus?.status === "processing",
        );
        if (isProcessing) {
          timeoutId = setTimeout(fetchLibraries, 2000);
        }
      } catch (err) {
        setError("Failed to load libraries");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    const initialDelay = setTimeout(fetchLibraries, 300);

    return () => {
      clearTimeout(initialDelay);
      clearTimeout(timeoutId);
    };
  }, [query]);

  const displayedLibraries = libraries.filter((lib) => {
    if (activeTab === "my") {
      if (!user) return false;
      return (
        lib.author === user.username ||
        lib.scope === user.username ||
        lib.name.startsWith(`@${user.username}/`) ||
        lib.name.startsWith(`${user.username}/`)
      );
    }
    return true;
  });

  return (
    <Box>
      <TabBar>
        <Tab $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All Packages
        </Tab>
        <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
          My Packages
        </Tab>
      </TabBar>

      <Box p={4}>
        {/* Search header & Input */}
        <Box display="flex" flexDirection="column" gap={3} mb={4}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="baseline" gap="8px">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
                Packages
              </Heading>
              {!loading && (
                <ResultCount>
                  {displayedLibraries.length} package{displayedLibraries.length !== 1 ? "s" : ""}
                </ResultCount>
              )}
            </Box>
          </Box>

          <Box
            display="flex"
            alignItems="center"
            style={{
              maxWidth: "500px",
              width: "100%",
            }}
          >
            <TextInput
              leadingVisual={SearchIcon}
              placeholder="Search packages by name or keyword..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              trailingAction={
                searchInput ? (
                  <TextInput.Action
                    icon={XCircleFillIcon}
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput("");
                      setSearchParams({});
                    }}
                  />
                ) : undefined
              }
              sx={{ width: "100%" }}
            />
          </Box>
        </Box>

        {/* Content */}
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <SyncIcon size={32} className="spinner-spin" fill="var(--color-text-muted)" />
          </Box>
        ) : error ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <AlertIcon size={48} fill="var(--color-error)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Failed to load libraries
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : activeTab === "my" && !user ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Sign in to view your packages
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              Sign in to view and manage packages published under your username.
            </Text>
            <Button variant="primary" onClick={() => navigate("/login")}>
              Sign In
            </Button>
          </Box>
        ) : displayedLibraries.length === 0 ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <SearchIcon size={48} fill="var(--color-text-muted)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              No packages found
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              {activeTab === "my"
                ? "You haven't published any packages yet."
                : query
                  ? `No results matching "${query}"`
                  : "No libraries have been published yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {displayedLibraries.map((lib) => (
              <Box
                key={lib.name}
                display="flex"
                alignItems="flex-start"
                justifyContent="space-between"
                p={3}
                borderBottom="1px solid var(--color-border)"
              >
                <Link
                  to={lib.latestVersion ? `/packages/${lib.name}/${lib.latestVersion}` : `/packages/${lib.name}`}
                  style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
                >
                  <PackageIcon name={lib.name} version={lib.latestVersion || "1.0.0"} />
                  <Box flex={1}>
                    <Heading
                      as="h4"
                      style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-text-heading)" }}
                    >
                      {lib.name}
                    </Heading>
                    <Text color="var(--color-text-muted)" style={{ fontSize: "14px", display: "block" }}>
                      @{lib.name} · v{lib.latestVersion || "1.0.0"}
                    </Text>
                    <Text
                      as="p"
                      style={{
                        fontSize: "14px",
                        margin: "4px 0 0 0",
                        color: "var(--color-text-primary)",
                        lineHeight: 1.4,
                      }}
                    >
                      {lib.description || "Artifact library"}
                    </Text>
                    {lib.jobStatus && (lib.jobStatus.status === "pending" || lib.jobStatus.status === "processing") && (
                      <Box display="flex" alignItems="center" gap="8px" mt="8px">
                        {lib.jobStatus.status === "pending" ? (
                          <HourglassIcon size={16} fill="var(--color-text-muted)" />
                        ) : (
                          <SyncIcon size={16} className="spinner-spin" fill="var(--color-text-muted)" />
                        )}
                        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                          {lib.jobStatus.status === "pending"
                            ? "Queued for processing..."
                            : `Processing... ${
                                lib.jobStatus.classesProcessed ? `(${lib.jobStatus.classesProcessed} classes)` : ""
                              }`}
                        </Text>
                      </Box>
                    )}
                    {lib.jobStatus?.status === "failed" && (
                      <Box display="flex" alignItems="center" gap="6px" mt="8px">
                        <AlertIcon size={14} fill="var(--color-error)" />
                        <Text style={{ fontSize: "12px", color: "var(--color-error)" }}>
                          Processing failed: {lib.jobStatus.error || "Unknown error"}
                        </Text>
                      </Box>
                    )}
                  </Box>
                </Link>
                <button
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    color: "var(--color-text-primary)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "9999px",
                    padding: "6px 16px",
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: "pointer",
                    marginLeft: "12px",
                    transition: "all 0.2s ease",
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.href = `vscode://modelscript.modelscript/install?package=${lib.name}`;
                  }}
                >
                  Install
                </button>
              </Box>
            ))}
          </CardList>
        )}
      </Box>
    </Box>
  );
};

export default LibraryListPage;
