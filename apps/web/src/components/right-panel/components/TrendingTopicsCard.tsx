// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeClosedIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Box from "../../Box";
import { useToast } from "../../ToastContext";
import { Card, KebabButton, ShowMoreLink, TrendingItem } from "../styles";

export interface TrendingTopicsCardProps {
  trending: any[];
  activeTrendMenu: number | null;
  setActiveTrendMenu: (id: number | null) => void;
}

const DISMISSED_TRENDS_STORAGE_KEY = "modelscript:dismissed_trends";

const FALLBACK_TOPICS = [
  { concept: "modelica", tag: "#Modelica 3.4", category: "Physical Systems" },
  { concept: "cfd", tag: "#CFD Aerodynamics", category: "Finite Volume" },
  { concept: "cvode", tag: "#SUNDIALS CVODE", category: "Stiff DAE Integrators" },
  { concept: "fmu", tag: "#FMI 3.0 Standard", category: "Co-Simulation" },
];

export const TrendingTopicsCard: React.FC<TrendingTopicsCardProps> = ({
  trending,
  activeTrendMenu,
  setActiveTrendMenu,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isExplore = location.pathname.startsWith("/explore");
  const toast = useToast();
  const [dismissedIds, setDismissedIds] = useState<Set<number | string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_TRENDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {
      // ignore storage errors
    }
    return new Set();
  });

  const handleDismissTopic = (topicKey: number | string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(topicKey);
      try {
        localStorage.setItem(DISMISSED_TRENDS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const visibleTrending = trending.filter((t) => !dismissedIds.has(t.id ?? t.concept) && !dismissedIds.has(t.concept));
  const visibleFallbacks = FALLBACK_TOPICS.filter((t) => !dismissedIds.has(t.concept));

  return (
    <Card>
      <Heading
        as="h2"
        style={{
          fontSize: "15px",
          lineHeight: "20px",
          fontWeight: 700,
          marginBottom: "10px",
          color: "var(--color-text-heading)",
        }}
      >
        Trending Models & Topics
      </Heading>
      <Box display="flex" flexDirection="column">
        {visibleTrending.length > 0 ? (
          visibleTrending.map((topic) => {
            const topicKey = topic.id ?? topic.concept;
            return (
              <TrendingItem key={topicKey}>
                <Box flex={1} onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}>
                  <div
                    style={{
                      fontSize: "11.5px",
                      lineHeight: "15px",
                      color: "var(--color-text-muted)",
                      marginBottom: "1px",
                    }}
                  >
                    {topic.location ? `Trending in ${topic.location}` : "Trending"}
                  </div>
                  <Text
                    as="div"
                    style={{
                      fontWeight: 600,
                      fontSize: "13px",
                      lineHeight: "18px",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {topic.display_name}
                  </Text>
                  {topic.post_count ? (
                    <div
                      style={{
                        fontSize: "11.5px",
                        lineHeight: "15px",
                        color: "var(--color-text-muted)",
                        marginTop: "1px",
                      }}
                    >
                      {`${topic.post_count} posts`}
                    </div>
                  ) : null}
                </Box>
                <Box position="relative">
                  <KebabButton
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setActiveTrendMenu(activeTrendMenu === topicKey ? null : topicKey);
                    }}
                  >
                    <KebabHorizontalIcon size={16} />
                  </KebabButton>
                  {activeTrendMenu === topicKey && (
                    <>
                      <div
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setActiveTrendMenu(null);
                        }}
                      />
                      <Box
                        position="absolute"
                        top="100%"
                        right="0"
                        bg="var(--color-bg-primary)"
                        border="1px solid var(--color-border)"
                        borderRadius="12px"
                        boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                        p={2}
                        zIndex={100}
                        minWidth="280px"
                        display="flex"
                        flexDirection="column"
                        gap={1}
                      >
                        {[
                          "Not interested in this",
                          "The associated content is not relevant",
                          "This trend is a duplicate",
                          "This trend is abusive or harmful",
                          "This trend is spam",
                        ].map((label, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDismissTopic(topicKey);
                              if (topic.concept) handleDismissTopic(topic.concept);
                              setActiveTrendMenu(null);
                              toast.info("Thanks for your feedback — trend hidden.");
                            }}
                            style={{
                              padding: "8px 10px",
                              background: "none",
                              border: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: "13px",
                              lineHeight: "18px",
                              fontWeight: 600,
                              color: "var(--color-text-primary)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-row-hover)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                color: "var(--color-text-muted)",
                                lineHeight: 1,
                              }}
                            >
                              <EyeClosedIcon size={14} />
                            </span>
                            {label}
                          </button>
                        ))}
                      </Box>
                    </>
                  )}
                </Box>
              </TrendingItem>
            );
          })
        ) : trending.length === 0 && visibleFallbacks.length > 0 ? (
          <Box display="flex" flexDirection="column">
            {visibleFallbacks.map((topic, i) => (
              <TrendingItem key={i} onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}>
                <Box flex={1}>
                  <div
                    style={{
                      fontSize: "11.5px",
                      lineHeight: "15px",
                      color: "var(--color-text-muted)",
                      marginBottom: "1px",
                    }}
                  >
                    {topic.category}
                  </div>
                  <Text
                    as="div"
                    style={{
                      fontWeight: 600,
                      fontSize: "13px",
                      lineHeight: "18px",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {topic.tag}
                  </Text>
                </Box>
              </TrendingItem>
            ))}
          </Box>
        ) : (
          <Box py={2} px={1}>
            <Text style={{ fontSize: "12.5px", lineHeight: "16px", color: "var(--color-text-muted)" }}>
              No additional trending topics right now.
            </Text>
          </Box>
        )}

        {!isExplore && <ShowMoreLink to="/explore">Explore all models →</ShowMoreLink>}
      </Box>
    </Card>
  );
};
