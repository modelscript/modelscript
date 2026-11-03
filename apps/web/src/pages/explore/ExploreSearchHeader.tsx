// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, CommandPaletteIcon, SearchIcon, XCircleFillIcon } from "@primer/octicons-react";
import React from "react";
import {
  HeaderIconButton,
  SearchHeader,
  SearchInputWrapper,
  SearchSplitCapsule,
  SearchSplitDivider,
  SearchSplitOmniButton,
  SearchSplitPrimaryButton,
} from "./styles";

export interface ExploreSearchHeaderProps {
  onBack: () => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  onClear?: (() => void) | undefined;
  showClear?: boolean;
}

export const ExploreSearchHeader: React.FC<ExploreSearchHeaderProps> = ({
  onBack,
  value,
  onChange,
  onSubmit,
  placeholder = "Search",
  onClear,
  showClear = false,
}) => {
  return (
    <SearchHeader>
      <HeaderIconButton onClick={onBack} aria-label="Back">
        <ArrowLeftIcon size={20} />
      </HeaderIconButton>
      <SearchInputWrapper>
        <SearchIcon size={16} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onSubmit}
          placeholder={placeholder}
        />
        {showClear && value && onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            aria-label="Clear search"
          >
            <XCircleFillIcon size={16} />
          </button>
        )}
        <SearchSplitCapsule role="group" aria-label="Search or open Omni-bar">
          <SearchSplitPrimaryButton
            onClick={() => onSubmit({ key: "Enter" } as React.KeyboardEvent<HTMLInputElement>)}
            title="Search Explore"
          >
            Search
          </SearchSplitPrimaryButton>
          <SearchSplitDivider aria-hidden="true" />
          <SearchSplitOmniButton
            onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
            title="Open Omni-bar"
            aria-label="Open Omni-bar"
          >
            <CommandPaletteIcon size={15} />
          </SearchSplitOmniButton>
        </SearchSplitCapsule>
      </SearchInputWrapper>
    </SearchHeader>
  );
};
