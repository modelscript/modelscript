// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  CpuIcon,
  DatabaseIcon,
  GraphIcon,
  PulseIcon,
  ServerIcon,
  SparkleFillIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import styled from "styled-components";
import { scrollToTop } from "./ScrollToTop";
import { isMlArenaPathname, ML_ARENA_ROUTE_SPECS } from "./ml-arena-routes";

export { isMlArenaPathname };

const ICON_MAP = {
  arena: BeakerIcon,
  datasets: DatabaseIcon,
  models: CpuIcon,
  runs: PulseIcon,
  memory: ServerIcon,
  leaderboards: GraphIcon,
} as const;

export const ML_ARENA_NAV_ITEMS = ML_ARENA_ROUTE_SPECS.map((spec) => ({
  ...spec,
  icon: ICON_MAP[spec.iconKey],
}));

const EnvHeader = styled.header`
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--surface-sticky, var(--color-bg-primary));
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.25s ease;
`;

const HeaderTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 20px 10px;
`;

const TitleCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const IconBadge = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ms-brand-soft);
  border: 1px solid var(--color-accent-blue-border);
  color: var(--ms-brand);
  flex-shrink: 0;
`;

const TitleStack = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const EnvTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 22px;
  color: var(--color-text-heading);
`;

const EnvSubtitle = styled.div`
  font-size: 12.5px;
  color: var(--color-text-muted);
  line-height: 17px;
`;

const QuickActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const ActionLink = styled(Link)<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  border: 1px solid ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-border-default)")};
  background: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-bg-surface)")};
  color: ${(p) => (p.$primary ? "var(--ms-brand-contrast, #ffffff)" : "var(--color-text-primary)")};
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;

  &:hover {
    text-decoration: none;
    opacity: ${(p) => (p.$primary ? 0.92 : 1)};
    background: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--surface-row-hover)")};
    border-color: ${(p) => (p.$primary ? "var(--ms-brand)" : "var(--color-border-strong)")};
  }
`;

const EnvTabStrip = styled.nav`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const EnvTabLink = styled(Link)<{ $active?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 42px;
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: ${(p) => (p.$active ? 650 : 500)};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  text-decoration: none;
  white-space: nowrap;
  border-radius: 6px 6px 0 0;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;

  svg {
    color: ${(p) => (p.$active ? "var(--ms-brand)" : "currentColor")};
    flex-shrink: 0;
  }

  &:hover {
    text-decoration: none;
    color: var(--color-text-heading);
    background: var(--surface-row-hover);
  }

  &::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 2.5px;
    border-radius: 999px 999px 0 0;
    background: var(--ms-brand);
    display: ${(p) => (p.$active ? "block" : "none")};
  }
`;

export const MlArenaNavHeader: React.FC = () => {
  const location = useLocation();

  return (
    <EnvHeader data-testid="ml-arena-env-header">
      <HeaderTopRow>
        <TitleCluster>
          <IconBadge aria-hidden="true">
            <BeakerIcon size={17} />
          </IconBadge>
          <TitleStack>
            <EnvTitle>ML &amp; Arena</EnvTitle>
            <EnvSubtitle>
              Formal RLVR post-training, zonotope datasets, SLM registry, DiskANN memory &amp; leaderboards
            </EnvSubtitle>
          </TitleStack>
        </TitleCluster>
        <QuickActions>
          <ActionLink to="/editor?mode=training-studio">
            <SparkleFillIcon size={13} />
            <span>AI Studio in Editor</span>
          </ActionLink>
          <ActionLink to="/annotate/queue" $primary>
            <ZapIcon size={13} />
            <span>Start Annotating</span>
          </ActionLink>
        </QuickActions>
      </HeaderTopRow>

      <EnvTabStrip aria-label="ML & Arena sections" data-testid="ml-arena-nav">
        {ML_ARENA_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.matchPrefixes.some(
            (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
          );
          return (
            <EnvTabLink
              key={item.to}
              to={item.to}
              $active={active}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                scrollToTop({ smooth: location.pathname === item.to });
              }}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </EnvTabLink>
          );
        })}
      </EnvTabStrip>
    </EnvHeader>
  );
};

export default MlArenaNavHeader;
