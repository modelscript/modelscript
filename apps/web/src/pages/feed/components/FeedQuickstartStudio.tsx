// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, PlusIcon, RocketIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserSuggestions } from "../../../api";
import { useAuth } from "../../../AuthContext";
import { getAvatarUrl } from "../../../util/avatar";
import { DISCIPLINES } from "../constants";
import {
  DisciplineFollowsSection,
  DisciplineTabButton,
  DisciplineTabsRow,
  HeroCard,
  HeroGrid,
  QuickstartContainer,
  SuggestedFollowCard,
  SuggestedFollowsGrid,
} from "../styles";

export interface FeedQuickstartStudioProps {
  followedHandles: Record<string, boolean>;
  onToggleFollow: (handle: string) => void;
}

const PERSONA_TO_DISCIPLINE: Record<string, string> = {
  physical_systems: "electrical",
  systems_engineering: "aerospace",
  computational_cad: "robotics",
  scientific_research: "automotive",
};

const QUICKSTART_HERO_CARDS = [
  {
    id: "bouncing-ball",
    title: "Bouncing Ball",
    subtitle: "Hybrid physics & impact events",
    emoji: "⚽",
    personas: ["physical_systems", "scientific_research"],
  },
  {
    id: "rlc-circuit",
    title: "RLC Circuit",
    subtitle: "Resonant analog electronics",
    emoji: "⚡",
    personas: ["physical_systems", "systems_engineering"],
  },
  {
    id: "lorenz-attractor",
    title: "Lorenz Attractor",
    subtitle: "Nonlinear chaotic attractor",
    emoji: "🌀",
    personas: ["scientific_research", "physical_systems"],
  },
  {
    id: "sysml-satellite",
    title: "CubeSat Power Architecture",
    subtitle: "SysML v2 multi-domain architecture",
    emoji: "🔋",
    personas: ["systems_engineering", "computational_cad"],
  },
];

export const FeedQuickstartStudio: React.FC<FeedQuickstartStudioProps> = ({ followedHandles, onToggleFollow }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const initialDiscipline =
    (user?.engineering_persona && PERSONA_TO_DISCIPLINE[user.engineering_persona]) || "aerospace";
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>(initialDiscipline);
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);

  useEffect(() => {
    if (user?.engineering_persona && PERSONA_TO_DISCIPLINE[user.engineering_persona]) {
      setSelectedDiscipline(PERSONA_TO_DISCIPLINE[user.engineering_persona]!);
    }
  }, [user?.engineering_persona]);

  const orderedHeroCards = useMemo(() => {
    const persona = user?.engineering_persona;
    if (!persona) return QUICKSTART_HERO_CARDS;
    return [...QUICKSTART_HERO_CARDS].sort((a, b) => {
      const aMatch = a.personas.includes(persona) ? 0 : 1;
      const bMatch = b.personas.includes(persona) ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [user?.engineering_persona]);

  useEffect(() => {
    getUserSuggestions(6)
      .then((res) => {
        if (res?.suggestions) {
          setSuggestedUsers(res.suggestions);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <QuickstartContainer>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <RocketIcon size={20} fill="var(--color-accent-emphasis, #8b5cf6)" />
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-text-heading)" }}>
            Quickstart Cyber-Physical Studio
          </div>
          <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)" }}>
            Instant 1-click in-browser simulations to test Modelica DAE execution.
          </div>
        </div>
      </div>
      <HeroGrid>
        {orderedHeroCards.map((card) => (
          <HeroCard key={card.id} onClick={() => navigate(`/playground?model=${card.id}`)}>
            <div style={{ fontSize: "24px" }}>{card.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>{card.title}</div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--color-text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {card.subtitle}
              </div>
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>Run ↗</div>
          </HeroCard>
        ))}
      </HeroGrid>

      <DisciplineFollowsSection>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-heading)" }}>
              Engineering Disciplines &amp; Libraries
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Explore domain libraries and reference models across cyber-physical engineering sectors.
            </div>
          </div>
        </div>

        <DisciplineTabsRow>
          {DISCIPLINES.map((d) => (
            <DisciplineTabButton
              key={d.id}
              $active={selectedDiscipline === d.id}
              onClick={() => setSelectedDiscipline(d.id)}
            >
              <span>{d.emoji}</span>
              <span>{d.name}</span>
            </DisciplineTabButton>
          ))}
        </DisciplineTabsRow>

        <SuggestedFollowsGrid>
          {(DISCIPLINES.find((d) => d.id === selectedDiscipline)?.items || []).map((item) => (
            <SuggestedFollowCard key={item.id}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.05))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    border: "1px solid var(--color-border-muted)",
                    flexShrink: 0,
                  }}
                >
                  {item.avatar}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "var(--color-text-heading)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.name}
                    </span>
                    {item.isPackage && (
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          background: "rgba(139, 92, 246, 0.15)",
                          color: "var(--color-accent-emphasis, #8b5cf6)",
                          fontWeight: 600,
                        }}
                      >
                        PKG
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    #{item.handle} • {item.description}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => navigate(item.exploreUrl)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s ease",
                    background: "var(--color-accent-emphasis, #8b5cf6)",
                    color: "#ffffff",
                    border: "none",
                  }}
                >
                  <span>Explore ↗</span>
                </button>
              </div>
            </SuggestedFollowCard>
          ))}
        </SuggestedFollowsGrid>

        {suggestedUsers.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-text-heading)", marginBottom: "8px" }}>
              Suggested Engineers to Follow
            </div>
            <SuggestedFollowsGrid>
              {suggestedUsers.map((u) => (
                <SuggestedFollowCard key={u.username}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flex: 1,
                      minWidth: 0,
                      cursor: "pointer",
                    }}
                    onClick={() => navigate(`/${u.username}`)}
                  >
                    <img
                      src={getAvatarUrl(u.username, u.avatar_url)}
                      alt={u.username}
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "13px",
                          color: "var(--color-text-heading)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {u.display_name || u.username}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        @{u.username}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFollow(u.username)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      background: followedHandles[u.username]
                        ? "var(--color-canvas-subtle, rgba(255, 255, 255, 0.08))"
                        : "var(--color-accent-emphasis, #8b5cf6)",
                      color: followedHandles[u.username] ? "var(--color-text-primary, #ffffff)" : "#ffffff",
                      border: followedHandles[u.username]
                        ? "1px solid var(--color-border-default, rgba(255, 255, 255, 0.2))"
                        : "none",
                    }}
                  >
                    {followedHandles[u.username] ? (
                      <>
                        <CheckIcon size={12} />
                        <span>Following</span>
                      </>
                    ) : (
                      <>
                        <PlusIcon size={12} />
                        <span>Follow</span>
                      </>
                    )}
                  </button>
                </SuggestedFollowCard>
              ))}
            </SuggestedFollowsGrid>
          </div>
        )}
      </DisciplineFollowsSection>
    </QuickstartContainer>
  );
};

export default FeedQuickstartStudio;
