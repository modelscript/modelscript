// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon } from "@primer/octicons-react";
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
                <Link to="/ide" className="ms-btn ms-btn-primary">
                  <CodeIcon size={16} /> Launch blank workspace
                </Link>
              </Box>

              {(() => {
                const qLower = query.trim().toLowerCase();
                const filteredTemplates = qLower
                  ? STARTER_TEMPLATES.filter(
                      (t) =>
                        t.title.toLowerCase().includes(qLower) ||
                        t.description.toLowerCase().includes(qLower) ||
                        t.category.toLowerCase().includes(qLower) ||
                        t.badge.toLowerCase().includes(qLower) ||
                        t.id.toLowerCase().includes(qLower),
                    )
                  : STARTER_TEMPLATES;
                const templatesToShow = filteredTemplates.length > 0 ? filteredTemplates : STARTER_TEMPLATES;
                return templatesToShow.map((tpl) => (
                  <Box
                    key={tpl.id}
                    p={4}
                    mb={3}
                    borderRadius="12px"
                    style={{
                      background: "var(--color-bg-card)",
                      border: "1px solid var(--ms-border)",
                    }}
                    display="flex"
                    flexDirection={["column", "row"]}
                    alignItems={["flex-start", "center"]}
                    justifyContent="space-between"
                    gap={3}
                  >
                    <Box>
                      <Box display="flex" alignItems="center" gap={2} mb={2}>
                        <span style={{ fontSize: "24px" }}>{tpl.icon}</span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            backgroundColor: "color-mix(in srgb, var(--hue-indigo) 12%, transparent)",
                            color: "var(--hue-indigo)",
                            border: "1px solid color-mix(in srgb, var(--hue-indigo) 35%, transparent)",
                            fontWeight: 600,
                          }}
                        >
                          {tpl.badge}
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
                        {tpl.title}
                      </Heading>
                      <Text
                        as="p"
                        color="var(--color-text-muted)"
                        style={{ fontSize: "14px", lineHeight: 1.5, margin: 0, maxWidth: "620px" }}
                      >
                        {tpl.description}
                      </Text>
                    </Box>
                    <Link to={`/ide/${tpl.id}`} className="ms-btn ms-btn-secondary">
                      <CodeIcon size={16} /> Launch {tpl.title}
                    </Link>
                  </Box>
                ));
              })()}
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
                            {pkg.name} · v{(pkg as any).latestVersion || pkg.version || "1.0.0"}
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
