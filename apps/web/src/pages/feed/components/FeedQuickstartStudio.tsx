// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, PlusIcon, RocketIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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

export const FeedQuickstartStudio: React.FC<FeedQuickstartStudioProps> = ({ followedHandles, onToggleFollow }) => {
  const navigate = useNavigate();
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>("aerospace");

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
        <HeroCard onClick={() => navigate("/playground?model=bouncing-ball")}>
          <div style={{ fontSize: "24px" }}>⚽</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>Bouncing Ball</div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Hybrid physics &amp; impact events
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>Run ↗</div>
        </HeroCard>
        <HeroCard onClick={() => navigate("/playground?model=rlc-filter")}>
          <div style={{ fontSize: "24px" }}>⚡</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>RLC Filter</div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Resonant analog electronics
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>Run ↗</div>
        </HeroCard>
        <HeroCard onClick={() => navigate("/playground?model=chua-circuit")}>
          <div style={{ fontSize: "24px" }}>🌀</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>Chua Circuit</div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Nonlinear chaotic attractor
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>Run ↗</div>
        </HeroCard>
        <HeroCard onClick={() => navigate("/playground?model=sysml2-powertrain")}>
          <div style={{ fontSize: "24px" }}>🔋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>EV Powertrain</div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              SysML v2 multi-domain architecture
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>Run ↗</div>
        </HeroCard>
      </HeroGrid>

      <DisciplineFollowsSection>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-heading)" }}>
              Engineering Disciplines &amp; Suggested Follows
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Follow domain specialists and packages across key cyber-physical engineering sectors.
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
                    @{item.handle} • {item.description}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => onToggleFollow(item.handle)}
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
                    background: followedHandles[item.handle]
                      ? "var(--color-canvas-subtle, rgba(255, 255, 255, 0.08))"
                      : "var(--color-accent-emphasis, #8b5cf6)",
                    color: followedHandles[item.handle] ? "var(--color-text-primary, #ffffff)" : "#ffffff",
                    border: followedHandles[item.handle]
                      ? "1px solid var(--color-border-default, rgba(255, 255, 255, 0.2))"
                      : "none",
                  }}
                >
                  {followedHandles[item.handle] ? (
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
                <button
                  type="button"
                  onClick={() => navigate(item.exploreUrl)}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    background: "none",
                    border: "1px solid var(--color-border-muted, rgba(255, 255, 255, 0.12))",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                  title="Explore library"
                >
                  ↗
                </button>
              </div>
            </SuggestedFollowCard>
          ))}
        </SuggestedFollowsGrid>
      </DisciplineFollowsSection>
    </QuickstartContainer>
  );
};

export default FeedQuickstartStudio;
