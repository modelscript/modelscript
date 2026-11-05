// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CommandPaletteIcon,
  DownloadIcon,
  GitBranchIcon,
  HashIcon,
  LawIcon,
  MarkGithubIcon,
  RepoIcon,
  SearchIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { getRepoFallbackStars } from "../../api";
import Box from "../../components/Box";
import { scrollToTop } from "../../components/ScrollToTop";
import Spinner from "../../components/Spinner";
import VirtualPostList from "../../components/VirtualPostList";
import { PackageIcon } from "../libraries/components/PackageIcon";
import { formatDomainLabel, formatTimeAgo, inferPackageDomains, splitScopedPackageName } from "../libraries/constants";
import { DomainBadge } from "../libraries/styles";
import { GitlabSvgIcon, inferRepoDomainTags, RepoAvatarBadge } from "../RepositoryListPage";
import type { ExploreLandingTab, PackageData, PostData, RepoData, TopicData } from "./constants";
import { CURATED_ENGINEERING_DOMAINS } from "./constants";
import {
  MobileSearchWrapper,
  SearchInputWrapper,
  SearchSplitCapsule,
  SearchSplitDivider,
  SearchSplitOmniButton,
  SearchSplitPrimaryButton,
  TabButton,
  TabContainer,
} from "./styles";

const DOMAIN_META_BY_TAG = new Map(CURATED_ENGINEERING_DOMAINS.map((dom) => [dom.tag.toLowerCase(), dom]));

export interface ExploreLandingViewProps {
  loading: boolean;
  posts: PostData[];
  topPosts?: PostData[] | undefined;
  trending: TopicData[];
  activeTab?: ExploreLandingTab | undefined;
  setActiveTab?: ((tab: ExploreLandingTab) => void) | undefined;
  hasPackages?: boolean | undefined;
  hasRepos?: boolean | undefined;
  packages?: PackageData[] | undefined;
  packagesLoading?: boolean | undefined;
  repos?: RepoData[] | undefined;
  reposLoading?: boolean | undefined;
  scrollTemplates?: ((direction: "left" | "right") => void) | undefined;
  templatesScrollRef?: React.RefObject<HTMLDivElement | null> | undefined;
  localQuery?: string | undefined;
  setLocalQuery?: ((value: string) => void) | undefined;
  handleSearchSubmit?: ((e: React.KeyboardEvent<HTMLInputElement>) => void) | undefined;
}

export const ExploreLandingView: React.FC<ExploreLandingViewProps> = ({
  loading,
  posts,
  topPosts,
  trending,
  activeTab,
  setActiveTab,
  hasPackages = true,
  hasRepos = false,
  packages = [],
  packagesLoading = false,
  repos = [],
  reposLoading = false,
  localQuery = "",
  setLocalQuery,
  handleSearchSubmit,
}) => {
  const [internalTab, setInternalTab] = useState<ExploreLandingTab>("explore");
  const rawTab = activeTab ?? internalTab;

  const availableTabs: { id: ExploreLandingTab; label: string }[] = [
    { id: "explore", label: "Explore" },
    { id: "trending", label: "Trending" },
    ...(hasPackages ? [{ id: "packages" as const, label: "Packages" }] : []),
    ...(hasRepos ? [{ id: "repositories" as const, label: "Repositories" }] : []),
  ];

  const effectiveTab: ExploreLandingTab = availableTabs.some((t) => t.id === rawTab) ? rawTab : "explore";

  const handleTabSelect = (tab: ExploreLandingTab) => {
    if (tab === effectiveTab) {
      scrollToTop({ smooth: true });
    } else {
      scrollToTop({ smooth: false });
    }
    if (setActiveTab) {
      setActiveTab(tab);
    } else {
      setInternalTab(tab);
    }
  };

  const activeTrendingTopics = (trending || []).filter((topicItem) => {
    const rawTag = String(topicItem.display_name || topicItem.tag || topicItem.concept || topicItem.name || "").replace(
      /^#/,
      "",
    );
    const count = Number(
      topicItem.postsCount ??
        (topicItem.post_count as number | undefined) ??
        (topicItem.count as number | undefined) ??
        0,
    );
    return Boolean(rawTag) && count > 0;
  });

  const trendingFeedPosts = topPosts ?? posts;

  return (
    <Box>
      <MobileSearchWrapper>
        <SearchInputWrapper>
          <SearchIcon size={16} />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery?.(e.target.value)}
            onKeyDown={handleSearchSubmit}
            placeholder="Search posts, models, packages, or #topics..."
            aria-label="Search Explore"
          />
          <SearchSplitCapsule role="group" aria-label="Search or open Omni-bar">
            <SearchSplitPrimaryButton
              onClick={() => handleSearchSubmit?.({ key: "Enter" } as React.KeyboardEvent<HTMLInputElement>)}
              title="Search Explore"
            >
              Search
            </SearchSplitPrimaryButton>
            <SearchSplitDivider aria-hidden="true" />
            <SearchSplitOmniButton
              onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
              title="Open Omni-bar"
              aria-label="Open Omni-bar"
            >
              <CommandPaletteIcon size={15} />
            </SearchSplitOmniButton>
          </SearchSplitCapsule>
        </SearchInputWrapper>
      </MobileSearchWrapper>

      <TabContainer role="tablist" aria-label="Explore sections">
        {availableTabs.map((tab) => (
          <TabButton
            key={tab.id}
            role="tab"
            aria-selected={effectiveTab === tab.id}
            $active={effectiveTab === tab.id}
            onClick={() => handleTabSelect(tab.id)}
          >
            {tab.label}
          </TabButton>
        ))}
      </TabContainer>

      <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
        {effectiveTab === "explore" && (
          <>
            {loading ? (
              <Box p={4} display="flex" justifyContent="center">
                <Spinner size="large" />
              </Box>
            ) : (
              <>
                <VirtualPostList
                  posts={posts}
                  emptyState={
                    <Box p={6} textAlign="center" color="var(--color-text-muted)">
                      No posts to explore right now.
                    </Box>
                  }
                />
              </>
            )}
          </>
        )}

        {effectiveTab === "trending" && (
          <>
            {loading ? (
              <Box p={4} display="flex" justifyContent="center">
                <Spinner size="large" />
              </Box>
            ) : (
              <>
                {activeTrendingTopics.map((topicItem, idx) => {
                  const rawTag = String(
                    topicItem.display_name || topicItem.tag || topicItem.concept || topicItem.name || "",
                  ).replace(/^#/, "");
                  const count = Number(
                    topicItem.postsCount ??
                      (topicItem.post_count as number | undefined) ??
                      (topicItem.count as number | undefined) ??
                      0,
                  );
                  const domainMeta = DOMAIN_META_BY_TAG.get(rawTag.toLowerCase());
                  const IconComp = domainMeta?.icon ?? HashIcon;

                  return (
                    <Link
                      key={topicItem.id || `${rawTag}-${idx}`}
                      to={`/explore?topic=${encodeURIComponent(rawTag)}`}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}
                    >
                      <Box
                        p={3}
                        borderBottom="1px solid var(--color-border)"
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        gap={3}
                        sx={{
                          transition: "background-color 0.15s ease",
                          "&:hover": {
                            backgroundColor: "var(--surface-row-hover)",
                          },
                        }}
                      >
                        <Box display="flex" alignItems="center" gap="12px" minWidth={0} flex={1}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "8px",
                              background: "var(--color-canvas-subtle)",
                              border: "1px solid var(--color-border-subtle)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--color-accent-cyan)",
                              flexShrink: 0,
                            }}
                          >
                            <IconComp size={16} />
                          </div>
                          <Box minWidth={0} flex={1}>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--color-text-muted)",
                                marginBottom: "2px",
                              }}
                            >
                              {idx + 1} · {domainMeta ? domainMeta.name : "Trending"}
                            </div>
                            <Heading
                              as="h4"
                              style={{
                                fontSize: "15px",
                                fontWeight: 700,
                                margin: 0,
                                color: "var(--color-text-heading)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              #{rawTag}
                            </Heading>
                            {domainMeta?.desc && (
                              <Text
                                as="p"
                                style={{
                                  fontSize: "13px",
                                  color: "var(--color-text-muted)",
                                  margin: "2px 0 0 0",
                                  lineHeight: 1.35,
                                }}
                              >
                                {domainMeta.desc}
                              </Text>
                            )}
                          </Box>
                        </Box>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            padding: "3px 8px",
                            borderRadius: "9999px",
                            backgroundColor: "rgba(139, 92, 246, 0.12)",
                            color: "var(--color-accent-purple)",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {count} {count === 1 ? "post" : "posts"}
                        </span>
                      </Box>
                    </Link>
                  );
                })}

                {trendingFeedPosts.length > 0 && <VirtualPostList posts={trendingFeedPosts} />}

                {activeTrendingTopics.length === 0 && trendingFeedPosts.length === 0 && (
                  <Box p={6} textAlign="center" color="var(--color-text-muted)">
                    No trending topics or posts right now.
                  </Box>
                )}
              </>
            )}
          </>
        )}

        {effectiveTab === "packages" && hasPackages && (
          <>
            {packagesLoading ? (
              <Box p={4} display="flex" justifyContent="center">
                <Spinner size="large" />
              </Box>
            ) : (
              <>
                {packages.map((pkg) => {
                  const anyPkg = pkg as any;
                  const latestVer = anyPkg.latestVersion || pkg.version || "1.0.0";
                  const targetUrl = latestVer ? `/packages/${pkg.name}/${latestVer}` : `/packages/${pkg.name}`;
                  const { scope, baseName } = splitScopedPackageName(pkg.name);
                  const rawScope = scope ? scope.slice(1) : anyPkg.scope;
                  const distinctAuthor =
                    anyPkg.author &&
                    String(anyPkg.author).toLowerCase() !== pkg.name.toLowerCase() &&
                    String(anyPkg.author).toLowerCase() !== String(rawScope || "").toLowerCase()
                      ? `@${String(anyPkg.author).replace(/^@/, "")}`
                      : null;
                  const domains = inferPackageDomains({
                    name: pkg.name,
                    domains: anyPkg.domains,
                    description: pkg.description,
                  });
                  const timeAgoText = formatTimeAgo(anyPkg.publishedAt);
                  const license = anyPkg.license as string | undefined;
                  const totalDownloads = typeof anyPkg.totalDownloads === "number" ? anyPkg.totalDownloads : 0;
                  const dependentsCount = typeof anyPkg.dependentsCount === "number" ? anyPkg.dependentsCount : 0;
                  const recommendationReason = anyPkg.recommendationReason as string | undefined;
                  const hasVisibleRecommendation = Boolean(
                    recommendationReason &&
                    !recommendationReason.startsWith("Matches #") &&
                    (!dependentsCount || !recommendationReason.startsWith("Used by ")),
                  );
                  const hasFooterMeta = Boolean(
                    distinctAuthor ||
                    license ||
                    totalDownloads > 0 ||
                    dependentsCount > 0 ||
                    hasVisibleRecommendation ||
                    timeAgoText,
                  );

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
                              margin: hasFooterMeta ? "6px 0 8px 0" : "6px 0 0 0",
                              color: "var(--color-text-primary)",
                              lineHeight: 1.4,
                            }}
                          >
                            {pkg.description || "Engineering model & artifact package."}
                          </Text>

                          {hasFooterMeta && (
                            <Box display="flex" alignItems="center" gap="14px" flexWrap="wrap">
                              {distinctAuthor && (
                                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                  {distinctAuthor}
                                </Text>
                              )}
                              {license && (
                                <Text
                                  style={{
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <LawIcon size={12} /> {license}
                                </Text>
                              )}
                              {totalDownloads > 0 && (
                                <Text
                                  style={{
                                    fontSize: "12px",
                                    color: "var(--color-text-muted)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <DownloadIcon size={12} /> {totalDownloads.toLocaleString()} downloads
                                </Text>
                              )}
                              {dependentsCount > 0 && (
                                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                  Used by {dependentsCount} {dependentsCount === 1 ? "package" : "packages"}
                                </Text>
                              )}
                              {hasVisibleRecommendation && (
                                <Text style={{ fontSize: "11px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                                  {recommendationReason}
                                </Text>
                              )}
                              {timeAgoText && (
                                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                  {timeAgoText}
                                </Text>
                              )}
                            </Box>
                          )}
                        </Box>
                      </Link>
                    </Box>
                  );
                })}
                {packages.length === 0 && (
                  <Box p={6} textAlign="center" color="var(--color-text-muted)">
                    No packages available right now.
                  </Box>
                )}
              </>
            )}
          </>
        )}

        {effectiveTab === "repositories" && hasRepos && (
          <>
            {reposLoading ? (
              <Box p={4} display="flex" justifyContent="center">
                <Spinner size="large" />
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
                    No repositories available right now.
                  </Box>
                )}
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
