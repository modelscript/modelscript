// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const ReplyInputContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 16px 12px 16px;
  border-bottom: 1px solid var(--color-border);
`;

export const BotTypingContainer = styled.div`
  margin: 12px 16px;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--color-bg-card, rgba(15, 23, 42, 0.7));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(139, 92, 246, 0.35);
  box-shadow:
    0 0 20px rgba(139, 92, 246, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  overflow: hidden;
  animation: botFadeIn 0.25s ease-out;

  @keyframes botFadeIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .shimmer-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, transparent, #8b5cf6, #06b6d4, transparent);
    background-size: 200% 100%;
    animation: botShimmer 1.8s infinite linear;
  }

  @keyframes botShimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }
`;

export const BotHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

export const BotIdentity = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  .bot-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(6, 182, 212, 0.25));
    border: 1px solid rgba(139, 92, 246, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-accent-purple, #a78bfa);
    box-shadow: 0 0 8px rgba(139, 92, 246, 0.3);
  }

  .bot-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--color-text-heading);
  }
`;

export const BotAgentBadge = styled.span`
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--gradient-ai-subtle, rgba(139, 92, 246, 0.15));
  border: 1px solid var(--color-accent-purple-border, rgba(139, 92, 246, 0.35));
  color: var(--color-accent-purple, #a78bfa);
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

export const BotStatusText = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
  font-family: var(--font-sans);

  .status-highlight {
    color: var(--color-accent-cyan, #38bdf8);
    font-weight: 500;
  }
`;

export const SplitContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.95fr);
  gap: 24px;
  padding: 16px 20px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

export const SimulationDockPane = styled.div`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 70px;
  height: fit-content;
  box-shadow: var(--glow-card);
  color: var(--color-text-primary);
`;

export const DockTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent-cyan);
`;

export const ParamSliderRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;

  .label-val {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-primary);
    font-weight: 500;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--color-accent-purple);
    cursor: pointer;
  }
`;

export const TelemetryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
`;

export const TelemetryCard = styled.div`
  background: var(--color-bg-surface, rgba(14, 20, 36, 0.8));
  border: 1px solid var(--color-border-glass, var(--color-border));
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-mono);

  .label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .val {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-heading);

    small {
      font-size: 10px;
      font-weight: 400;
      color: var(--color-text-muted);
    }
  }

  .sub {
    font-size: 10px;
    color: var(--color-accent-cyan);
  }
`;

export const ConvergencePlotBox = styled.div`
  background: #020408;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  cursor: crosshair;
`;

export const ActionDockBtn = styled.button<{ $primary?: boolean | undefined }>`
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  border: ${(props) => (props.$primary ? "none" : "1px solid var(--color-border-default, var(--color-border))")};
  background: ${(props) =>
    props.$primary ? "var(--gradient-cta)" : "var(--color-btn-secondary-bg, rgba(255, 255, 255, 0.06))"};
  color: ${(props) => (props.$primary ? "#ffffff" : "var(--color-text-primary)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
  box-shadow: ${(props) => (props.$primary ? "0 2px 8px rgba(139, 92, 246, 0.25)" : "none")};

  &:hover:not(:disabled) {
    box-shadow: 0 0 14px rgba(139, 92, 246, 0.4);
    transform: translateY(-1px);
    background: ${(props) =>
      props.$primary ? "var(--gradient-cta)" : "var(--color-bg-card-hover, rgba(125, 125, 125, 0.1))"};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
