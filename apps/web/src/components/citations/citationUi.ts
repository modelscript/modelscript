// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { css, keyframes } from "styled-components";

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const focusRing = css`
  &:focus-visible {
    outline: 2px solid var(--ms-brand);
    outline-offset: 2px;
  }
`;

export const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: ${fadeIn} 140ms ease-out;

  @media (max-width: 640px) {
    align-items: flex-end;
    padding: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const Dialog = styled.div`
  width: 100%;
  max-width: 600px;
  max-height: min(90vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-elv);
  color: var(--ms-text-1);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.02),
    0 8px 16px rgba(0, 0, 0, 0.18),
    0 32px 64px rgba(0, 0, 0, 0.32);
  animation: ${popIn} 180ms cubic-bezier(0.16, 1, 0.3, 1);

  @media (max-width: 640px) {
    max-width: none;
    max-height: 92vh;
    border-radius: 16px 16px 0 0;
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 20px 14px;
`;

export const Eyebrow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ms-brand);
`;

export const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ms-text-heading);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

export const Meta = styled.p`
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ms-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

export const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--ms-divider);
  background: var(--ms-bg-alt);
`;

export const FooterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

/* ─── Buttons ─── */

type BtnVariant = "primary" | "secondary" | "ghost";

const variantStyles: Record<BtnVariant, ReturnType<typeof css>> = {
  primary: css`
    background: var(--ms-brand);
    color: var(--ms-brand-contrast);
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: var(--ms-brand-hover);
    }
    &:active:not(:disabled) {
      background: var(--ms-brand-active);
    }
  `,
  secondary: css`
    background: transparent;
    color: var(--ms-text-1);
    border: 1px solid var(--ms-border);
    &:hover:not(:disabled) {
      background: var(--ms-surface-hover);
      border-color: var(--ms-border-strong);
    }
  `,
  ghost: css`
    background: transparent;
    color: var(--ms-text-2);
    border: 1px solid transparent;
    &:hover:not(:disabled) {
      background: var(--ms-surface-hover);
      color: var(--ms-text-1);
    }
  `,
};

const buttonBase = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    transform 80ms ease;
  ${focusRing}
  &:active:not(:disabled) {
    transform: scale(0.97);
  }
  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &:active:not(:disabled) {
      transform: none;
    }
  }
`;

export const Button = styled.button<{ $variant?: BtnVariant }>`
  ${buttonBase}
  ${(p) => variantStyles[p.$variant ?? "secondary"]}
`;

/** Same look as {@link Button}, for router links. */
export const buttonStyles = (variant: BtnVariant = "secondary") => css`
  ${buttonBase}
  ${variantStyles[variant]}
`;

export const IconButton = styled.button<{ $success?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${(p) => (p.$success ? "var(--ms-success)" : "var(--ms-text-2)")};
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
  ${focusRing}
  &:hover {
    background: var(--ms-surface-hover);
    color: ${(p) => (p.$success ? "var(--ms-success)" : "var(--ms-text-1)")};
  }
`;

/* ─── Segmented tabs & format chips ─── */

export const Segmented = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--ms-surface-hover);
`;

export const SegmentedItem = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: ${(p) => (p.$active ? "var(--ms-bg-elv)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-text-heading)" : "var(--ms-text-2)")};
  box-shadow: ${(p) => (p.$active ? "0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px var(--ms-border)" : "none")};
  transition:
    background-color 120ms ease,
    color 120ms ease;
  ${focusRing}
  &:hover {
    color: var(--ms-text-heading);
  }
`;

export const ChipRow = styled.div`
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const Chip = styled.button<{ $active: boolean }>`
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "transparent" : "var(--ms-border)")};
  background: ${(p) => (p.$active ? "var(--ms-brand)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand-contrast)" : "var(--ms-text-2)")};
  transition:
    background-color 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
  ${focusRing}
  &:hover {
    ${(p) =>
      p.$active
        ? ""
        : css`
            color: var(--ms-text-1);
            background: var(--ms-surface-hover);
          `}
  }
`;

/* ─── Preview blocks ─── */

export const Preview = styled.div`
  position: relative;
  border-radius: 12px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
`;

export const PreviewLabel = styled.div`
  padding: 10px 52px 0 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ms-text-3);
`;

export const PreviewCopy = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
`;

export const PreviewText = styled.div`
  padding: 8px 14px 14px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ms-text-1);
  overflow-wrap: anywhere;
  user-select: all;
`;

export const PreviewCode = styled.pre`
  margin: 0;
  padding: 8px 14px 14px;
  max-height: 260px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ms-text-1);
  user-select: all;
`;

export const Disclosure = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 4px 6px;
  margin: -4px -6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ms-text-2);
  cursor: pointer;
  ${focusRing}
  &:hover {
    color: var(--ms-text-1);
  }
`;

export const QuickList = styled.div`
  border-radius: 12px;
  border: 1px solid var(--ms-border);
  overflow: hidden;
  & > div + div {
    border-top: 1px solid var(--ms-divider);
  }
`;

export const QuickRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 8px 10px 14px;
  &:hover {
    background: var(--ms-surface-hover);
  }
  p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ms-text-2);
    overflow-wrap: anywhere;
  }
`;

export const Tag = styled.span`
  display: inline-block;
  margin-bottom: 2px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ms-text-3);
`;

export const Code = styled.code`
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: var(--ms-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const SyntaxRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--ms-text-2);
`;

/* ─── Trigger button (CiteButton) ─── */

export const Trigger = styled.button<{ $variant: string; $size: "sm" | "md" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
  ${focusRing}

  ${(p) => {
    const fs = p.$size === "md" ? "13px" : "12px";
    switch (p.$variant) {
      case "ghost":
      case "icon-only":
        return css`
          padding: 6px;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: var(--ms-text-2);
          &:hover {
            background: var(--ms-brand-soft);
            color: var(--ms-brand);
          }
        `;
      case "sidebar":
        return css`
          width: 100%;
          height: 36px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid var(--ms-border);
          background: transparent;
          color: var(--ms-text-1);
          font-size: 13px;
          &:hover {
            background: var(--ms-surface-hover);
            border-color: var(--ms-border-strong);
          }
        `;
      case "button":
        return css`
          height: 32px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid var(--ms-border);
          background: transparent;
          color: var(--ms-text-1);
          font-size: ${fs};
          &:hover {
            background: var(--ms-surface-hover);
            border-color: var(--ms-border-strong);
          }
        `;
      default:
        return css`
          height: ${p.$size === "md" ? "32px" : "26px"};
          padding: 0 ${p.$size === "md" ? "12px" : "10px"};
          border-radius: 999px;
          border: 1px solid var(--ms-border);
          background: transparent;
          color: var(--ms-text-2);
          font-size: ${fs};
          &:hover {
            background: var(--ms-brand-soft);
            border-color: color-mix(in srgb, var(--ms-brand) 40%, transparent);
            color: var(--ms-brand);
          }
        `;
    }
  }}
`;
