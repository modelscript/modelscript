// SPDX-License-Identifier: AGPL-3.0-or-later

import { EyeClosedIcon, HashIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { updateUserTopic } from "../../../api";
import { useClickOutside } from "../../../hooks/useClickOutside";
import { CURATED_ENGINEERING_DOMAINS } from "../../../pages/explore/constants";
import Box from "../../Box";
import { useToast } from "../../ToastContext";
import {
  Card,
  CardHeader,
  CardTitle,
  KebabButton,
  PanelBadge,
  PanelIconBox,
  PanelList,
  ShowMoreLink,
  TrendingItem,
} from "../styles";

export interface TrendingTopicsCardProps {
  trending: any[];
  activeTrendMenu: number | null;
  setActiveTrendMenu: (id: number | null) => void;
}

const DISMISSED_TRENDS_STORAGE_KEY = "modelscript:dismissed_trends";

const DOMAIN_META_BY_TAG = new Map(CURATED_ENGINEERING_DOMAINS.map((dom) => [dom.tag.toLowerCase(), dom]));

export const TrendingTopicsCard: React.FC<TrendingTopicsCardProps> = ({
  trending,
  activeTrendMenu,
  setActiveTrendMenu,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isExplore = location.pathname.startsWith("/explore");
  const activeTopic = (searchParams.get("topic") || searchParams.get("tag") || "").replace(/^#/, "").toLowerCase();
  const toast = useToast();
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuContainerRef, () => setActiveTrendMenu(null), activeTrendMenu !== null);
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

  const handleDismissTopic = (topicKey: number | string, concept?: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(topicKey);
      if (concept) next.add(concept);
      try {
        localStorage.setItem(DISMISSED_TRENDS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    const cleanConcept = String(concept || (typeof topicKey === "string" ? topicKey : ""))
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (cleanConcept) {
      updateUserTopic(cleanConcept, false).catch(() => {});
    }
  };

  const activeTrending = trending.filter((t) => Number(t.post_count ?? t.postsCount ?? 0) > 0);
  const visibleTrending = activeTrending.filter(
    (t) => !dismissedIds.has(t.id ?? t.concept) && !dismissedIds.has(t.concept),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topics</CardTitle>
      </CardHeader>
      <PanelList>
        {visibleTrending.length > 0 ? (
          visibleTrending.map((topic) => {
            const topicKey = topic.id ?? topic.concept;
            const postCount = Number(topic.post_count ?? topic.postsCount ?? 0);
            const targetTopic = String(topic.display_name || topic.concept || "").replace(/^#/, "");
            const domainMeta = DOMAIN_META_BY_TAG.get(targetTopic.toLowerCase());
            const IconComp = domainMeta?.icon ?? HashIcon;
            const isActive = isExplore && activeTopic === targetTopic.toLowerCase();

            return (
              <TrendingItem
                key={topicKey}
                $active={isActive}
                onClick={() => navigate(`/explore?topic=${encodeURIComponent(targetTopic)}`)}
              >
                <Box flex={1} minWidth={0} display="flex" alignItems="center" gap="8px">
                  <PanelIconBox>
                    <IconComp size={13} />
                  </PanelIconBox>
                  <Box flex={1} minWidth={0}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                      <Text
                        as="span"
                        style={{
                          fontWeight: 600,
                          fontSize: "13px",
                          lineHeight: "18px",
                          color: "var(--color-text-heading)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {domainMeta?.name || `#${targetTopic}`}
                      </Text>
                      <PanelBadge>{`${postCount} ${postCount === 1 ? "post" : "posts"}`}</PanelBadge>
                    </Box>
                  </Box>
                </Box>
                <Box
                  ref={activeTrendMenu === topicKey ? menuContainerRef : undefined}
                  position="relative"
                  style={{ flexShrink: 0 }}
                >
                  <KebabButton
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setActiveTrendMenu(activeTrendMenu === topicKey ? null : topicKey);
                    }}
                  >
                    <KebabHorizontalIcon size={15} />
                  </KebabButton>
                  {activeTrendMenu === topicKey && (
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
                            handleDismissTopic(topicKey, topic.concept || targetTopic);
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
                  )}
                </Box>
              </TrendingItem>
            );
          })
        ) : (
          <Box py={2} px={1}>
            <Text style={{ fontSize: "12.5px", lineHeight: "16px", color: "var(--color-text-muted)" }}>
              {activeTrending.length === 0
                ? "No trending topics right now."
                : "No additional trending topics right now."}
            </Text>
          </Box>
        )}

        {!isExplore && <ShowMoreLink to="/explore">Explore all topics →</ShowMoreLink>}
      </PanelList>
    </Card>
  );
};
