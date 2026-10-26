// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 20;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: var(--surface-hud);
`;

export const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 53px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;
  outline: none;

  &:hover {
    background-color: var(--surface-row-hover);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent-cyan);
  }
`;

export const TabText = styled.div<{ $active?: boolean | undefined }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: var(--radius-pill);
    transform: ${(props) => (props.$active ? "scaleX(1)" : "scaleX(0.4)")};
    opacity: ${(props) => (props.$active ? 1 : 0)};
    transition:
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.2s ease;
  }
`;

export const SortMenu = styled.div`
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  box-shadow: var(--glow-card);
  padding: 12px 0;
  z-index: 100;

  button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;

    &:hover {
      background-color: var(--surface-row-hover);
    }
  }

  .menu-header {
    padding: 0 16px 8px 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

export const ComposePrompt = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: text;
`;

export const FilterSection = styled.div`
  background: var(--surface-hud, rgba(14, 20, 36, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--color-border);
  padding: 8px 16px;
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  z-index: 15;
`;

export const FilterChipsScroll = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const FilterChipButton = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  flex-shrink: 0;

  background: ${(props) =>
    props.$active
      ? "linear-gradient(135deg, rgba(6, 182, 212, 0.22) 0%, rgba(139, 92, 246, 0.3) 100%)"
      : "rgba(255, 255, 255, 0.04)"};
  border: 1px solid
    ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.08))")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-secondary)")};
  box-shadow: ${(props) => (props.$active ? "0 0 12px rgba(6, 182, 212, 0.35)" : "none")};

  &:hover {
    background: ${(props) =>
      props.$active
        ? "linear-gradient(135deg, rgba(6, 182, 212, 0.3) 0%, rgba(139, 92, 246, 0.4) 100%)"
        : "rgba(255, 255, 255, 0.08)"};
    border-color: ${(props) =>
      props.$active ? "var(--color-accent-cyan)" : "var(--color-border-default, rgba(255, 255, 255, 0.2))"};
    color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-primary)")};
    transform: translateY(-1px);
  }

  .chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-text-muted)")};
    transition: color 0.15s ease;
  }
`;

export const HashtagPill = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
  flex-shrink: 0;

  background: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.25)" : "rgba(255, 255, 255, 0.03)")};
  border: 1px solid
    ${(props) =>
      props.$active ? "var(--color-accent-purple)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.07))"};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-muted)")};
  box-shadow: ${(props) => (props.$active ? "0 0 10px rgba(139, 92, 246, 0.35)" : "none")};
  font-weight: ${(props) => (props.$active ? "600" : "400")};

  &:hover {
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.4);
    color: var(--color-accent-purple);
  }

  .post-count {
    font-size: 10px;
    opacity: 0.75;
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 4px;
    border-radius: 4px;
    margin-left: 2px;
  }
`;

export const ActiveFilterBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(6, 182, 212, 0.08);
  border-bottom: 1px solid rgba(6, 182, 212, 0.25);
  font-size: 12.5px;
  gap: 12px;
  flex-wrap: wrap;

  .filter-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-accent-cyan);
    font-weight: 500;
  }

  .filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid rgba(6, 182, 212, 0.35);
    padding: 2px 8px;
    border-radius: 12px;
    color: #ffffff;
    font-size: 11.5px;

    button {
      background: none;
      border: none;
      padding: 0;
      margin-left: 4px;
      display: inline-flex;
      align-items: center;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      &:hover {
        color: #ffffff;
      }
    }
  }

  .result-count {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .filter-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topic-hub-link {
    background: none;
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: var(--color-accent-purple);
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      background: rgba(139, 92, 246, 0.15);
      border-color: var(--color-accent-purple);
    }
  }

  .clear-all-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 11.5px;
    cursor: pointer;
    text-decoration: underline;
    &:hover {
      color: var(--color-text-primary);
    }
  }
`;

export const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 56px 24px;
  max-width: 440px;
  margin: 0 auto;
`;

export const EmptyStateIconOrb = styled.div`
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  background: var(--gradient-ai-subtle);
  border: 1px solid var(--color-accent-purple-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent-cyan);
  box-shadow: var(--glow-ai-sm);
  margin-bottom: 20px;
`;

export const EmptyStateTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-heading);
  margin: 0 0 8px 0;
  letter-spacing: -0.3px;
`;

export const EmptyStateSubtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0 0 24px 0;
`;

export const EmptyStateActions = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
`;

export const PrimaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(139, 92, 246, 0.35);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 0 20px rgba(6, 182, 212, 0.5);
    transform: translateY(-1px);
  }
`;

export const SecondaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-btn-secondary-bg);
  border: 1px solid var(--color-btn-secondary-border);
  color: var(--color-btn-secondary-text);
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover);
    border-color: rgba(255, 255, 255, 0.2);
  }
`;

export const QuickstartContainer = styled.div`
  margin: 16px 0 24px;
  padding: 20px;
  background: var(--surface-overlay, rgba(22, 27, 34, 0.5));
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
`;

export const HeroGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
`;

export const HeroCard = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.06));
    border-color: var(--color-accent-emphasis, #8b5cf6);
    transform: translateY(-1px);
  }
`;

export const DisciplineFollowsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  padding-top: 16px;
`;

export const DisciplineTabsRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

export const DisciplineTabButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-pill, 20px);
  font-size: 12.5px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  cursor: pointer;
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--color-accent-emphasis, #8b5cf6)"
        : "var(--color-border-default, rgba(255, 255, 255, 0.12))"};
  background: ${(props) =>
    props.$active ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))"};
  color: ${(props) =>
    props.$active ? "var(--color-accent-emphasis, #8b5cf6)" : "var(--color-text-secondary, #8b949e)"};
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-accent-emphasis, #8b5cf6);
    background: rgba(139, 92, 246, 0.1);
  }
`;

export const SuggestedFollowsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const SuggestedFollowCard = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 8px);
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.06));
    border-color: rgba(255, 255, 255, 0.16);
  }
`;
