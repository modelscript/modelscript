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
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
        title="Ask AI Copilot or open command palette (⌘K)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 12px",
          borderRadius: "9999px",
          background: "var(--color-search-bg, rgba(255, 255, 255, 0.04))",
          border: "1px solid var(--color-search-border, var(--color-border-glass))",
          color: "var(--color-text-muted)",
          fontSize: "12px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "var(--color-accent-purple)", fontSize: "13px" }}>⚡</span>
        <span>AI Copilot</span>
        <kbd
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid var(--color-border-glass)",
            borderRadius: "4px",
            padding: "1px 5px",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⌘K
        </kbd>
      </button>
    </SearchHeader>
  );
};
