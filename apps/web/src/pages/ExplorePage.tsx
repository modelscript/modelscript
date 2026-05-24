/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon, KebabHorizontalIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

const Header = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: 0;
  background-color: transparent;
  backdrop-filter: blur(12px);
  z-index: 10;
  padding: 16px;
`;

const SearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background-color: transparent;
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const SearchInputWrapper = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: var(--color-fg-muted);
  }

  input {
    width: 100%;
    padding: 10px 16px 10px 40px;
    border-radius: 9999px;
    background-color: var(--color-canvas-subtle);
    border: 1px solid transparent;
    font-size: 15px;
    outline: none;
    box-sizing: border-box;
    color: var(--color-fg-default);

    &:focus {
      background-color: var(--color-canvas-default);
      border-color: #1d9bf0;
    }
  }
`;

const HeaderIconButton = styled.button`
  background: none;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-fg-default);
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const TabContainer = styled.div`
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border-subtle);
  background-color: var(--color-canvas-default);
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
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  cursor: pointer;
  position: relative;
  text-align: center;
  white-space: nowrap;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 20%;
      right: 20%;
      height: 4px;
      border-radius: 9999px;
      background-color: #1d9bf0;
    }
  `}
`;

const ExplorePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const topic = searchParams.get("topic") || "";
  const navigate = useNavigate();
  const { token } = useAuth();

  const [posts, setPosts] = useState<any[]>([]);
  const [topicPosts, setTopicPosts] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Top");
  const [localQuery, setLocalQuery] = useState("");

  const [packages, setPackages] = useState<any[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  const [repos, setRepos] = useState<any[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

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
          fetch(`${API_BASE_URL}/social/users/modelica/posts`),
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
    if (activeTab === "Packages") {
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

          const mockRepos = [
            {
              id: "mock1",
              provider: "github",
              namespace: "modelica",
              project: "Modelica-Standard-Library",
              description: "The official Modelica Standard Library",
              avatar_url: "",
            },
            {
              id: "mock2",
              provider: "gitlab",
              namespace: "modelscript",
              project: "compiler",
              description: "Salsa-powered Modelica compiler and simulation engine",
              avatar_url: "",
            },
            {
              id: "mock3",
              provider: "github",
              namespace: "modelscript",
              project: "web",
              description: "Frontend social workspace for ModelScript",
              avatar_url: "",
            },
            {
              id: "mock4",
              provider: "github",
              namespace: "modelica-association",
              project: "FMI-Standard",
              description: "Functional Mock-up Interface standard definitions",
              avatar_url: "",
            },
          ];

          const filteredMock = mockRepos.filter(
            (r) =>
              r.project.toLowerCase().includes(query.toLowerCase()) ||
              r.namespace.toLowerCase().includes(query.toLowerCase()) ||
              (r.description && r.description.toLowerCase().includes(query.toLowerCase())),
          );
          const filteredUser = userRepos.filter(
            (r: any) =>
              r.project.toLowerCase().includes(query.toLowerCase()) ||
              r.namespace.toLowerCase().includes(query.toLowerCase()) ||
              (r.description && r.description.toLowerCase().includes(query.toLowerCase())),
          );

          const seen = new Set();
          const combined = [...filteredUser, ...filteredMock].filter((r) => {
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

  const seenUsers = new Set();
  const matchedPeople: any[] = [];
  posts.forEach((p) => {
    if (!seenUsers.has(p.author_id)) {
      seenUsers.add(p.author_id);
      const nameMatch =
        p.username.toLowerCase().includes(query.toLowerCase()) ||
        (p.display_name && p.display_name.toLowerCase().includes(query.toLowerCase()));
      if (nameMatch) {
        matchedPeople.push({
          id: p.author_id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
        });
      }
    }
  });

  const artifactPosts = posts.filter(
    (p) => p.artifact_view_id !== null && p.content && p.content.toLowerCase().includes(query.toLowerCase()),
  );

  const TABS = ["Top", "Latest", "People", "Artifacts", "Packages", "Repositories"];

  if (topic) {
    return (
      <Box>
        <Header>
          <HeaderIconButton onClick={handleBack} aria-label="Back" style={{ marginRight: "16px" }}>
            <ArrowLeftIcon size={20} />
          </HeaderIconButton>
          <Box>
            <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
              Topic: {topic}
            </Heading>
            <Text color="var(--color-fg-muted)" fontSize="13px">
              {topicPosts.length} posts
            </Text>
          </Box>
        </Header>
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
              <Box p={6} textAlign="center" color="var(--color-fg-muted)">
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
          </SearchInputWrapper>
          <HeaderIconButton aria-label="More options">
            <KebabHorizontalIcon size={20} />
          </HeaderIconButton>
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
                  <Box p={6} textAlign="center" color="var(--color-fg-muted)">
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
                  <Box p={6} textAlign="center" color="var(--color-fg-muted)">
                    No posts matching "{query}" found.
                  </Box>
                )}
              </>
            )}

            {activeTab === "People" && (
              <>
                {matchedPeople.map((u) => (
                  <Box
                    key={u.id}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    p={3}
                    borderBottom="1px solid var(--color-border-subtle)"
                  >
                    <Link
                      to={`/${u.username}`}
                      style={{
                        textDecoration: "none",
                        color: "inherit",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
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
                          backgroundImage: u.avatar_url ? `url(${u.avatar_url})` : "none",
                          flexShrink: 0,
                        }}
                      >
                        {!u.avatar_url && u.username.charAt(0).toUpperCase()}
                      </Box>
                      <Box>
                        <Heading
                          as="h4"
                          style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-fg-default)" }}
                        >
                          {u.display_name || u.username}
                        </Heading>
                        <Text color="var(--color-fg-muted)" style={{ fontSize: "14px" }}>
                          @{u.username}
                        </Text>
                      </Box>
                    </Link>
                    <FollowButton username={u.username} initialIsFollowing={false} size="small" />
                  </Box>
                ))}
                {matchedPeople.length === 0 && (
                  <Box p={6} textAlign="center" color="var(--color-fg-muted)">
                    No users matching "{query}" found.
                  </Box>
                )}
              </>
            )}

            {activeTab === "Artifacts" && (
              <>
                {artifactPosts.map((post) => (
                  <Post key={post.id} post={post} />
                ))}
                {artifactPosts.length === 0 && (
                  <Box p={6} textAlign="center" color="var(--color-fg-muted)">
                    No posts with artifacts matching "{query}" found.
                  </Box>
                )}
              </>
            )}

            {activeTab === "Packages" && (
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
                        borderBottom="1px solid var(--color-border-subtle)"
                      >
                        <Link
                          to={`/packages/${pkg.name}`}
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
                              style={{
                                fontSize: "15px",
                                fontWeight: "bold",
                                margin: 0,
                                color: "var(--color-fg-default)",
                              }}
                            >
                              {pkg.name}
                            </Heading>
                            <Text color="var(--color-fg-muted)" style={{ fontSize: "14px", display: "block" }}>
                              @npm/{pkg.name} · v{pkg.latestVersion || "1.0.0"}
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
                              {pkg.description || "No description provided."}
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
                    {packages.length === 0 && (
                      <Box p={6} textAlign="center" color="var(--color-fg-muted)">
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
                              style={{
                                fontSize: "15px",
                                fontWeight: "bold",
                                margin: 0,
                                color: "var(--color-fg-default)",
                              }}
                            >
                              {r.project}
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
                    {repos.length === 0 && (
                      <Box p={6} textAlign="center" color="var(--color-fg-muted)">
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
      <Header>
        <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
          Explore
        </Heading>
      </Header>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {trending.length > 0 && (
            <Box p={3} borderBottom="1px solid var(--color-border-subtle)" bg="var(--color-canvas-subtle)">
              <Heading
                as="h3"
                style={{ fontSize: "16px", fontWeight: 800, marginBottom: "12px", color: "var(--color-fg-default)" }}
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
                      bg="var(--color-canvas-default)"
                      border="1px solid var(--color-border-default)"
                      borderRadius="8px"
                      p="12px 16px"
                      minWidth="140px"
                      sx={{
                        transition: "background-color 0.2s",
                        "&:hover": { backgroundColor: "var(--color-canvas-subtle)" },
                      }}
                    >
                      <Text
                        color="var(--color-fg-muted)"
                        sx={{ fontSize: "12px", display: "block", marginBottom: "4px" }}
                      >
                        {index + 1} · Trending
                      </Text>
                      <Text as="div" sx={{ fontWeight: "bold", fontSize: "15px", color: "var(--color-fg-default)" }}>
                        {t.display_name}
                      </Text>
                    </Box>
                  </Link>
                ))}
              </Box>
            </Box>
          )}

          <Box p={3} borderBottom="1px solid var(--color-border-subtle)">
            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 800, color: "var(--color-fg-default)" }}>
              Suggested Posts
            </Heading>
          </Box>

          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {posts.length === 0 && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              No trending posts right now.
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ExplorePage;
