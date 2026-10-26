// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronLeftIcon, ChevronRightIcon, CodeIcon, RocketIcon, TagIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../components/Box";
import Post from "../../components/Post";
import type { PostData, TopicData } from "./constants";
import { CURATED_ENGINEERING_DOMAINS, STARTER_TEMPLATES } from "./constants";
import { MobileSearchWrapper } from "./styles";

export interface ExploreLandingViewProps {
  loading: boolean;
  posts: PostData[];
  trending: TopicData[];
  scrollTemplates: (direction: "left" | "right") => void;
  templatesScrollRef: React.RefObject<HTMLDivElement | null>;
}

export const ExploreLandingView: React.FC<ExploreLandingViewProps> = ({
  loading,
  posts,
  trending,
  scrollTemplates,
  templatesScrollRef,
}) => {
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
                    Continuous &amp; discrete hybrid events with restitution and zero-crossing detection.
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
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "8px",
                          background: "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--color-accent-cyan)",
                        }}
                      >
                        <dom.icon size={16} />
                      </div>
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
                    key={(t as any).id || t.name}
                    to={`/explore?topic=${encodeURIComponent((t as any).concept || t.name)}`}
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
                        {(t as any).display_name || t.name}
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
