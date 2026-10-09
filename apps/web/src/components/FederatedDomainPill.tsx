// SPDX-License-Identifier: AGPL-3.0-or-later

import { GlobeIcon } from "@primer/octicons-react";
import React from "react";
import styled from "styled-components";

const PillContainer = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 9999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-accent-cyan, #06b6d4);
  background: rgba(6, 182, 212, 0.08);
  border: 1px solid rgba(6, 182, 212, 0.22);
  text-decoration: none;
  cursor: pointer;
  vertical-align: middle;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(6, 182, 212, 0.16);
    border-color: rgba(6, 182, 212, 0.4);
    color: var(--color-accent-cyan, #06b6d4);
    text-decoration: none;
    transform: translateY(-0.5px);
  }

  & svg {
    flex-shrink: 0;
  }
`;

interface FederatedDomainPillProps {
  domain: string;
  className?: string;
  style?: React.CSSProperties;
  linkToDomain?: boolean;
}

export const FederatedDomainPill: React.FC<FederatedDomainPillProps> = ({
  domain,
  className,
  style,
  linkToDomain = true,
}) => {
  if (!domain) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkToDomain) {
      window.open(`https://${domain}`, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <PillContainer
      className={className}
      style={style}
      title={`Federated ActivityPub instance: ${domain}`}
      onClick={handleClick}
      role="link"
    >
      <GlobeIcon size={12} />
      <span>{domain}</span>
    </PillContainer>
  );
};

export default FederatedDomainPill;
