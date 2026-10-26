// SPDX-License-Identifier: AGPL-3.0-or-later

import { CpuIcon, HubotIcon, ZapIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import React from "react";
import { BotAgentBadge, BotHeaderRow, BotIdentity, BotStatusText, BotTypingContainer } from "../styles";

export interface BotTypingBubbleProps {
  botUsername: string;
  status: "thinking" | "simulating";
}

export const BotTypingBubble: React.FC<BotTypingBubbleProps> = ({ botUsername, status }) => (
  <BotTypingContainer>
    <BotHeaderRow>
      <BotIdentity>
        <div className="bot-avatar">
          <HubotIcon size={18} />
        </div>
        <span className="bot-name">@{botUsername}</span>
        <BotAgentBadge>🤖 AI Agent</BotAgentBadge>
      </BotIdentity>
      <Spinner size="small" />
    </BotHeaderRow>
    <BotStatusText>
      {status === "simulating" ? (
        <>
          <ZapIcon size={14} fill="var(--color-accent-cyan)" />
          <span>
            Running <span className="status-highlight">DAE Numerical Solver (CVODE)</span> &amp; synthesizing trajectory
            plot...
          </span>
        </>
      ) : (
        <>
          <CpuIcon size={14} />
          <span>
            Analyzing equations and generating <span className="status-highlight">Modelica engineering response</span>
            ...
          </span>
        </>
      )}
    </BotStatusText>
    <div className="shimmer-bar" />
  </BotTypingContainer>
);

export default BotTypingBubble;
