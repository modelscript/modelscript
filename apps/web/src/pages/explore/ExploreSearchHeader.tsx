// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, SearchIcon, XCircleFillIcon } from "@primer/octicons-react";
import React from "react";
import { HeaderIconButton, SearchHeader, SearchInputWrapper } from "./styles";

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
            }}
            aria-label="Clear search"
          >
            <XCircleFillIcon size={16} />
          </button>
        )}
      </SearchInputWrapper>
    </SearchHeader>
  );
};
