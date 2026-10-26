// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, CodeIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../components/Box";
import FollowButton from "../../components/FollowButton";
import Post from "../../components/Post";
import type { PackageData, PersonData, PostData, RepoData } from "./constants";
import { SEARCH_TABS, STARTER_TEMPLATES } from "./constants";
import { ExploreSearchHeader } from "./ExploreSearchHeader";
import { TabButton, TabContainer } from "./styles";

export interface ExploreSearchResultsViewProps {
  query: string;
  localQuery: string;
  setLocalQuery: (value: string) => void;
  handleSearchSubmit: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  clearSearch: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  loading: boolean;
  topPosts: PostData[];
  latestPosts: PostData[];
  artifactPosts: PostData[];
  matchedPeople: PersonData[];
  peopleLoading: boolean;
  packages: PackageData[];
  packagesLoading: boolean;
  repos: RepoData[];
  reposLoading: boolean;
}

export const ExploreSearchResultsView: React.FC<ExploreSearchResultsViewProps> = ({
  query,
  localQuery,
  setLocalQuery,
  handleSearchSubmit,
  clearSearch,
  activeTab,
  setActiveTab,
  loading,
  topPosts,
  latestPosts,
  artifactPosts,
  matchedPeople,
  peopleLoading,
  packages,
  packagesLoading,
  repos,
  reposLoading,
}) => {
  return (
    <Box>
      <ExploreSearchHeader
        onBack={clearSearch}
        value={localQuery}
        onChange={setLocalQuery}
        onSubmit={handleSearchSubmit}
        placeholder="Search"
        showClear={true}
        onClear={clearSearch}
      />

      <TabContainer>
        {SEARCH_TABS.map((tab) => (
          <TabButton key={tab} $active={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab}
          </TabButton>
        ))}
      </TabContainer>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {activeTab === "Top" && (
            <>
              {topPosts.map((post) => (
                <Post key={post.id} post={post} />
              ))}
              {topPosts.length === 0 && (
                <Box p={6} textAlign="center" color="var(--color-text-muted)">
                  No posts matching "{query}" found.
                </Box>
              )}
            </>
          )}

          {activeTab === "Latest" && (
            <>
              {latestPosts.map((post) => (
                <Post key={post.id} post={post} />
              ))}
              {latestPosts.length === 0 && (
                <Box p={6} textAlign="center" color="var(--color-text-muted)">
                  No posts matching "{query}" found.
                </Box>
              )}
            </>
          )}

          {activeTab === "Templates" && (
            <Box p={3}>
              {/* Blank Project Workspace */}
              <Box
                p={4}
                mb={3}
                borderRadius="12px"
                style={{
                  background: "linear-gradient(135deg, rgba(88, 166, 255, 0.08) 0%, rgba(163, 113, 247, 0.12) 100%)",
                  border: "1px solid rgba(163, 113, 247, 0.35)",
                  boxShadow: "0 0 20px rgba(163, 113, 247, 0.1)",
                }}
                display="flex"
                flexDirection={["column", "row"]}
                alignItems={["flex-start", "center"]}
                justifyContent="space-between"
                gap={3}
              >
                <Box>
                  <Box display="flex" alignItems="center" gap={2} mb={2}>
                    <span style={{ fontSize: "24px" }}>📁</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        backgroundColor: "rgba(6, 182, 212, 0.15)",
                        color: "var(--color-accent-cyan)",
                        border: "1px solid rgba(6, 182, 212, 0.4)",
                        fontWeight: 600,
                      }}
                    >
                      Clean Workspace
                    </span>
                  </Box>
                  <Heading
                    as="h3"
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      marginBottom: "6px",
                      color: "var(--color-text-heading)",
                    }}
                  >
                    Blank Project Workspace
                  </Heading>
                  <Text
                    as="p"
                    color="var(--color-text-muted)"
                    style={{ fontSize: "14px", lineHeight: 1.5, margin: 0, maxWidth: "620px" }}
                  >
                    Start fresh with a clean in-memory filesystem workspace. Direct access to the full ModelScript
                    polyglot compiler, Modelica 3.x, SysML v2, STEP CAD, and WebAssembly solvers with zero pre-loaded
                    clutter.
                  </Text>
                </Box>
                <Link
                  to="/ide"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    background: "var(--gradient-cta)",
                    color: "white",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                    boxShadow: "var(--glow-ai-sm)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <CodeIcon size={16} /> Launch Blank Workspace
                </Link>
              </Box>

              {/* Bouncing Ball Workspace */}
              <Box
                p={4}
                mb={4}
                borderRadius="12px"
                style={{
                  background: "linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.12) 100%)",
                  border: "1px solid rgba(236, 72, 153, 0.35)",
                  boxShadow: "0 0 20px rgba(236, 72, 153, 0.1)",
                }}
                display="flex"
                flexDirection={["column", "row"]}
                alignItems={["flex-start", "center"]}
                justifyContent="space-between"
                gap={3}
              >
                <Box>
                  <Box display="flex" alignItems="center" gap={2} mb={2}>
                    <span style={{ fontSize: "24px" }}>⚽</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        backgroundColor: "rgba(236, 72, 153, 0.15)",
                        color: "#f43f5e",
                        border: "1px solid rgba(236, 72, 153, 0.4)",
                        fontWeight: 600,
                      }}
                    >
                      Physical Simulation
                    </span>
                  </Box>
                  <Heading
                    as="h3"
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      marginBottom: "6px",
                      color: "var(--color-text-heading)",
                    }}
                  >
                    Bouncing Ball Workspace
                  </Heading>
                  <Text
                    as="p"
                    color="var(--color-text-muted)"
                    style={{ fontSize: "14px", lineHeight: 1.5, margin: 0, maxWidth: "620px" }}
                  >
                    Classic hybrid continuous/discrete physical modeling. Simulate zero-crossing state event detection,
                    restitution coefficient, and real-time WebAssembly numerical integration.
                  </Text>
                </Box>
                <Link
                  to="/ide/bouncing-ball"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #e11d48, #9333ea)",
                    color: "white",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                    boxShadow: "0 2px 10px rgba(225, 29, 72, 0.35)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <CodeIcon size={16} /> Launch Bouncing Ball
                </Link>
              </Box>

              {/* Deprecation Notice Banner */}
              <Box
                p={3}
                mb={4}
                borderRadius="8px"
                display="flex"
                alignItems="flex-start"
                gap={3}
                style={{
                  backgroundColor: "rgba(210, 153, 34, 0.1)",
                  border: "1px solid rgba(210, 153, 34, 0.3)",
                  color: "var(--color-fg-default)",
                }}
              >
                <AlertIcon size={18} style={{ color: "#d29922", marginTop: "2px", flexShrink: 0 }} />
                <Box>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "#d29922", marginBottom: "2px" }}>
                    Example Workspaces Deprecated
                  </div>
                  <Text as="p" style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: 0 }}>
                    Pre-configured example workspaces are currently deprecated in favor of clean-slate development in
                    the Blank Project Workspace. The legacy workspaces below remain accessible for reference purposes.
                  </Text>
                </Box>
              </Box>

              <Heading
                as="h4"
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  marginBottom: "16px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Deprecated Example Workspaces (Legacy)
              </Heading>

              <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={3}>
                {STARTER_TEMPLATES.filter((t) => t.id !== "bouncing-ball")
                  .filter(
                    (t) =>
                      t.title.toLowerCase().includes(query.toLowerCase()) ||
                      t.description.toLowerCase().includes(query.toLowerCase()) ||
                      t.category.toLowerCase().includes(query.toLowerCase()) ||
                      t.badge.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((template) => (
                    <Box
                      key={template.id}
                      p={3}
                      borderRadius="12px"
                      border="1px solid var(--color-border-glass)"
                      bg="var(--color-bg-card)"
                      display="flex"
                      flexDirection="column"
                      justifyContent="space-between"
                      sx={{
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        "&:hover": {
                          borderColor: "rgba(210, 153, 34, 0.5)",
                          boxShadow: "0 0 16px rgba(210, 153, 34, 0.1)",
                        },
                      }}
                    >
                      <Box>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                          <span style={{ fontSize: "24px" }}>{template.icon}</span>
                          <Box display="flex" gap="6px" alignItems="center">
                            <span
                              style={{
                                fontSize: "10px",
                                fontFamily: "var(--font-mono)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: "rgba(210, 153, 34, 0.15)",
                                color: "#d29922",
                                border: "1px solid rgba(210, 153, 34, 0.3)",
                                fontWeight: 600,
                              }}
                            >
                              Deprecated
                            </span>
                            <span
                              style={{
                                fontSize: "11px",
                                fontFamily: "var(--font-mono)",
                                padding: "2px 8px",
                                borderRadius: "9999px",
                                backgroundColor: "var(--color-accent-blue-bg)",
                                color: "var(--color-accent-cyan)",
                                border: "1px solid var(--color-accent-blue-border)",
                                fontWeight: 600,
                              }}
                            >
                              {template.badge}
                            </span>
                          </Box>
                        </Box>
                        <Heading
                          as="h4"
                          style={{
                            fontSize: "15px",
                            fontWeight: "bold",
                            marginBottom: "6px",
                            color: "var(--color-text-heading)",
                          }}
                        >
                          {template.title}
                        </Heading>
                        <Text
                          as="p"
                          color="var(--color-text-muted)"
                          style={{ fontSize: "13px", lineHeight: 1.4, margin: 0 }}
                        >
                          {template.description}
                        </Text>
                      </Box>
                      <Box mt={3} pt={2} borderTop="1px solid var(--color-border)">
                        <Link
                          to={`/ide/${template.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid var(--color-border-glass)",
                            color: "var(--color-text-muted)",
                            fontSize: "13px",
                            fontWeight: 500,
                            textDecoration: "none",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <CodeIcon size={14} /> Launch Legacy Workspace
                        </Link>
                      </Box>
                    </Box>
                  ))}
              </Box>
            </Box>
          )}

          {activeTab === "People" && (
            <>
              {peopleLoading ? (
                <Box p={4} display="flex" justifyContent="center">
                  <Spinner size="medium" />
                </Box>
              ) : (
                <>
                  {matchedPeople.map((u) => (
                    <Box
                      key={u.id}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      p={3}
                      borderBottom="1px solid var(--color-border)"
                    >
                      <Link
                        to={`/${u.username}`}
                        style={{
                          textDecoration: "none",
                          color: "inherit",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          flex: 1,
                        }}
                      >
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: "50%",
                            background: "var(--gradient-ai)",
                            boxShadow: "var(--glow-ai-sm)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontWeight: "bold",
                            backgroundSize: "cover",
                            backgroundImage: u.avatar
                              ? `url(${u.avatar})`
                              : (u as any).avatar_url
                                ? `url(${(u as any).avatar_url})`
                                : "none",
                            flexShrink: 0,
                          }}
                        >
                          {!u.avatar && !(u as any).avatar_url && u.username!.charAt(0).toUpperCase()}
                        </Box>
                        <Box flex={1}>
                          <Heading
                            as="h4"
                            style={{
                              fontSize: "15px",
                              fontWeight: "bold",
                              margin: 0,
                              color: "var(--color-text-heading)",
                            }}
                          >
                            {(u as any).display_name || u.name || u.username}
                          </Heading>
                          <Text color="var(--color-text-muted)" style={{ fontSize: "14px" }}>
                            @{u.username}
                          </Text>
                          {(u as any).bio && (
                            <Text
                              as="p"
                              style={{
                                fontSize: "13px",
                                color: "var(--color-text-primary)",
                                margin: "4px 0 0 0",
                                lineHeight: 1.3,
                              }}
                            >
                              {(u as any).bio}
                            </Text>
                          )}
                        </Box>
                      </Link>
                      <FollowButton
                        username={u.username!}
                        initialIsFollowing={(u as any).isFollowing || false}
                        size="small"
                      />
                    </Box>
                  ))}
                  {matchedPeople.length === 0 && (
                    <Box p={6} textAlign="center" color="var(--color-text-muted)">
                      No users matching "{query}" found.
                    </Box>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === "Media" && (
            <>
              {artifactPosts.map((post) => (
                <Post key={post.id} post={post} />
              ))}
              {artifactPosts.length === 0 && (
                <Box p={6} textAlign="center" color="var(--color-text-muted)">
                  No posts with media matching "{query}" found.
                </Box>
              )}
            </>
          )}

          {activeTab === "Artifacts" && (
            <>
              {packagesLoading ? (
                <Box p={4} display="flex" justifyContent="center">
                  <Spinner size="medium" />
                </Box>
              ) : (
                <>
                  {packages.map((pkg) => (
                    <Box
                      key={pkg.name}
                      display="flex"
                      alignItems="flex-start"
                      justifyContent="space-between"
                      p={3}
                      borderBottom="1px solid var(--color-border)"
                    >
                      <Link
                        to={
                          (pkg as any).latestVersion
                            ? `/packages/${pkg.name}/${(pkg as any).latestVersion}`
                            : `/packages/${pkg.name}`
                        }
                        style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
                      >
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            borderRadius: "8px",
                            background: "var(--gradient-ai)",
                            boxShadow: "var(--glow-ai-sm)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontWeight: "bold",
                            fontSize: "16px",
                            flexShrink: 0,
                          }}
                        >
                          📦
                        </Box>
                        <Box flex={1}>
                          <Heading
                            as="h4"
                            style={{
                              fontSize: "15px",
                              fontWeight: "bold",
                              margin: 0,
                              color: "var(--color-text-heading)",
                            }}
                          >
                            {pkg.name}
                          </Heading>
                          <Text color="var(--color-text-muted)" style={{ fontSize: "14px", display: "block" }}>
                            @npm/{pkg.name} · v{(pkg as any).latestVersion || pkg.version || "1.0.0"}
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
                            {pkg.description || "No description provided."}
                          </Text>
                        </Box>
                      </Link>
                      <Link
                        to={
                          (pkg as any).latestVersion
                            ? `/packages/${pkg.name}/${(pkg as any).latestVersion}`
                            : `/packages/${pkg.name}`
                        }
                        style={{
                          backgroundColor: "rgba(255, 255, 255, 0.06)",
                          color: "var(--color-text-primary)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "9999px",
                          padding: "6px 16px",
                          fontWeight: 700,
                          fontSize: "14px",
                          textDecoration: "none",
                          marginLeft: "12px",
                          display: "inline-flex",
                          alignItems: "center",
                          transition: "all 0.2s ease",
                        }}
                      >
                        View
                      </Link>
                    </Box>
                  ))}
                  {packages.length === 0 && (
                    <Box p={6} textAlign="center" color="var(--color-text-muted)">
                      No packages matching "{query}" found.
                    </Box>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === "Repositories" && (
            <>
              {reposLoading ? (
                <Box p={4} display="flex" justifyContent="center">
                  <Spinner size="medium" />
                </Box>
              ) : (
                <>
                  {repos.map((r) => (
                    <Box
                      key={r.id}
                      display="flex"
                      alignItems="flex-start"
                      justifyContent="space-between"
                      p={3}
                      borderBottom="1px solid var(--color-border)"
                    >
                      <Link
                        to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                        style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
                      >
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: "50%",
                            background: "var(--gradient-ai)",
                            boxShadow: "var(--glow-ai-sm)",
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
                            style={{
                              fontSize: "15px",
                              fontWeight: "bold",
                              margin: 0,
                              color: "var(--color-text-heading)",
                            }}
                          >
                            {r.project}
                          </Heading>
                          <Text color="var(--color-text-muted)" style={{ fontSize: "14px", display: "block" }}>
                            @{r.provider}.com/{r.namespace}/{r.project}
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
                            {r.description || "No description provided."}
                          </Text>
                        </Box>
                      </Link>
                      <Link
                        to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                        style={{
                          backgroundColor: "rgba(255, 255, 255, 0.06)",
                          color: "var(--color-text-primary)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "9999px",
                          padding: "6px 16px",
                          fontWeight: 700,
                          fontSize: "14px",
                          textDecoration: "none",
                          marginLeft: "12px",
                          display: "inline-flex",
                          alignItems: "center",
                          transition: "all 0.2s ease",
                        }}
                      >
                        Open
                      </Link>
                    </Box>
                  ))}
                  {repos.length === 0 && (
                    <Box p={6} textAlign="center" color="var(--color-text-muted)">
                      No repositories matching "{query}" found.
                    </Box>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
};
