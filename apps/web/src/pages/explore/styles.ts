// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";
import { CircleIconButton } from "../../components/SharedStyles";

export const SearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  border-bottom: 1px solid var(--color-border);
`;

export const MobileSearchWrapper = styled.div`
  display: block;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
`;

export const SearchInputWrapper = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 4px 4px 4px 16px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg));
  border: 1px solid var(--color-search-border);
  box-sizing: border-box;
  box-shadow: 0 2px 10px -4px rgba(15, 23, 42, 0.06);
  transition:
    border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background-color 0.2s ease;

  > svg {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: color 0.18s ease;
  }

  &:focus-within {
    background: color-mix(in srgb, var(--color-bg-primary) 90%, var(--color-search-bg));
    border-color: var(--ms-brand);
    box-shadow: var(--ms-focus-ring);

    > svg {
      color: var(--ms-brand);
    }
  }

  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    font-size: var(--text-md, 15px);
    line-height: var(--leading-md, 20px);
    outline: none;
    box-sizing: border-box;
    color: var(--color-text-primary);

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.72;
    }
  }
`;

export const SearchSplitCapsule = styled.div`
  display: inline-flex;
  align-items: stretch;
  height: 34px;
  border-radius: 9999px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast);
  box-shadow: var(--ms-brand-shadow);
`;

export const SearchSplitPrimaryButton = styled.button.attrs({ type: "button" })`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 12px 0 14px;
  border: none;
  background: transparent;
  color: var(--ms-brand-contrast);
  font-family: var(--ms-font-sans);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.16s ease;

  &:hover {
    background: var(--ms-brand-hover);
  }

  &:active {
    background: var(--ms-brand-active);
  }

  &:focus-visible {
    outline: none;
    background: var(--ms-brand-hover);
  }
`;

export const SearchSplitDivider = styled.span`
  width: 1px;
  align-self: stretch;
  margin: 7px 0;
  background: rgba(255, 255, 255, 0.28);
  flex-shrink: 0;
  pointer-events: none;
`;

export const SearchSplitOmniButton = styled.button.attrs({ type: "button" })`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 11px 0 9px;
  border: none;
  background: transparent;
  color: var(--ms-brand-contrast);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.16s ease;

  svg {
    display: block;
    color: inherit;
  }

  &:hover {
    background: var(--ms-brand-hover);
  }

  &:active {
    background: var(--ms-brand-active);
  }

  &:focus-visible {
    outline: none;
    background: var(--ms-brand-hover);
  }
`;

export const HeaderIconButton = CircleIconButton;

export const TabContainer = styled.div`
  display: flex;
  overflow-x: auto;
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 73px);
  z-index: 45;
  border-bottom: 1px solid var(--color-border);
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const TabButton = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  min-width: 80px;
  height: 53px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0 16px;
  font-size: var(--text-md, 15px);
  line-height: var(--leading-md, 20px);
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  cursor: pointer;
  position: relative;
  text-align: center;
  white-space: nowrap;
  transition:
    color 0.2s,
    background-color 0.2s;

  &:hover {
    background-color: var(--surface-row-hover, rgba(255, 255, 255, 0.04));
  }

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 15%;
      right: 15%;
      height: 3px;
      border-radius: 9999px;
      background: var(--gradient-cta);
      box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    }
  `}
`;
