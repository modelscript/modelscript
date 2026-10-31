// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from "react";
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
import { usePageTitle } from "../util/title";
import type { PackageData, PersonData, PostData, RepoData, TopicData } from "./explore";
import { ExploreLandingView, ExploreSearchResultsView, ExploreTopicView } from "./explore";

const ExplorePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const rawTopic = searchParams.get("topic") || searchParams.get("tag") || "";
  const topic = rawTopic || (query.startsWith("#") ? query.slice(1) : "");
  usePageTitle(query && !query.startsWith("#") ? `Search: ${query}` : topic ? `Topic: #${topic}` : "Explore");

  const navigate = useNavigate();
  const { token } = useAuth();
  const { openCompose } = React.useContext(ComposeContext);

  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [copiedTopicLink, setCopiedTopicLink] = useState(false);
  const templatesScrollRef = useRef<HTMLDivElement>(null);

  const [posts, setPosts] = useState<PostData[]>([]);
  const [topicPosts, setTopicPosts] = useState<PostData[]>([]);
  const [trending, setTrending] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Top");
  const [localQuery, setLocalQuery] = useState("");

  const [packages, setPackages] = useState<PackageData[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  const [repos, setRepos] = useState<RepoData[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  const [matchedPeople, setMatchedPeople] = useState<PersonData[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const scrollTemplates = (direction: "left" | "right") => {
    if (templatesScrollRef.current) {
      const scrollAmount = 280;
      templatesScrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
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
            artifactType: topicFilter !== "all" ? topicFilter : undefined,
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
  }, [topic, topicFilter]);

  useEffect(() => {
    async function fetchExplore() {
      try {
        const [postsData, trendingData] = await Promise.all([getExplore(), getTrending(5)]);
        setPosts(postsData.posts || []);
        setTrending(trendingData.topics || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchExplore();
  }, []);

  const [backendMatchedIds, setBackendMatchedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query || topic) {
      setBackendMatchedIds(new Set());
      return;
    }
    let active = true;
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
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [query, topic]);

  useEffect(() => {
    if (!query) return;
    if (activeTab === "Artifacts") {
      async function fetchPackages() {
        setPackagesLoading(true);
        try {
          const pkgs = await getLibraries(query);
          setPackages(pkgs || []);
        } catch (err) {
          console.error(err);
        } finally {
          setPackagesLoading(false);
        }
      }
      fetchPackages();
    }
  }, [query, activeTab]);

  useEffect(() => {
    if (!query) return;
    if (activeTab === "Repositories") {
      async function fetchRepos() {
        setReposLoading(true);
        try {
          const [popularRes, userRes] = await Promise.all([
            getPopularRepos(50).catch(() => ({ repos: [] })),
            token ? getRepos().catch(() => ({ repos: [] })) : Promise.resolve({ repos: [] }),
          ]);
          const allRepos: RepoData[] = [...(popularRes.repos || []), ...(userRes.repos || [])];

          const qLower = query.toLowerCase();
          const filtered = allRepos.filter(
            (r: RepoData) =>
              (r.project && r.project.toLowerCase().includes(qLower)) ||
              (r.namespace && r.namespace.toLowerCase().includes(qLower)) ||
              (r.description && r.description.toLowerCase().includes(qLower)),
          );

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
          setReposLoading(false);
        }
      }
      fetchRepos();
    }
  }, [query, activeTab, token]);

  useEffect(() => {
    if (!query) return;
    if (activeTab === "People") {
      async function fetchPeople() {
        setPeopleLoading(true);
        try {
          const data = await getSearchCompletions(query, 30);
          setMatchedPeople(
            (data.suggestions || (data as { users?: PersonData[] | undefined }).users || []) as unknown as PersonData[],
          );
        } catch (err) {
          console.error("Failed to fetch search users:", err);
        } finally {
          setPeopleLoading(false);
        }
      }
      fetchPeople();
    }
  }, [query, activeTab]);

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (localQuery.trim()) {
        setSearchParams({ q: localQuery.trim() });
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
    const q = query.toLowerCase();
    return (
      String(p.content || "")
        .toLowerCase()
        .includes(q) ||
      String(p.username || "")
        .toLowerCase()
        .includes(q) ||
      String((p as any).display_name || "")
        .toLowerCase()
        .includes(q) ||
      String((p as any).title || "")
        .toLowerCase()
        .includes(q)
    );
  };

  const topPosts = posts
    .filter(matchesQuery)
    .sort(
      (a, b) =>
        ((b.like_count as number) || 0) +
        ((b.repost_count as number) || 0) -
        (((a.like_count as number) || 0) + ((a.repost_count as number) || 0)),
    );

  const latestPosts = posts
    .filter(matchesQuery)
    .sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());

  const artifactPosts = posts.filter((p) => Boolean(p.artifact_view_id) && matchesQuery(p));

  if (topic) {
    return (
      <ExploreTopicView
        topic={topic}
        localQuery={localQuery}
        setLocalQuery={setLocalQuery}
        handleSearchSubmit={handleSearchSubmit}
        handleBack={handleBack}
        topicFilter={topicFilter}
        setTopicFilter={setTopicFilter}
        loading={loading}
        topicPosts={topicPosts}
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
        loading={loading}
        topPosts={topPosts}
        latestPosts={latestPosts}
        artifactPosts={artifactPosts}
        matchedPeople={matchedPeople}
        peopleLoading={peopleLoading}
        packages={packages}
        packagesLoading={packagesLoading}
        repos={repos}
        reposLoading={reposLoading}
      />
    );
  }

  return (
    <ExploreLandingView
      loading={loading}
      posts={posts}
      trending={trending}
      scrollTemplates={scrollTemplates}
      templatesScrollRef={templatesScrollRef}
      localQuery={localQuery}
      setLocalQuery={setLocalQuery}
      handleSearchSubmit={handleSearchSubmit}
    />
  );
};

export default ExplorePage;
