// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, GitBranchIcon, MarkGithubIcon, RepoIcon, StarIcon } from "@primer/octicons-react";
import { Heading, Label, Spinner, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { getRepoFallbackStars } from "../../api";
import Box from "../../components/Box";
import FollowButton from "../../components/FollowButton";
import Post from "../../components/Post";
import { scrollToTop } from "../../components/ScrollToTop";
import { safeCssImageUrl } from "../../util/url";
import { PackageIcon } from "../libraries/components/PackageIcon";
import { formatDomainLabel, inferPackageDomains, splitScopedPackageName } from "../libraries/constants";
import { DomainBadge } from "../libraries/styles";
import { GitlabSvgIcon, inferRepoDomainTags, RepoAvatarBadge } from "../RepositoryListPage";
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
  hasPackages?: boolean | undefined;
  hasRepos?: boolean | undefined;
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
  hasPackages = true,
  hasRepos = true,
}) => {
  const visibleSearchTabs = SEARCH_TABS.filter((tab) => {
    if (tab === "Artifacts" && !hasPackages) return false;
    if (tab === "Repositories" && !hasRepos) return false;
    return true;
  });

  const handleTabSelect = (tab: string) => {
    if (activeTab === tab) {
      scrollToTop({ smooth: true });
    } else {
      setActiveTab(tab);
      scrollToTop({ smooth: false });
    }
  };

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

      <TabContainer role="tablist" aria-label="Search result categories">
        {visibleSearchTabs.map((tab) => (
          <TabButton
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            $active={activeTab === tab}
            onClick={() => handleTabSelect(tab)}
          >
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
              {(() => {
                const qTokens = query
                  .trim()
                  .toLowerCase()
                  .split(/\s+/)
                  .map((t) => t.replace(/^#/, ""))
                  .filter(Boolean);
                const blankHaystack =
                  "blank project workspace clean workspace in-memory filesystem modelscript polyglot compiler modelica sysml step cad webassembly solvers";
                const showBlank = qTokens.length === 0 || qTokens.every((tok) => blankHaystack.includes(tok));
                const filteredTemplates =
                  qTokens.length > 0
                    ? STARTER_TEMPLATES.filter((t) => {
                        const hay = `${t.title} ${t.description} ${t.category} ${t.badge} ${t.id}`.toLowerCase();
                        return qTokens.every((tok) => hay.includes(tok));
                      })
                    : STARTER_TEMPLATES;
                if (!showBlank && filteredTemplates.length === 0) {
                  return (
                    <Box p={6} textAlign="center" color="var(--color-text-muted)">
                      No templates matching "{query}" found.
                    </Box>
                  );
                }
                return (
                  <>
                    {showBlank && (
                      <Box
                        p={4}
                        mb={3}
                        borderRadius="12px"
                        style={{
                          background:
                            "linear-gradient(135deg, rgba(88, 166, 255, 0.08) 0%, rgba(163, 113, 247, 0.12) 100%)",
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
                            Start fresh with a clean in-memory filesystem workspace. Direct access to the full
                            ModelScript polyglot compiler, Modelica 3.x, SysML v2, STEP CAD, and WebAssembly solvers
                            with zero pre-loaded clutter.
                          </Text>
                        </Box>
                        <Link to="/ide" className="ms-btn ms-btn-primary">
                          <CodeIcon size={16} /> Launch blank workspace
                        </Link>
                      </Box>
                    )}
                    {filteredTemplates.map((tpl) => (
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
                    ))}
                  </>
                );
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
                            backgroundImage: safeCssImageUrl(u.avatar || (u as any).avatar_url),
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
                  {packages.map((pkg) => {
                    const anyPkg = pkg as any;
                    const latestVer = anyPkg.latestVersion || pkg.version || "1.0.0";
                    const targetUrl = latestVer ? `/packages/${pkg.name}/${latestVer}` : `/packages/${pkg.name}`;
                    const { scope, baseName } = splitScopedPackageName(pkg.name);
                    const domains = inferPackageDomains({
                      name: pkg.name,
                      domains: anyPkg.domains,
                      description: pkg.description,
                    });

                    return (
                      <Box
                        key={pkg.name}
                        display="flex"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        p={3}
                        borderBottom="1px solid var(--color-border)"
                        sx={{
                          gap: "16px",
                          transition: "background-color 0.15s ease",
                          "&:hover": {
                            backgroundColor: "var(--surface-row-hover)",
                          },
                        }}
                      >
                        <Link
                          to={targetUrl}
                          style={{
                            textDecoration: "none",
                            color: "inherit",
                            display: "flex",
                            gap: "12px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <PackageIcon
                            name={pkg.name}
                            version={latestVer}
                            domains={domains}
                            description={pkg.description}
                          />
                          <Box flex={1} minWidth={0}>
                            <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                              <Heading
                                as="h4"
                                style={{
                                  fontSize: "15px",
                                  fontWeight: 700,
                                  margin: 0,
                                  color: "var(--color-text-heading)",
                                  lineHeight: 1.3,
                                }}
                              >
                                {scope && (
                                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{scope}/</span>
                                )}
                                {baseName}
                              </Heading>
                              <Label variant="secondary" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                                v{latestVer}
                              </Label>
                              {domains.map((dom) => (
                                <DomainBadge key={dom} $domain={dom}>
                                  {formatDomainLabel(dom)}
                                </DomainBadge>
                              ))}
                            </Box>
                            <Text
                              as="p"
                              style={{
                                fontSize: "14px",
                                margin: "6px 0 0 0",
                                color: "var(--color-text-primary)",
                                lineHeight: 1.4,
                              }}
                            >
                              {pkg.description || "Engineering model & artifact package."}
                            </Text>
                          </Box>
                        </Link>
                      </Box>
                    );
                  })}
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
                  {repos.map((r) => {
                    const provider = r.provider || "github";
                    const branch = (r as any).default_branch || "main";
                    const repoKey = `${r.namespace}/${r.project}`;
                    const repoUrl = `/repos/${provider}/${r.namespace}/${r.project}`;
                    const starCount =
                      (r as any).star_count ??
                      (r as any).stars_count ??
                      (r as any).stargazers_count ??
                      getRepoFallbackStars(repoKey);
                    const domainTags = inferRepoDomainTags({
                      id: Number(r.id) || 0,
                      provider,
                      namespace: r.namespace,
                      project: r.project,
                      description: r.description ?? null,
                    });

                    return (
                      <Box
                        key={r.id || `${provider}:${r.namespace}/${r.project}`}
                        display="flex"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        p={3}
                        borderBottom="1px solid var(--color-border)"
                        sx={{
                          gap: "16px",
                          transition: "background-color 0.15s ease",
                          "&:hover": {
                            backgroundColor: "var(--surface-row-hover)",
                          },
                        }}
                      >
                        <Link
                          to={repoUrl}
                          style={{
                            textDecoration: "none",
                            color: "inherit",
                            display: "flex",
                            gap: "12px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <RepoAvatarBadge
                            url={r.avatar_url}
                            name={r.project}
                            namespace={r.namespace}
                            provider={provider}
                            description={r.description}
                            size={40}
                          />
                          <Box flex={1} minWidth={0}>
                            <Box
                              display="flex"
                              alignItems="center"
                              justifyContent="space-between"
                              gap="12px"
                              style={{ flexWrap: "nowrap", minWidth: 0 }}
                            >
                              <Heading
                                as="h4"
                                style={{
                                  fontSize: "15px",
                                  fontWeight: 700,
                                  margin: 0,
                                  color: "var(--color-text-heading)",
                                  lineHeight: 1.3,
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
                                  {r.namespace} /{" "}
                                </span>
                                {r.project}
                              </Heading>
                              <Box
                                display="flex"
                                alignItems="center"
                                gap="8px"
                                style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    padding: "2px 8px",
                                    borderRadius: "9999px",
                                    border: "1px solid var(--color-border)",
                                    color: "var(--color-text-muted)",
                                    background: "var(--color-bg-elevated, rgba(127, 140, 154, 0.06))",
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                  }}
                                >
                                  {provider === "gitlab" ? (
                                    <span style={{ color: "#e24329", display: "inline-flex" }}>
                                      <GitlabSvgIcon size={11} />
                                    </span>
                                  ) : provider === "local" ? (
                                    <RepoIcon size={11} />
                                  ) : (
                                    <MarkGithubIcon size={11} />
                                  )}
                                  {provider === "gitlab" ? "GitLab" : provider === "local" ? "Local Git" : "GitHub"}
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    fontFamily: "var(--font-mono)",
                                    padding: "2px 8px",
                                    borderRadius: "9999px",
                                    border: "1px solid var(--color-border)",
                                    color: "var(--color-text-muted)",
                                    background: "var(--color-bg-elevated, rgba(127, 140, 154, 0.06))",
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                  }}
                                >
                                  <GitBranchIcon size={11} />
                                  {branch}
                                </span>
                              </Box>
                            </Box>
                            <Text
                              as="p"
                              style={{
                                fontSize: "14px",
                                margin: "6px 0 8px 0",
                                color: "var(--color-text-primary)",
                                lineHeight: 1.4,
                              }}
                            >
                              {r.description || "Engineering repository workspace."}
                            </Text>
                            <Box display="flex" alignItems="center" gap="10px" flexWrap="wrap">
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  color: "var(--color-text-muted)",
                                }}
                                title={`${starCount.toLocaleString()} ${starCount === 1 ? "star" : "stars"}`}
                              >
                                <StarIcon size={12} />
                                {starCount.toLocaleString()}
                              </span>
                              {domainTags.map((tag) => (
                                <span
                                  key={tag.label}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    padding: "2px 8px",
                                    borderRadius: "9999px",
                                    background: `color-mix(in srgb, ${tag.color} 10%, transparent)`,
                                    color: tag.color,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      backgroundColor: tag.color,
                                      display: "inline-block",
                                    }}
                                  />
                                  {tag.label}
                                </span>
                              ))}
                            </Box>
                          </Box>
                        </Link>
                      </Box>
                    );
                  })}
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
