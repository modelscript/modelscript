// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { KebabHorizontalIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../Box";
import { useToast } from "../../ToastContext";
import { Card, KebabButton, ShowMoreLink, TrendingItem } from "../styles";

export interface TrendingTopicsCardProps {
  trending: any[];
  activeTrendMenu: number | null;
  setActiveTrendMenu: (id: number | null) => void;
}

export const TrendingTopicsCard: React.FC<TrendingTopicsCardProps> = ({
  trending,
  activeTrendMenu,
  setActiveTrendMenu,
}) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [dismissedIds, setDismissedIds] = useState<Set<number | string>>(new Set());

  const visibleTrending = trending.filter((t) => !dismissedIds.has(t.id ?? t.concept));

  return (
    <Card>
      <Heading
        as="h2"
        style={{
          fontSize: "12px",
          fontWeight: 700,
          marginBottom: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--color-text-muted)",
        }}
      >
        Trending Models & Topics
      </Heading>
      <Box display="flex" flexDirection="column">
        {visibleTrending.length > 0 ? (
          visibleTrending.map((topic) => (
            <TrendingItem key={topic.id ?? topic.concept}>
              <Box flex={1} onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "2px" }}>
                  {topic.location ? `Trending in ${topic.location}` : "Trending"}
                </div>
                <Text as="div" style={{ fontWeight: "bold", fontSize: "14px", color: "var(--color-text-primary)" }}>
                  {topic.display_name}
                </Text>
              </Box>
              <Box position="relative">
                <KebabButton
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActiveTrendMenu(activeTrendMenu === topic.id ? null : topic.id);
                  }}
                >
                  <KebabHorizontalIcon size={16} />
                </KebabButton>
                {activeTrendMenu === topic.id && (
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
                            setDismissedIds((prev) => new Set(prev).add(topic.id ?? topic.concept));
                            setActiveTrendMenu(null);
                            toast.info("Thanks for your feedback — trend hidden.");
                          }}
                          style={{
                            padding: "10px 12px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: "bold",
                            color: "var(--color-text-primary)",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-row-hover)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <span style={{ fontSize: "16px", color: "var(--color-text-muted)", lineHeight: 1 }}>☹️</span>
                          {label}
                        </button>
                      ))}
                    </Box>
                  </>
                )}
              </Box>
            </TrendingItem>
          ))
        ) : (
          <Box display="flex" flexDirection="column" gap={1} py={1}>
            {[
              { concept: "modelica", tag: "#Modelica 3.4", category: "Physical Systems" },
              { concept: "cfd", tag: "#CFD Aerodynamics", category: "Finite Volume" },
              { concept: "cvode", tag: "#SUNDIALS CVODE", category: "Stiff DAE Integrators" },
              { concept: "fmu", tag: "#FMI 3.0 Standard", category: "Co-Simulation" },
            ].map((topic, i) => (
              <Box
                key={i}
                onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}
                style={{
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  transition: "background-color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-row-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{topic.category}</div>
                <Text style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary)" }}>
                  {topic.tag}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <ShowMoreLink to="/explore">Explore all models →</ShowMoreLink>
      </Box>
    </Card>
  );
};
