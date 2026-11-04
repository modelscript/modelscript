// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getExplore,
  getLibraries,
  getPopularRepos,
  getRepos,
  getSearchCompletions,
  getTopicPosts,
  getTrending,
  searchPosts,
} from "../api";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { usePageTitle } from "../util/title";
import type { ExploreLandingTab, PackageData, PersonData, PostData, RepoData, SearchTab, TopicData } from "./explore";
import { ExploreLandingView, ExploreSearchResultsView, ExploreTopicView } from "./explore";

const normalizeSearchTab = (param: string): SearchTab => {
  const lower = param.toLowerCase();
  switch (lower) {
    case "latest":
      return "Latest";
    case "people":
      return "People";
    case "media":
      return "Media";
    case "packages":
    case "artifacts":
      return "Packages";
    case "repositories":
      return "Repositories";
    case "top":
    default:
      return "Top";
  }
};

const ExplorePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const rawTopic = searchParams.get("topic") || searchParams.get("tag") || "";
  const topic = rawTopic || (query.startsWith("#") ? query.slice(1) : "");
  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  usePageTitle(query && !query.startsWith("#") ? `Search: ${query}` : topic ? `Topic: #${topic}` : "Explore");

  const navigate = useNavigate();
  const { token } = useAuth();
  const { openCompose } = React.useContext(ComposeContext);
  const hasPackages = useFeatureFlag("package_browser");
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);

  const [topicFilter, setTopicFilter] = useState<string>(() => (tabParam === "latest" ? "latest" : "top"));
  const [copiedTopicLink, setCopiedTopicLink] = useState(false);

  const [posts, setPosts] = useState<PostData[]>([]);
  const [topicPosts, setTopicPosts] = useState<PostData[]>([]);
  const [trending, setTrending] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTabState] = useState<SearchTab>(() => normalizeSearchTab(tabParam));
  const [landingTab, setLandingTabState] = useState<ExploreLandingTab>(() => {
    if (tabParam === "trending" || tabParam === "packages" || (hasRepos && tabParam === "repositories")) {
      return tabParam;
    }
    return "explore";
  });
  const [localQuery, setLocalQuery] = useState("");

  const [packages, setPackages] = useState<PackageData[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  const [repos, setRepos] = useState<RepoData[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  const [matchedPeople, setMatchedPeople] = useState<PersonData[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  useEffect(() => {
    if (query) {
      setActiveTabState(normalizeSearchTab(tabParam));
    }
  }, [tabParam, query]);

  const setActiveTab = (nextTab: string) => {
    const valid = normalizeSearchTab(nextTab);
    setActiveTabState(valid);
    const next = new URLSearchParams(searchParams);
    if (valid === "Top") {
      next.delete("tab");
    } else {
      next.set("tab", valid.toLowerCase());
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (tabParam === "trending" || tabParam === "packages" || tabParam === "repositories" || tabParam === "explore") {
      setLandingTabState(tabParam);
    } else if (!tabParam) {
      setLandingTabState("explore");
    }
  }, [tabParam]);

  const setLandingTab = (nextTab: ExploreLandingTab) => {
    setLandingTabState(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === "explore") {
      next.delete("tab");
    } else {
      next.set("tab", nextTab);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (topic) {
      setTopicFilter(tabParam === "latest" ? "latest" : "top");
    }
  }, [topic, tabParam]);

  const handleSelectTopicTab = (nextTab: string) => {
    const normalized = nextTab.toLowerCase() === "latest" ? "latest" : "top";
    setTopicFilter(normalized);
    const next = new URLSearchParams(searchParams);
    if (normalized === "top") {
      next.delete("tab");
    } else {
      next.set("tab", "latest");
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  useEffect(() => {
    if (topic) {
      async function fetchTopicPosts() {
        setLoading(true);
        try {
          const data = await getTopicPosts(topic, {
            sort: topicFilter === "latest" ? "recent" : "top",
          });
          setTopicPosts(data.posts || []);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }
      fetchTopicPosts();
    }
  }, [topic, topicFilter, token]);

  useEffect(() => {
    async function fetchExplore() {
      try {
        const [postsData, trendingData] = await Promise.all([getExplore(), getTrending(10)]);
        setPosts(postsData.posts || []);
        setTrending(trendingData.topics || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchExplore();
  }, [token]);

  const [backendMatchedIds, setBackendMatchedIds] = useState<Set<string>>(new Set());
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    setBackendMatchedIds(new Set());
    if (!query || topic) {
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchLoading(true);
    searchPosts(query, 40)
      .then((res) => {
        if (!active || !Array.isArray(res?.posts)) return;
        const matched = new Set<string>();
        for (const p of res.posts as PostData[]) {
          if (p && p.id !== undefined) matched.add(String(p.id));
        }
        setBackendMatchedIds(matched);
        if (res.posts.length === 0) return;
        setPosts((prev) => {
          const byId = new Map<string, PostData>();
          for (const p of res.posts as PostData[]) {
            if (p && p.id !== undefined) byId.set(String(p.id), p);
          }
          for (const p of prev) {
            if (p && p.id !== undefined && !byId.has(String(p.id))) {
              byId.set(String(p.id), p);
            }
          }
          return Array.from(byId.values());
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSearchLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, topic, token]);

  const shouldFetchPackages = hasPackages && !topic && (query ? activeTab === "Packages" : landingTab === "packages");

  useEffect(() => {
    if (!shouldFetchPackages) return;
    let active = true;
    async function fetchPackages() {
      setPackagesLoading(true);
      try {
        const [pkgs, searchComp] = await Promise.all([
          getLibraries(query),
          query ? getSearchCompletions(query, 50).catch(() => ({ packages: [] })) : Promise.resolve({ packages: [] }),
        ]);
        if (!active) return;
        const searchCompRecord = searchComp as
          | {
              packages?: { name?: string; latest_version?: string; version?: string; description?: string }[];
            }
          | null
          | undefined;
        const searchCompPkgs = (searchCompRecord?.packages || []).map((p) => ({
          name: p.name || "",
          version: p.latest_version || p.version || "1.0.0",
          latestVersion: p.latest_version || p.version || "1.0.0",
          description: p.description,
        }));
        const byName = new Map<string, PackageData>();
        for (const p of pkgs || []) {
          if (p?.name) byName.set(p.name, p);
        }
        for (const p of searchCompPkgs) {
          if (p?.name && !byName.has(p.name)) {
            byName.set(p.name, p);
          }
        }
        setPackages(Array.from(byName.values()));
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setPackagesLoading(false);
      }
    }
    fetchPackages();
    return () => {
      active = false;
    };
  }, [shouldFetchPackages, query]);

  const shouldFetchRepos = hasRepos && !topic && (query ? activeTab === "Repositories" : landingTab === "repositories");

  useEffect(() => {
    if (!shouldFetchRepos) return;
    let active = true;
    async function fetchRepos() {
      setReposLoading(true);
      try {
        const [popularRes, userRes, searchComp] = await Promise.all([
          getPopularRepos(50).catch(() => ({ repos: [] })),
          token ? getRepos().catch(() => ({ repos: [] })) : Promise.resolve({ repos: [] }),
          query
            ? getSearchCompletions(query, 50).catch(() => ({ repositories: [] }))
            : Promise.resolve({ repositories: [] }),
        ]);
        if (!active) return;
        const searchCompRepos = ((searchComp as { repositories?: RepoData[] } | null | undefined)?.repositories ||
          []) as RepoData[];
        const allRepos: RepoData[] = [...searchCompRepos, ...(popularRes.repos || []), ...(userRes.repos || [])];

        const qTokens = query
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/^#/, ""))
          .filter(Boolean);
        const filtered =
          qTokens.length > 0
            ? allRepos.filter((r: RepoData) => {
                const hay = [r.namespace, r.project, r.description, r.provider].filter(Boolean).join(" ").toLowerCase();
                return qTokens.every((tok) => hay.includes(tok));
              })
            : allRepos;

        const seen = new Set<string>();
        const combined = filtered.filter((r: RepoData) => {
          const key = `${r.namespace}/${r.project}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setRepos(combined);
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setReposLoading(false);
      }
    }
    fetchRepos();
    return () => {
      active = false;
    };
  }, [shouldFetchRepos, query, token]);

  useEffect(() => {
    if (!query) return;
    if (activeTab === "People") {
      let active = true;
      async function fetchPeople() {
        setPeopleLoading(true);
        try {
          const data = await getSearchCompletions(query, 50);
          if (!active) return;
          const compData = data as { users?: PersonData[]; suggestions?: PersonData[] } | null | undefined;
          const users = Array.isArray(compData?.users)
            ? compData.users
            : Array.isArray(compData?.suggestions)
              ? compData.suggestions
              : [];
          setMatchedPeople(users as PersonData[]);
        } catch (err) {
          console.error("Failed to fetch search users:", err);
        } finally {
          if (active) setPeopleLoading(false);
        }
      }
      fetchPeople();
      return () => {
        active = false;
      };
    }
  }, [query, activeTab]);

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const trimmed = localQuery.trim();
      if (trimmed) {
        const next: Record<string, string> = { q: trimmed };
        const currentTab = (query ? activeTab : landingTab).toLowerCase();
        if (["packages", "repositories", "people", "media", "latest"].includes(currentTab)) {
          next.tab = currentTab;
        }
        setSearchParams(next);
      } else {
        setSearchParams({});
      }
    }
  };

  const clearSearch = () => {
    setLocalQuery("");
    setSearchParams({});
  };

  const handleBack = () => {
    navigate(-1);
  };

  const handleCopyTopic = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedTopicLink(true);
    setTimeout(() => setCopiedTopicLink(false), 2000);
  };

  // Filter computations
  const matchesQuery = (p: PostData) => {
    if (!query) return true;
    if (p.id !== undefined && backendMatchedIds.has(String(p.id))) return true;
    const tokens = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = [
      p.content,
      p.username,
      (p as any).display_name,
      (p as any).title,
      (p as any).artifact_title,
      (p as any).view_type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  };

  const hasPostMedia = (p: PostData): boolean => {
    if (p.artifact_view_id) return true;
    const postRecord = p as unknown as {
      media_url?: string;
      media_urls?: string[];
      metadata?: Record<string, unknown>;
    };
    if (postRecord.media_url || (Array.isArray(postRecord.media_urls) && postRecord.media_urls.length > 0)) return true;
    const meta = postRecord.metadata;
    if (meta && typeof meta === "object") {
      if (meta.media || meta.images || meta.mediaUrls || meta.spatialPin) return true;
    }
    if (typeof p.content === "string" && /!\[.*?\]\(.*?\)|<img[\s>]/i.test(p.content)) return true;
    return false;
  };

  const topPosts = posts.filter(matchesQuery).sort((a, b) => {
    const scoreA = ((a.like_count as number) || 0) + ((a.repost_count as number) || 0);
    const scoreB = ((b.like_count as number) || 0) + ((b.repost_count as number) || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    const engA = (a as unknown as { engagement_score?: number }).engagement_score || 0;
    const engB = (b as unknown as { engagement_score?: number }).engagement_score || 0;
    if (engB !== engA) return engB - engA;
    return (new Date(b.created_at as string).getTime() || 0) - (new Date(a.created_at as string).getTime() || 0);
  });

  const latestPosts = posts
    .filter(matchesQuery)
    .sort(
      (a, b) => (new Date(b.created_at as string).getTime() || 0) - (new Date(a.created_at as string).getTime() || 0),
    );

  const mediaPosts = posts.filter((p) => matchesQuery(p) && hasPostMedia(p));

  if (topic) {
    return (
      <ExploreTopicView
        topic={topic}
        localQuery={localQuery}
        setLocalQuery={setLocalQuery}
        handleSearchSubmit={handleSearchSubmit}
        handleBack={handleBack}
        topicFilter={topicFilter}
        setTopicFilter={handleSelectTopicTab}
        loading={loading}
        topicPosts={topicPosts}
        trending={trending}
        copiedTopicLink={copiedTopicLink}
        handleCopyTopic={handleCopyTopic}
        openCompose={openCompose}
      />
    );
  }

  if (query) {
    return (
      <ExploreSearchResultsView
        query={query}
        localQuery={localQuery}
        setLocalQuery={setLocalQuery}
        handleSearchSubmit={handleSearchSubmit}
        clearSearch={clearSearch}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        loading={loading || searchLoading}
        topPosts={topPosts}
        latestPosts={latestPosts}
        mediaPosts={mediaPosts}
        artifactPosts={mediaPosts}
        matchedPeople={matchedPeople}
        peopleLoading={peopleLoading}
        packages={packages}
        packagesLoading={packagesLoading}
        repos={repos}
        reposLoading={reposLoading}
        hasPackages={hasPackages}
        hasRepos={hasRepos}
      />
    );
  }

  return (
    <ExploreLandingView
      loading={loading}
      posts={posts}
      topPosts={topPosts}
      trending={trending}
      activeTab={landingTab}
      setActiveTab={setLandingTab}
      hasPackages={hasPackages}
      hasRepos={hasRepos}
      packages={packages}
      packagesLoading={packagesLoading}
      repos={repos}
      reposLoading={reposLoading}
      localQuery={localQuery}
      setLocalQuery={setLocalQuery}
      handleSearchSubmit={handleSearchSubmit}
    />
  );
};

export default ExplorePage;
