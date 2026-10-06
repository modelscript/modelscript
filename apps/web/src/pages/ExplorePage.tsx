// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  RocketIcon,
  SearchIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

interface StarterTemplate {
  id: string;
  title: string;
  category: "CAD" | "Simulation" | "MBSE" | "AI" | "Optimization" | "Polyglot";
  description: string;
  badge: string;
  icon: string;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "drone-chassis",
    title: "Drone Chassis Thread",
    category: "Polyglot",
    badge: "CAD + FEA + CFD",
    description:
      "Quadcopter assembly linking procedural Modelica CAD geometry to aerodynamic simulation and STEP export.",
    icon: "🛸",
  },
  {
    id: "sysml2",
    title: "SysML v2 Vehicle Architecture",
    category: "MBSE",
    badge: "SysML v2",
    description: "Complete vehicle architecture model showcasing KerML parts, ports, state machines, and requirements.",
    icon: "🚗",
  },
  {
    id: "bouncing-ball",
    title: "Bouncing Ball Dynamics",
    category: "Simulation",
    badge: "WASM Solvers",
    description:
      "Classic hybrid continuous/discrete physical modeling with state events, restitution, and zero-crossing detection.",
    icon: "⚽",
  },
  {
    id: "rlc",
    title: "Analogue RLC Circuit",
    category: "Simulation",
    badge: "Analogue EE",
    description:
      "Second-order electrical resonant circuit with frequency response plotting and interactive parameter tuning.",
    icon: "⚡",
  },
  {
    id: "injection-molding-cosim",
    title: "Injection Molding Co-Simulation",
    category: "Polyglot",
    badge: "FMI Co-Sim",
    description:
      "Thermal-hydraulic coupling simulating polymer mold cavity fill, temperature decay, and cooling cycle dynamics.",
    icon: "🏭",
  },
  {
    id: "surrogate",
    title: "AI Surrogate ROMs",
    category: "AI",
    badge: "Neural ROM",
    description: "WebAssembly-accelerated neural surrogate model for ultra-fast reduced-order dynamic simulation.",
    icon: "🧠",
  },
  {
    id: "assembly-to-multibody",
    title: "STEP CAD to Multi-Body",
    category: "CAD",
    badge: "OpenCascade STEP",
    description: "Automatic conversion from 3D STEP mechanical assemblies to articulated multibody dynamic equations.",
    icon: "📐",
  },
  {
    id: "calibration",
    title: "Parameter Calibration & Fitting",
    category: "Optimization",
    badge: "Optimization",
    description:
      "Non-linear least squares parameter estimation fitting dynamic Modelica models against measured time-series data.",
    icon: "🎯",
  },
];

const SearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(6, 8, 15, 0.85);
  border-bottom: 1px solid var(--color-border);
`;

const MobileSearchWrapper = styled.div`
  display: none;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--surface-hud);

  @media (max-width: 1000px) {
    display: block;
  }
`;

const SearchInputWrapper = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: var(--color-text-muted);
  }

  input {
    width: 100%;
    padding: 10px 16px 10px 40px;
    border-radius: 9999px;
    background-color: var(--color-search-bg);
    border: 1px solid var(--color-search-border);
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    color: var(--color-text-primary);
    transition: all 0.2s ease;

    &:focus {
      background-color: var(--color-search-bg);
      border-color: var(--color-accent-cyan);
      box-shadow: 0 0 12px var(--color-search-focus);
    }

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.7;
    }
  }
`;

import { CircleIconButton as HeaderIconButton } from "../components/SharedStyles";

const TabContainer = styled.div`
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  background-color: transparent;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const TabButton = styled.button<{ $active?: boolean }>`
  flex: 1;
  min-width: 80px;
  background: none;
  border: none;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  cursor: pointer;
  position: relative;
  text-align: center;
  white-space: nowrap;
  transition:
    color 0.2s,
    background-color 0.2s;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 15%;
      right: 15%;
      height: 3px;
      border-radius: 9999px;
      background: var(--gradient-cta);
      box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    }
  `}
`;

const ExplorePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const topic = searchParams.get("topic") || "";
  const navigate = useNavigate();
  const { token } = useAuth();
  const templatesScrollRef = React.useRef<HTMLDivElement>(null);

  const scrollTemplates = (direction: "left" | "right") => {
    if (templatesScrollRef.current) {
      const scrollAmount = 280;
      templatesScrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  interface PostData {
    id: string;
    [key: string]: unknown;
  }

  interface TopicData {
    name: string;
    tag?: string;
    postsCount?: number;
    [key: string]: unknown;
  }

  interface PackageData {
    name: string;
    version?: string;
    description?: string;
    [key: string]: unknown;
  }

  interface RepoData {
    id?: string;
    provider?: string;
    namespace: string;
    project: string;
    description?: string;
    avatar_url?: string;
    [key: string]: unknown;
  }

  interface PersonData {
    id?: string;
    username?: string;
    name?: string;
    avatar?: string;
    [key: string]: unknown;
  }

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

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  useEffect(() => {
    if (topic) {
      async function fetchTopicPosts() {
        setLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/social/topics/${encodeURIComponent(topic)}/posts`);
          if (res.ok) {
            const data = await res.json();
            setTopicPosts(data.posts || []);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }
      fetchTopicPosts();
    }
  }, [topic]);

  useEffect(() => {
    async function fetchExplore() {
      try {
        const [postsRes, trendingRes] = await Promise.all([
          fetch(`${API_BASE_URL}/social/explore`),
          fetch(`${API_BASE_URL}/social/trending?limit=5`),
        ]);

        if (postsRes.ok) {
          const data = await postsRes.json();
          setPosts(data.posts || []);
        }

        if (trendingRes.ok) {
          const data = await trendingRes.json();
          setTrending(data.topics || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchExplore();
  }, []);

  useEffect(() => {
    if (!query) return;
    if (activeTab === "Artifacts") {
      async function fetchPackages() {
        setPackagesLoading(true);
        try {
          const res = await fetch(`${API_BASE_URL}/libraries?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            setPackages(data.packages || []);
          }
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
          const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
          const res = await fetch(`${API_BASE_URL}/repos`, { headers });
          let userRepos = [];
          if (res.ok) {
            const data = await res.json();
            userRepos = data.repos || [];
          }

          const curatedRepos = [
            {
              id: "curated-msl",
              provider: "github",
              namespace: "modelica",
              project: "Modelica-Standard-Library",
              description: "The official Modelica Standard Library",
              avatar_url: "",
            },
            {
              id: "curated-compiler",
              provider: "gitlab",
              namespace: "modelscript",
              project: "compiler",
              description: "Salsa-powered Modelica compiler and simulation engine",
              avatar_url: "",
            },
            {
              id: "curated-web",
              provider: "github",
              namespace: "modelscript",
              project: "web",
              description: "Frontend social workspace for ModelScript",
              avatar_url: "",
            },
            {
              id: "curated-fmi",
              provider: "github",
              namespace: "modelica-association",
              project: "FMI-Standard",
              description: "Functional Mock-up Interface standard definitions",
              avatar_url: "",
            },
          ];

          const filteredCurated = curatedRepos.filter(
            (r) =>
              r.project.toLowerCase().includes(query.toLowerCase()) ||
              r.namespace.toLowerCase().includes(query.toLowerCase()) ||
              (r.description && r.description.toLowerCase().includes(query.toLowerCase())),
          );
          const filteredUser = userRepos.filter(
            (r: RepoData) =>
              r.project.toLowerCase().includes(query.toLowerCase()) ||
              r.namespace.toLowerCase().includes(query.toLowerCase()) ||
              (r.description && r.description.toLowerCase().includes(query.toLowerCase())),
          );

          const seen = new Set();
          const combined = [...filteredUser, ...filteredCurated].filter((r) => {
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
          const res = await fetch(`${API_BASE_URL}/search/completions?q=${encodeURIComponent(query)}&limit=30`);
          if (res.ok) {
            const data = await res.json();
            setMatchedPeople(data.users || []);
          }
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

  // Filter computations
  const topPosts = posts
    .filter((p) => p.content && p.content.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.like_count || 0) + (b.repost_count || 0) - ((a.like_count || 0) + (a.repost_count || 0)));

  const latestPosts = posts
    .filter((p) => p.content && p.content.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const artifactPosts = posts.filter(
    (p) => p.artifact_view_id !== null && p.content && p.content.toLowerCase().includes(query.toLowerCase()),
  );

  const TABS = ["Top", "Latest", "Templates", "People", "Media", "Artifacts", "Repositories"];

  if (topic) {
    return (
      <Box>
        <SearchHeader>
          <HeaderIconButton onClick={handleBack} aria-label="Back">
            <ArrowLeftIcon size={20} />
          </HeaderIconButton>
          <SearchInputWrapper>
            <SearchIcon size={16} />
            <input
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              onKeyDown={handleSearchSubmit}
              placeholder="Search"
            />
          </SearchInputWrapper>
        </SearchHeader>
        {loading ? (
          <Box p={4} display="flex" justifyContent="center">
            <Spinner size="large" />
          </Box>
        ) : (
          <Box>
            {topicPosts.map((post) => (
              <Post key={post.id} post={post} />
            ))}
            {topicPosts.length === 0 && (
              <Box p={6} textAlign="center" color="var(--color-text-muted)">
                No posts found for this topic.
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  }

  if (query) {
    return (
      <Box>
        <SearchHeader>
          <HeaderIconButton onClick={clearSearch} aria-label="Back">
            <ArrowLeftIcon size={20} />
          </HeaderIconButton>
          <SearchInputWrapper>
            <SearchIcon size={16} />
            <input
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              onKeyDown={handleSearchSubmit}
              placeholder="Search"
            />
            {localQuery && (
              <button
                type="button"
                onClick={clearSearch}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Clear search"
              >
                <XCircleFillIcon size={16} />
              </button>
            )}
          </SearchInputWrapper>
        </SearchHeader>

        <TabContainer>
          {TABS.map((tab) => (
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
                <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={3}>
                  {STARTER_TEMPLATES.filter(
                    (t) =>
                      t.title.toLowerCase().includes(query.toLowerCase()) ||
                      t.description.toLowerCase().includes(query.toLowerCase()) ||
                      t.category.toLowerCase().includes(query.toLowerCase()) ||
                      t.badge.toLowerCase().includes(query.toLowerCase()),
                  ).map((template) => (
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
                          borderColor: "var(--color-accent-purple)",
                          boxShadow: "var(--glow-card)",
                        },
                      }}
                    >
                      <Box>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                          <span style={{ fontSize: "24px" }}>{template.icon}</span>
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
                            background: "var(--gradient-cta)",
                            color: "white",
                            fontSize: "13px",
                            fontWeight: 600,
                            textDecoration: "none",
                            boxShadow: "var(--glow-ai-sm)",
                          }}
                        >
                          <CodeIcon size={14} /> Launch in IDE
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
                              backgroundImage: u.avatar_url ? `url(${u.avatar_url})` : "none",
                              flexShrink: 0,
                            }}
                          >
                            {!u.avatar_url && u.username.charAt(0).toUpperCase()}
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
                              {u.display_name || u.username}
                            </Heading>
                            <Text color="var(--color-text-muted)" style={{ fontSize: "14px" }}>
                              @{u.username}
                            </Text>
                            {u.bio && (
                              <Text
                                as="p"
                                style={{
                                  fontSize: "13px",
                                  color: "var(--color-text-primary)",
                                  margin: "4px 0 0 0",
                                  lineHeight: 1.3,
                                }}
                              >
                                {u.bio}
                              </Text>
                            )}
                          </Box>
                        </Link>
                        <FollowButton username={u.username} initialIsFollowing={u.isFollowing || false} size="small" />
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
                          to={`/packages/${pkg.name}`}
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
                              @npm/{pkg.name} · v{pkg.latestVersion || "1.0.0"}
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
                          to={`/packages/${pkg.name}`}
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
  }

  // Normal non-search mode
  return (
    <Box>
      <MobileSearchWrapper>
        <div
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 14px",
            borderRadius: "9999px",
            background: "var(--color-search-bg, rgba(255, 255, 255, 0.04))",
            border: "1px solid var(--color-search-border, var(--color-border-glass))",
            color: "var(--color-text-muted)",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--color-accent-purple)", fontSize: "14px" }}>⚡</span>
          <span style={{ flex: 1 }}>Ask AI Copilot or search...</span>
          <kbd
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--color-border-glass)",
              borderRadius: "4px",
              padding: "2px 6px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
            }}
          >
            ⌘ K
          </kbd>
        </div>
      </MobileSearchWrapper>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
          {/* Starter Engineering Workspaces */}
          <Box
            p={3}
            borderBottom="1px solid var(--color-border)"
            style={{
              background: "var(--surface-hud, rgba(14, 20, 36, 0.4))",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box>
                <Heading
                  as="h3"
                  style={{
                    fontSize: "16px",
                    fontWeight: 800,
                    color: "var(--color-text-heading)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <RocketIcon size={18} /> Starter Engineering Workspaces
                </Heading>
                <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Launch ready-to-run polyglot models, 3D CAD assemblies, and WASM solvers with zero setup.
                </Text>
              </Box>
              <Box display="flex" alignItems="center" gap="10px">
                <Box display="flex" alignItems="center" gap="4px">
                  <button
                    type="button"
                    onClick={() => scrollTemplates("left")}
                    aria-label="Scroll left"
                    style={{
                      background: "var(--color-bg-card, rgba(255, 255, 255, 0.05))",
                      border: "1px solid var(--color-border-glass)",
                      color: "var(--color-text-muted)",
                      borderRadius: "6px",
                      width: "26px",
                      height: "26px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--color-accent-cyan)";
                      e.currentTarget.style.borderColor = "var(--color-accent-cyan)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--color-text-muted)";
                      e.currentTarget.style.borderColor = "var(--color-border-glass)";
                    }}
                  >
                    <ChevronLeftIcon size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollTemplates("right")}
                    aria-label="Scroll right"
                    style={{
                      background: "var(--color-bg-card, rgba(255, 255, 255, 0.05))",
                      border: "1px solid var(--color-border-glass)",
                      color: "var(--color-text-muted)",
                      borderRadius: "6px",
                      width: "26px",
                      height: "26px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--color-accent-cyan)";
                      e.currentTarget.style.borderColor = "var(--color-accent-cyan)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--color-text-muted)";
                      e.currentTarget.style.borderColor = "var(--color-border-glass)";
                    }}
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </Box>
                <Link
                  to="/ide"
                  style={{
                    fontSize: "13px",
                    color: "var(--color-accent-cyan)",
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CodeIcon size={14} /> Open Blank IDE
                </Link>
              </Box>
            </Box>

            <Box
              ref={templatesScrollRef}
              display="flex"
              gap="12px"
              overflowX="auto"
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                overflowX: "auto",
                paddingBottom: "8px",
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "none",
              }}
            >
              {STARTER_TEMPLATES.map((tmpl) => (
                <Box
                  key={tmpl.id}
                  bg="var(--color-bg-card)"
                  border="1px solid var(--color-border-glass)"
                  borderRadius="10px"
                  p="14px"
                  minWidth="240px"
                  maxWidth="260px"
                  display="flex"
                  flexDirection="column"
                  justifyContent="space-between"
                  style={{
                    flexShrink: 0,
                    scrollSnapAlign: "start",
                  }}
                  sx={{
                    flexShrink: 0,
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    "&:hover": {
                      borderColor: "var(--color-accent-purple)",
                      transform: "translateY(-2px)",
                      boxShadow: "var(--glow-card)",
                    },
                  }}
                >
                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <span style={{ fontSize: "20px" }}>{tmpl.icon}</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "var(--font-mono)",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: "var(--color-accent-blue-bg)",
                          color: "var(--color-accent-cyan)",
                          border: "1px solid var(--color-accent-blue-border)",
                          fontWeight: 600,
                        }}
                      >
                        {tmpl.badge}
                      </span>
                    </Box>
                    <div
                      style={{
                        fontWeight: "bold",
                        fontSize: "14px",
                        color: "var(--color-text-heading)",
                        marginBottom: "4px",
                      }}
                    >
                      {tmpl.title}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-muted)",
                        lineHeight: 1.4,
                        marginBottom: "12px",
                      }}
                    >
                      {tmpl.description}
                    </div>
                  </Box>
                  <Link
                    to={`/ide/${tmpl.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      background: "var(--gradient-cta)",
                      color: "white",
                      fontSize: "12px",
                      fontWeight: 600,
                      textDecoration: "none",
                      boxShadow: "var(--glow-ai-sm)",
                    }}
                  >
                    <CodeIcon size={12} /> Launch in IDE
                  </Link>
                </Box>
              ))}
            </Box>
          </Box>

          {trending.length > 0 && (
            <Box
              p={3}
              borderBottom="1px solid var(--color-border)"
              style={{ background: "var(--surface-hud, rgba(14, 20, 36, 0.2))" }}
            >
              <Heading
                as="h3"
                style={{ fontSize: "16px", fontWeight: 800, marginBottom: "12px", color: "var(--color-text-heading)" }}
              >
                Trending Topics
              </Heading>
              <Box
                display="flex"
                gap="12px"
                sx={{
                  overflowX: "auto",
                  paddingBottom: "8px",
                  "&::-webkit-scrollbar": { display: "none" },
                  scrollbarWidth: "none",
                }}
              >
                {trending.map((t, index) => (
                  <Link
                    key={t.id}
                    to={`/explore?topic=${encodeURIComponent(t.concept)}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Box
                      bg="var(--color-bg-card)"
                      border="1px solid var(--color-border-glass)"
                      borderRadius="8px"
                      p="12px 16px"
                      minWidth="140px"
                      sx={{
                        transition: "all 0.2s ease",
                        "&:hover": {
                          backgroundColor: "rgba(255, 255, 255, 0.05)",
                          borderColor: "var(--color-accent-purple)",
                        },
                      }}
                    >
                      <div style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
                        {index + 1} · Trending
                      </div>
                      <div style={{ fontWeight: "bold", fontSize: "15px", color: "var(--color-text-primary)" }}>
                        {t.display_name}
                      </div>
                    </Box>
                  </Link>
                ))}
              </Box>
            </Box>
          )}

          <Box p={3} borderBottom="1px solid var(--color-border)">
            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 800, color: "var(--color-text-heading)" }}>
              Suggested Posts
            </Heading>
          </Box>

          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {posts.length === 0 && (
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
              No trending posts right now.
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ExplorePage;
