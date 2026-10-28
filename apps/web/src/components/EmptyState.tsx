// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";

/**
 * Shared empty / zero-data state. Use for "no results", "nothing here yet",
 * and sign-in prompts so every page looks the same.
 */

const Wrap = styled.div<{ $compact?: boolean | undefined }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: ${(p) => (p.$compact ? "32px 24px" : "64px 24px")};
  max-width: 440px;
  margin: 0 auto;
`;

const IconTile = styled.div`
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  color: var(--ms-brand);
  background: linear-gradient(
    140deg,
    color-mix(in srgb, var(--ms-brand) 16%, transparent),
    color-mix(in srgb, var(--ms-accent-indigo) 10%, transparent)
  );
  border: 1px solid color-mix(in srgb, var(--ms-brand) 30%, transparent);
  margin-bottom: 4px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--color-text-heading);
`;

const Body = styled.p`
  margin: 0;
  font-size: var(--text-md);
  line-height: 1.55;
  color: var(--color-text-muted);
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
`;

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, body, actions, compact }) => (
  <Wrap $compact={compact} role="status">
    {icon && <IconTile aria-hidden="true">{icon}</IconTile>}
    <Title>{title}</Title>
    {body && <Body>{body}</Body>}
    {actions && <Actions>{actions}</Actions>}
  </Wrap>
);

export default EmptyState;
