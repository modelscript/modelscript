// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon } from "@primer/octicons-react";
import React from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { CircleIconButton } from "./SharedStyles";

const Root = styled.header<{ $divider: boolean }>`
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px;
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  border-bottom: ${(p) => (p.$divider ? "1px solid var(--color-border)" : "none")};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 53px;
`;

const Titles = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
`;

const TitleLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  font-size: var(--text-xl, 20px);
  font-weight: 700;
  line-height: var(--leading-xl, 24px);
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Subtitle = styled.span`
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm, 16px);
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const Extra = styled.div`
  padding-bottom: 12px;
`;

export interface PageHeaderProps {
  title: React.ReactNode;
  /** Small icon rendered before the title. */
  icon?: React.ReactNode | undefined;
  /** Secondary line under the title (counts, handle, etc.). */
  subtitle?: React.ReactNode | undefined;
  /** Inline badge next to the title (e.g. unread pill). */
  badge?: React.ReactNode | undefined;
  /** `true` navigates back in history; a function overrides the behaviour. */
  back?: boolean | (() => void) | undefined;
  /** Right-aligned controls. Use `ms-btn` classes; keep to one primary action. */
  actions?: React.ReactNode | undefined;
  /** Extra content under the title row (search field, tabs). Stays sticky. */
  children?: React.ReactNode | undefined;
  /** Draw the bottom divider (default true; turn off when tabs follow). */
  divider?: boolean | undefined;
}

/**
 * Shared sticky page header for the centre column. One layout for every page:
 * optional back button, title (+ icon/badge/subtitle), right-aligned actions,
 * and an optional sticky region below for search fields.
 */
const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  icon,
  subtitle,
  badge,
  back,
  actions,
  children,
  divider = true,
}) => {
  const navigate = useNavigate();
  const onBack = typeof back === "function" ? back : () => navigate(-1);

  return (
    <Root $divider={divider}>
      <Row>
        {back && (
          <CircleIconButton type="button" onClick={onBack} aria-label="Go back">
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
        )}
        <Titles>
          <TitleLine>
            {icon}
            <Title>{title}</Title>
            {badge}
          </TitleLine>
          {subtitle && <Subtitle>{subtitle}</Subtitle>}
        </Titles>
        {actions && <Actions>{actions}</Actions>}
      </Row>
      {children && <Extra>{children}</Extra>}
    </Root>
  );
};

export default PageHeader;
