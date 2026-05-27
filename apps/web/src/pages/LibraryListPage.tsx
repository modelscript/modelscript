/* eslint-disable @typescript-eslint/no-unused-vars */
import { AlertIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import type { LibraryListItem } from "../api";
import { getLibraries } from "../api";
import Box from "../components/Box";

/* ─── styled helpers ─── */

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: transparent;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-canvas-default);
    opacity: 0.85;
    z-index: -1;
  }
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 4px;
    width: 56px;
    background-color: #1f1f1f;
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ResultCount = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);
  margin-left: 8px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
`;

const CardRow = styled.div`
  display: block;
  padding: 20px 0;
  border-bottom: 1px solid var(--color-border);

  &:first-child {
    border-top: 1px solid var(--color-border);
  }
`;

const CardInner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`;

const IconBox = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: var(--gradient-icon-box);
  border: 1px solid var(--gradient-icon-box-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
`;

const CardBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const LibName = styled(Link)`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-link);
  text-decoration: none;
  transition: color 0.15s;

  &:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
  }
`;

const VersionBadge = styled.span`
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-badge-bg);
  padding: 2px 8px;
  border-radius: 12px;
  margin-left: 10px;
  vertical-align: middle;
`;

const VersionCount = styled.span`
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-left: 8px;
  vertical-align: middle;
`;

const Description = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 6px 0 0;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-tertiary);

  span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
`;

const SpinAnimation = styled.div`
  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }
  animation: spin 1s linear infinite;
  display: flex;
  justify-content: center;
`;

/* ─── main page ─── */

const LibraryListPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";

  useEffect(() => {
    document.title = "Libraries | ModelScript";
  }, []);

  useEffect(() => {
    const fetchLibraries = async () => {
      try {
        setLoading(true);
        const libs = await getLibraries(query);
        setLibraries(libs);
      } catch (err) {
        setError("Failed to load libraries");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchLibraries, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Box>
      <TabBar>
        <Tab $active>All Packages</Tab>
        <Tab>My Packages</Tab>
      </TabBar>

      <Box p={4}>
        {/* Search header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" style={{ marginBottom: "24px" }}>
          <Box display="flex" alignItems="baseline" gap="8px">
            <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
              Packages
            </Heading>
            {!loading && (
              <ResultCount>
                {libraries.length} package{libraries.length !== 1 ? "s" : ""}
              </ResultCount>
            )}
          </Box>
        </Box>

        {/* Content */}
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <SpinAnimation>
              <Spinner size="large" />
            </SpinAnimation>
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
        ) : libraries.length === 0 ? (
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
              {query ? `No results matching "${query}"` : "No libraries have been published yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {libraries.map((lib) => (
              <Box
                key={lib.name}
                display="flex"
                alignItems="flex-start"
                justifyContent="space-between"
                p={3}
                borderBottom="1px solid var(--color-border-subtle)"
              >
                <Link
                  to={lib.latestVersion ? `/packages/${lib.name}/${lib.latestVersion}` : `/packages/${lib.name}`}
                  style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
                >
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "8px",
                      backgroundColor: "var(--color-done-emphasis)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: "bold",
                      fontSize: "20px",
                      flexShrink: 0,
                    }}
                  >
                    📦
                  </Box>
                  <Box flex={1}>
                    <Heading
                      as="h4"
                      style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-fg-default)" }}
                    >
                      {lib.name}
                    </Heading>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "14px", display: "block" }}>
                      @npm/{lib.name} · v{lib.latestVersion || "1.0.0"}
                    </Text>
                    <Text
                      as="p"
                      style={{
                        fontSize: "14px",
                        margin: "4px 0 0 0",
                        color: "var(--color-fg-default)",
                        lineHeight: 1.4,
                      }}
                    >
                      Modelica library package
                    </Text>
                  </Box>
                </Link>
                <button
                  style={{
                    backgroundColor: "var(--color-fg-default)",
                    color: "var(--color-canvas-default)",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "6px 16px",
                    fontWeight: "bold",
                    fontSize: "14px",
                    cursor: "pointer",
                    marginLeft: "12px",
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
