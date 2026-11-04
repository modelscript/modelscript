// SPDX-License-Identifier: AGPL-3.0-or-later

import { QuoteIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import type { CitationTarget } from "../../util/citations";
import { CitationModal } from "./CitationModal";
import { Trigger } from "./citationUi";

export interface CiteButtonProps {
  target?: CitationTarget;
  metadata?: CitationTarget;
  label?: string;
  variant?: "ghost" | "pill" | "button" | "sidebar" | "icon-only";
  size?: "sm" | "md";
  className?: string;
  testId?: string;
  title?: string;
}

export const CiteButton: React.FC<CiteButtonProps> = ({
  target,
  metadata,
  label = "Cite",
  variant = "pill",
  size = "sm",
  className = "",
  testId = "cite-button",
  title = "Cite this item (APA, MLA, IEEE, BibTeX, RIS, CSL-JSON...)",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const resolvedTarget = (target || metadata)!;

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  };

  const iconSize = size === "md" ? 14 : 12;

  return (
    <>
      <Trigger
        type="button"
        onClick={handleOpen}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        data-testid={testId}
        className={className}
        $variant={variant}
        $size={size}
      >
        <QuoteIcon size={iconSize} />
        {variant !== "icon-only" && <span>{label}</span>}
      </Trigger>
      {isOpen && resolvedTarget && (
        <CitationModal isOpen={isOpen} onClose={() => setIsOpen(false)} target={resolvedTarget} />
      )}
    </>
  );
};
