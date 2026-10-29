// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";
import { CircleIconButton } from "../../components/SharedStyles";

export const SearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
  border-bottom: 1px solid var(--color-border);
`;

export const MobileSearchWrapper = styled.div`
  display: block;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
`;

export const SearchInputWrapper = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: var(--color-text-muted);
  }

  input {
    width: 100%;
    padding: 10px 16px 10px 40px;
    border-radius: 9999px;
    background-color: var(--color-search-bg);
    border: 1px solid var(--color-search-border);
    font-size: var(--text-md, 15px);
    line-height: var(--leading-md, 20px);
    outline: none;
    box-sizing: border-box;
    color: var(--color-text-primary);
    transition: all 0.2s ease;

    &:focus {
      background-color: var(--color-search-bg);
      border-color: var(--color-accent-cyan);
      box-shadow: 0 0 12px var(--color-search-focus);
    }

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.7;
    }
  }
`;

export const HeaderIconButton = CircleIconButton;

export const TabContainer = styled.div`
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  background-color: transparent;
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
    background-color: rgba(255, 255, 255, 0.04);
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
