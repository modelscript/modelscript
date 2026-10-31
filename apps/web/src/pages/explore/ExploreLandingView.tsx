// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronLeftIcon, ChevronRightIcon, CodeIcon, RocketIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Spinner } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../components/Box";
import Post from "../../components/Post";
import type { PostData, TopicData } from "./constants";
import { CURATED_ENGINEERING_DOMAINS, STARTER_TEMPLATES } from "./constants";
import { MobileSearchWrapper, SearchInputWrapper } from "./styles";

export interface ExploreLandingViewProps {
  loading: boolean;
  posts: PostData[];
  trending: TopicData[];
  scrollTemplates: (direction: "left" | "right") => void;
  templatesScrollRef: React.RefObject<HTMLDivElement | null>;
  localQuery?: string;
  setLocalQuery?: (value: string) => void;
  handleSearchSubmit?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const ExploreLandingView: React.FC<ExploreLandingViewProps> = ({
  loading,
  posts,
  trending,
  scrollTemplates,
  templatesScrollRef,
  localQuery = "",
  setLocalQuery,
  handleSearchSubmit,
}) => {
  return (
    <Box>
      <MobileSearchWrapper>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
          </SearchInputWrapper>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
            title="Ask AI Copilot or open command palette (⌘K)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              borderRadius: "9999px",
              background: "var(--color-search-bg, rgba(255, 255, 255, 0.04))",
              border: "1px solid var(--color-search-border, var(--color-border-glass))",
              color: "var(--color-text-muted)",
              fontSize: "12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--color-accent-purple)", fontSize: "13px" }}>⚡</span>
            <span>AI Copilot</span>
            <kbd
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid var(--color-border-glass)",
                borderRadius: "4px",
                padding: "1px 5px",
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
              }}
            >
              ⌘K
            </kbd>
          </button>
        </div>
      </MobileSearchWrapper>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
          {/* Compact Starter Engineering Workspaces Strip */}
          <Box
            px={3}
            py="12px"
            borderBottom="1px solid var(--color-border)"
            style={{
              background: "var(--surface-hud, rgba(14, 20, 36, 0.4))",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb="10px">
              <Heading
                as="h3"
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--color-text-heading)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  margin: 0,
                }}
              >
                <RocketIcon size={15} /> Engineering Workspaces
              </Heading>
              <Box display="flex" alignItems="center" gap="8px">
                <Link
                  to="/ide"
                  style={{
                    fontSize: "12px",
                    color: "var(--color-accent-cyan)",
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CodeIcon size={13} /> Blank Workspace
                </Link>
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
                      width: "24px",
                      height: "24px",
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
                    <ChevronLeftIcon size={14} />
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
                      width: "24px",
                      height: "24px",
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
                    <ChevronRightIcon size={14} />
                  </button>
                </Box>
              </Box>
            </Box>

            <Box
              ref={templatesScrollRef}
              display="flex"
              gap="10px"
              overflowX="auto"
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                paddingBottom: "2px",
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "none",
              }}
            >
              {/* Blank Project Workspace Card */}
              <Link
                key="blank-project-carousel"
                to="/ide"
                style={{ textDecoration: "none", flexShrink: 0, scrollSnapAlign: "start" }}
              >
                <Box
                  bg="var(--color-bg-card)"
                  borderRadius="10px"
                  p="10px 12px"
                  minWidth="200px"
                  maxWidth="215px"
                  display="flex"
                  flexDirection="column"
                  justifyContent="space-between"
                  style={{
                    height: "100%",
                    boxSizing: "border-box",
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--ms-border)",
                  }}
                  sx={{
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    "&:hover": {
                      borderColor: "var(--ms-brand)",
                      transform: "translateY(-1px)",
                      boxShadow: "var(--glow-card)",
                    },
                  }}
                >
                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <span style={{ fontSize: "16px" }}>📁</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "var(--font-mono)",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          backgroundColor: "var(--ms-brand-soft)",
                          color: "var(--ms-brand)",
                          border: "1px solid color-mix(in srgb, var(--ms-brand) 35%, transparent)",
                          fontWeight: 600,
                        }}
                      >
                        Clean Slate
                      </span>
                    </Box>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "13px",
                        color: "var(--color-text-heading)",
                        marginBottom: "2px",
                      }}
                    >
                      Blank Project
                    </div>
                    <div
                      style={{
                        fontSize: "11.5px",
                        color: "var(--color-text-muted)",
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      Start fresh with Modelica, SysML v2, or 3D CAD modeling.
                    </div>
                  </Box>
                </Box>
              </Link>

              {STARTER_TEMPLATES.map((tpl) => (
                <Link
                  key={`${tpl.id}-carousel`}
                  to={`/ide/${tpl.id}`}
                  style={{ textDecoration: "none", flexShrink: 0, scrollSnapAlign: "start" }}
                >
                  <Box
                    bg="var(--color-bg-card)"
                    borderRadius="10px"
                    p="10px 12px"
                    minWidth="200px"
                    maxWidth="215px"
                    display="flex"
                    flexDirection="column"
                    justifyContent="space-between"
                    style={{
                      height: "100%",
                      boxSizing: "border-box",
                      background: "var(--color-bg-card)",
                      border: "1px solid var(--ms-border)",
                    }}
                    sx={{
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                      "&:hover": {
                        borderColor: "var(--ms-brand)",
                        transform: "translateY(-1px)",
                        boxShadow: "var(--glow-card)",
                      },
                    }}
                  >
                    <Box>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <span style={{ fontSize: "16px" }}>{tpl.icon}</span>
                        <span
                          style={{
                            fontSize: "10px",
                            fontFamily: "var(--font-mono)",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            backgroundColor: "color-mix(in srgb, var(--hue-indigo) 12%, transparent)",
                            color: "var(--hue-indigo)",
                            border: "1px solid color-mix(in srgb, var(--hue-indigo) 35%, transparent)",
                            fontWeight: 600,
                          }}
                        >
                          {tpl.badge}
                        </span>
                      </Box>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "13px",
                          color: "var(--color-text-heading)",
                          marginBottom: "2px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {tpl.title}
                      </div>
                      <div
                        style={{
                          fontSize: "11.5px",
                          color: "var(--color-text-muted)",
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {tpl.description}
                      </div>
                    </Box>
                  </Box>
                </Link>
              ))}
            </Box>
          </Box>

          {/* Trending Topics Strip when available */}
          {trending && trending.length > 0 && (
            <Box
              px={3}
              py="8px"
              borderBottom="1px solid var(--color-border)"
              display="flex"
              alignItems="center"
              gap="8px"
              style={{ overflow: "hidden" }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--color-text-muted)",
                  flexShrink: 0,
                }}
              >
                Trending:
              </span>
              <Box
                display="flex"
                alignItems="center"
                gap="6px"
                sx={{
                  overflowX: "auto",
                  "&::-webkit-scrollbar": { display: "none" },
                  scrollbarWidth: "none",
                }}
              >
                {trending.map((topicItem, idx) => {
                  const rawTag = String(topicItem.tag || topicItem.concept || topicItem.name || "").replace(/^#/, "");
                  if (!rawTag) return null;
                  const count =
                    topicItem.postsCount ??
                    (topicItem.post_count as number | undefined) ??
                    (topicItem.count as number | undefined);
                  return (
                    <Link
                      key={topicItem.id || `${rawTag}-${idx}`}
                      to={`/explore?topic=${encodeURIComponent(rawTag)}`}
                      style={{
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        padding: "3px 8px",
                        borderRadius: "9999px",
                        backgroundColor: "rgba(6, 182, 212, 0.1)",
                        color: "var(--color-accent-cyan)",
                        border: "1px solid rgba(6, 182, 212, 0.25)",
                        fontWeight: 600,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      #{rawTag}
                      {typeof count === "number" && count > 0 ? ` (${count})` : ""}
                    </Link>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Feed Header with Inline Quick-Topic Pills */}
          <Box
            px={3}
            py="10px"
            borderBottom="1px solid var(--color-border)"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            gap={2}
            style={{ overflow: "hidden" }}
          >
            <Heading
              as="h3"
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "var(--color-text-heading)",
                margin: 0,
                flexShrink: 0,
              }}
            >
              Suggested Posts
            </Heading>
            <Box
              display="flex"
              alignItems="center"
              gap="6px"
              sx={{
                overflowX: "auto",
                "&::-webkit-scrollbar": { display: "none" },
                scrollbarWidth: "none",
              }}
            >
              {CURATED_ENGINEERING_DOMAINS.slice(0, 5).map((dom) => (
                <Link
                  key={dom.tag}
                  to={`/explore?topic=${encodeURIComponent(dom.tag)}`}
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    padding: "3px 8px",
                    borderRadius: "9999px",
                    backgroundColor: "rgba(139, 92, 246, 0.1)",
                    color: "var(--color-accent-purple)",
                    border: "1px solid rgba(139, 92, 246, 0.25)",
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  #{dom.tag}
                </Link>
              ))}
            </Box>
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
