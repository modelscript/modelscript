// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  ShareIcon,
  TagIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getExplore, getLibraries, getRepos, getSearchCompletions, getTopicPosts, getTrending } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import FollowButton from "../components/FollowButton";
import Post from "../components/Post";
import { usePageTitle } from "../util/title";

const CURATED_ENGINEERING_DOMAINS = [
  { tag: "Aerodynamics", name: "Aerodynamics", icon: "🌪️", desc: "NACA airfoils, compressible flow & CFD" },
  { tag: "Thermodynamics", name: "Thermodynamics", icon: "🌡️", desc: "Heat transfer, cooling cycles & thermal grids" },
  { tag: "Robotics", name: "Robotics", icon: "🤖", desc: "Kinematics, inverse dynamics & bipedal control" },
  { tag: "AdditiveMfg", name: "AdditiveMfg", icon: "🖨️", desc: "Toolpaths, slicing & 5-axis CNC G-Code" },
  { tag: "DigitalTwin", name: "DigitalTwin", icon: "👥", desc: "AAS Asset Administration Shells & telemetry" },
  { tag: "ControlSystems", name: "ControlSystems", icon: "🎛️", desc: "State-space, PID & closed-loop stability" },
  { tag: "Multibody", name: "Multibody", icon: "⚙️", desc: "Rigid body mechanics, joints & articulated assemblies" },
  { tag: "CAD", name: "CAD 3D", icon: "📐", desc: "STEP, OpenCASCADE & procedural CSG geometry" },
];

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
  const rawTopic = searchParams.get("topic") || searchParams.get("tag") || "";
  const topic = rawTopic || (query.startsWith("#") ? query.slice(1) : "");
  usePageTitle(query && !query.startsWith("#") ? `Search: ${query}` : topic ? `Topic: #${topic}` : "Explore");
  const navigate = useNavigate();
  const { token } = useAuth();
  const { openCompose } = React.useContext(ComposeContext);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [copiedTopicLink, setCopiedTopicLink] = useState(false);
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
          const data = await getRepos();
          const userRepos = data.repos || [];

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
          const data = await getSearchCompletions(query, 30);
          setMatchedPeople(
            (data.suggestions || (data as { users?: PersonData[] }).users || []) as unknown as PersonData[],
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
    const TOPIC_ARTIFACT_TABS = [
      { id: "all", label: "All Posts" },
      { id: "cad", label: "CAD 3D", emoji: "📐" },
      { id: "simulation", label: "FEA / CFD", emoji: "🔥" },
      { id: "plot", label: "Plots & Data", emoji: "📈" },
      { id: "modelica", label: "Modelica Code", emoji: "⚡" },
    ];

    const RELATED_ENGINEERING_TAGS = [
      "Aerodynamics",
      "Thermodynamics",
      "Robotics",
      "AdditiveMfg",
      "DigitalTwin",
      "ControlSystems",
      "Multibody",
      "FluidDynamics",
      "CAD",
      "Modelica",
    ].filter((t) => t.toLowerCase() !== topic.toLowerCase());

    const handleCopyTopic = () => {
      navigator.clipboard.writeText(window.location.href);
      setCopiedTopicLink(true);
      setTimeout(() => setCopiedTopicLink(false), 2000);
    };

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
              placeholder="Search or enter #hashtag"
            />
          </SearchInputWrapper>
        </SearchHeader>

        {/* Engineering Topic Hero Banner */}
        <Box
          p={4}
          borderBottom="1px solid var(--color-border)"
          style={{
            background: "linear-gradient(180deg, rgba(139, 92, 246, 0.12) 0%, rgba(6, 182, 212, 0.04) 100%)",
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={3} flexWrap="wrap">
            <Box>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "3px 8px",
                    borderRadius: "9999px",
                    background: "rgba(139, 92, 246, 0.2)",
                    color: "var(--color-accent-purple)",
                    border: "1px solid rgba(139, 92, 246, 0.4)",
                  }}
                >
                  Engineering Topic
                </span>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  {topicPosts.length} {topicPosts.length === 1 ? "post" : "posts"} indexed
                </span>
              </Box>
              <Heading
                as="h1"
                style={{
                  fontSize: "26px",
                  fontWeight: 800,
                  margin: "0 0 6px 0",
                  color: "var(--color-text-heading)",
                  letterSpacing: "-0.5px",
                }}
              >
                #{topic}
              </Heading>
              <Text
                as="p"
                style={{
                  fontSize: "14px",
                  color: "var(--color-text-muted)",
                  margin: 0,
                  maxWidth: "540px",
                  lineHeight: 1.5,
                }}
              >
                Explore engineering models, dynamic simulations, CAD geometry, and discussions tagged with #{topic}.
              </Text>
            </Box>

            <Box display="flex" alignItems="center" gap={2}>
              <button
                type="button"
                onClick={handleCopyTopic}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid var(--color-border-glass)",
                  color: "var(--color-text-primary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copiedTopicLink ? <CheckIcon size={14} fill="var(--color-accent-cyan)" /> : <ShareIcon size={14} />}
                <span>{copiedTopicLink ? "Link Copied" : "Share"}</span>
              </button>
              {openCompose && (
                <button
                  type="button"
                  onClick={() => openCompose({ defaultText: `#${topic} ` })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: "var(--gradient-cta)",
                    color: "white",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 0 12px rgba(139, 92, 246, 0.35)",
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Post with #{topic}</span>
                </button>
              )}
            </Box>
          </Box>

          {/* Related Engineering Hashtags */}
          <Box mt={3} pt={3} borderTop="1px solid rgba(255, 255, 255, 0.06)">
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                }}
              >
                Related Tags:
              </span>
              {RELATED_ENGINEERING_TAGS.slice(0, 6).map((rel) => (
                <Link
                  key={rel}
                  to={`/explore?topic=${encodeURIComponent(rel)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "var(--color-text-secondary)",
                    textDecoration: "none",
                  }}
                >
                  #{rel}
                </Link>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Topic Sub-filter Tabs */}
        <TabContainer style={{ borderBottom: "1px solid var(--color-border)" }}>
          {TOPIC_ARTIFACT_TABS.map((tab) => (
            <TabButton key={tab.id} $active={topicFilter === tab.id} onClick={() => setTopicFilter(tab.id)}>
              {tab.emoji ? `${tab.emoji} ` : ""}
              {tab.label}
            </TabButton>
          ))}
        </TabContainer>

        {loading ? (
          <Box p={6} display="flex" justifyContent="center">
            <Spinner size="large" />
          </Box>
        ) : (
          <Box>
            {topicPosts.map((post) => (
              <Post key={post.id} post={post} />
            ))}
            {topicPosts.length === 0 && (
              <Box p={6} textAlign="center">
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🏷️</div>
                <Heading
                  as="h3"
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    marginBottom: "8px",
                    color: "var(--color-text-heading)",
                  }}
                >
                  No Posts Found for #{topic}
                </Heading>
                <Text
                  as="p"
                  style={{
                    fontSize: "14px",
                    color: "var(--color-text-muted)",
                    maxWidth: "420px",
                    margin: "0 auto 20px auto",
                  }}
                >
                  {topicFilter !== "all"
                    ? `No posts tagged #${topic} with ${TOPIC_ARTIFACT_TABS.find((t) => t.id === topicFilter)?.label} artifacts yet.`
                    : `Be the first engineer to publish a simulation model, CAD geometry, or question tagged #${topic}!`}
                </Text>
                {openCompose && (
                  <button
                    type="button"
                    onClick={() => openCompose({ defaultText: `#${topic} ` })}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      background: "var(--gradient-cta)",
                      color: "white",
                      border: "none",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <PlusIcon size={14} />
                    <span>Create First #{topic} Post</span>
                  </button>
                )}
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
                      Classic hybrid continuous/discrete physical modeling. Simulate zero-crossing state event
                      detection, restitution coefficient, and real-time WebAssembly numerical integration.
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
                  <RocketIcon size={18} /> Engineering Workspaces
                </Heading>
                <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Start clean with the recommended blank workspace, or open deprecated legacy example projects.
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
                  <CodeIcon size={14} /> Open Blank Workspace (Recommended)
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
              {/* Blank Project Workspace Card */}
              <Box
                key="blank-project-carousel"
                bg="var(--color-bg-card)"
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
                  background: "linear-gradient(135deg, rgba(88, 166, 255, 0.08) 0%, rgba(163, 113, 247, 0.12) 100%)",
                  border: "1px solid rgba(163, 113, 247, 0.35)",
                  boxShadow: "0 0 16px rgba(163, 113, 247, 0.1)",
                }}
                sx={{
                  flexShrink: 0,
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  "&:hover": {
                    borderColor: "var(--color-accent-cyan)",
                    transform: "translateY(-2px)",
                    boxShadow: "var(--glow-card)",
                  },
                }}
              >
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <span style={{ fontSize: "20px" }}>📁</span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: "rgba(6, 182, 212, 0.15)",
                        color: "var(--color-accent-cyan)",
                        border: "1px solid rgba(6, 182, 212, 0.4)",
                        fontWeight: 600,
                      }}
                    >
                      Clean Slate
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
                    Blank Project
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      lineHeight: 1.4,
                      marginBottom: "12px",
                    }}
                  >
                    Clean slate in-browser workspace. Start fresh with Modelica, SysML v2, or 3D CAD modeling.
                  </div>
                </Box>
                <Link
                  to="/ide"
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
                  <CodeIcon size={12} /> Launch Blank Workspace
                </Link>
              </Box>

              {/* Bouncing Ball Workspace Card */}
              <Box
                key="bouncing-ball-carousel"
                bg="var(--color-bg-card)"
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
                  background: "linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.12) 100%)",
                  border: "1px solid rgba(236, 72, 153, 0.35)",
                  boxShadow: "0 0 16px rgba(236, 72, 153, 0.1)",
                }}
                sx={{
                  flexShrink: 0,
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  "&:hover": {
                    borderColor: "#f43f5e",
                    transform: "translateY(-2px)",
                    boxShadow: "var(--glow-card)",
                  },
                }}
              >
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <span style={{ fontSize: "20px" }}>⚽</span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: "rgba(236, 72, 153, 0.15)",
                        color: "#f43f5e",
                        border: "1px solid rgba(236, 72, 153, 0.4)",
                        fontWeight: 600,
                      }}
                    >
                      Physical Simulation
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
                    Bouncing Ball
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      lineHeight: 1.4,
                      marginBottom: "12px",
                    }}
                  >
                    Continuous & discrete hybrid events with restitution and zero-crossing detection.
                  </div>
                </Box>
                <Link
                  to="/ide/bouncing-ball"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #e11d48, #9333ea)",
                    color: "white",
                    fontSize: "12px",
                    fontWeight: 600,
                    textDecoration: "none",
                    boxShadow: "0 2px 8px rgba(225, 29, 72, 0.35)",
                  }}
                >
                  <CodeIcon size={12} /> Launch Bouncing Ball
                </Link>
              </Box>

              {STARTER_TEMPLATES.filter((tmpl) => tmpl.id !== "bouncing-ball").map((tmpl) => (
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
                      borderColor: "rgba(210, 153, 34, 0.5)",
                      transform: "translateY(-2px)",
                      boxShadow: "0 0 16px rgba(210, 153, 34, 0.1)",
                    },
                  }}
                >
                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <span style={{ fontSize: "20px" }}>{tmpl.icon}</span>
                      <Box display="flex" gap="4px" alignItems="center">
                        <span
                          style={{
                            fontSize: "9px",
                            fontFamily: "var(--font-mono)",
                            padding: "1px 5px",
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
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--color-border-glass)",
                      color: "var(--color-text-muted)",
                      fontSize: "12px",
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    <CodeIcon size={12} /> Launch Legacy
                  </Link>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Curated Engineering Domains & Hashtags */}
          <Box
            p={3}
            borderBottom="1px solid var(--color-border)"
            style={{ background: "var(--surface-hud, rgba(14, 20, 36, 0.35))" }}
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
                  <TagIcon size={16} /> Engineering Domains &amp; Hashtags
                </Heading>
                <Text style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Discover specialized simulation models, CAD geometries, and physical twin discussions by engineering
                  discipline.
                </Text>
              </Box>
            </Box>
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
              {CURATED_ENGINEERING_DOMAINS.map((dom) => (
                <Link
                  key={dom.tag}
                  to={`/explore?topic=${encodeURIComponent(dom.tag)}`}
                  style={{ textDecoration: "none", flexShrink: 0 }}
                >
                  <Box
                    bg="var(--color-bg-card)"
                    border="1px solid var(--color-border-glass)"
                    borderRadius="10px"
                    p="14px"
                    minWidth="200px"
                    maxWidth="220px"
                    sx={{
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        borderColor: "var(--color-accent-purple)",
                        transform: "translateY(-2px)",
                        boxShadow: "0 0 16px rgba(139, 92, 246, 0.15)",
                      },
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <span style={{ fontSize: "22px" }}>{dom.icon}</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "var(--font-mono)",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: "rgba(139, 92, 246, 0.15)",
                          color: "var(--color-accent-purple)",
                          border: "1px solid rgba(139, 92, 246, 0.3)",
                          fontWeight: 600,
                        }}
                      >
                        #{dom.tag}
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
                      {dom.name}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                      {dom.desc}
                    </div>
                  </Box>
                </Link>
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
