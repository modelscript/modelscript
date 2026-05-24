/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { AlertIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { API_BASE_URL } from "../config";

/* ─── styled helpers ─── */

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: 0;
  background-color: transparent;
  backdrop-filter: blur(12px);
  z-index: 10;
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

/* ─── main page ─── */

const RepositoryListPage: React.FC = () => {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";

  useEffect(() => {
    document.title = "Repositories | ModelScript";
  }, []);

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        setLoading(true);
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(`${API_BASE_URL}/repos`, { headers });
        if (!res.ok) throw new Error("Failed to load repositories");
        const data = await res.json();

        let fetchedRepos = data.repos || [];
        if (query) {
          const lowerQuery = query.toLowerCase();
          fetchedRepos = fetchedRepos.filter(
            (r: any) => r.project.toLowerCase().includes(lowerQuery) || r.namespace.toLowerCase().includes(lowerQuery),
          );
        }

        setRepos(fetchedRepos);
      } catch (err) {
        setError("Failed to load repositories");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRepos, 300);
    return () => clearTimeout(timer);
  }, [query, token]);

  return (
    <Box>
      <TabBar>
        <Tab $active>All Repositories</Tab>
        <Tab>My Repositories</Tab>
      </TabBar>

      <Box p={4}>
        {/* Search header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" style={{ marginBottom: "24px" }}>
          <Box display="flex" alignItems="baseline" gap="8px">
            <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
              Repositories
            </Heading>
            {!loading && (
              <ResultCount>
                {repos.length} repositor{repos.length !== 1 ? "ies" : "y"}
              </ResultCount>
            )}
          </Box>
        </Box>

        {/* Content */}
        {loading && repos.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <Spinner size="large" />
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
              Failed to load repositories
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : repos.length === 0 ? (
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
              No repositories found
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              {query ? `No results matching "${query}"` : "No repositories have been connected yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {repos.map((r) => (
              <Box
                key={r.id}
                display="flex"
                alignItems="flex-start"
                justifyContent="space-between"
                p={3}
                borderBottom="1px solid var(--color-border-subtle)"
              >
                <Box display="flex" gap="12px" flex={1}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      backgroundColor: "var(--color-accent-emphasis)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: "bold",
                      backgroundSize: "cover",
                      backgroundImage: r.avatar_url ? `url(${r.avatar_url})` : "none",
                      flexShrink: 0,
                    }}
                  >
                    {!r.avatar_url && r.project.charAt(0).toUpperCase()}
                  </Box>
                  <Box flex={1}>
                    <Heading
                      as="h4"
                      style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-fg-default)" }}
                    >
                      <Link
                        to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        {r.project}
                      </Link>
                    </Heading>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "14px", display: "block" }}>
                      @{r.provider}.com/{r.namespace}/{r.project}
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
                      {r.description || "No description provided."}
                    </Text>
                  </Box>
                </Box>
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
                    const btn = e.currentTarget;
                    if (btn.innerText === "Follow") {
                      btn.innerText = "Following";
                      btn.style.backgroundColor = "transparent";
                      btn.style.color = "var(--color-fg-default)";
                      btn.style.border = "1px solid var(--color-border-default)";
                    } else {
                      btn.innerText = "Follow";
                      btn.style.backgroundColor = "var(--color-fg-default)";
                      btn.style.color = "var(--color-canvas-default)";
                      btn.style.border = "none";
                    }
                  }}
                >
                  Follow
                </button>
              </Box>
            ))}
          </CardList>
        )}
      </Box>
    </Box>
  );
};

export default RepositoryListPage;
