// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from "react-router-dom";
import styled, { css } from "styled-components";
import { buttonStyles } from "../components/citations/citationUi";

type Tone = "brand" | "success" | "warn" | "neutral";

const toneColor: Record<Tone, string> = {
  brand: "var(--ms-brand)",
  success: "var(--ms-success)",
  warn: "var(--ms-warning)",
  neutral: "var(--ms-text-2)",
};

export const Page = styled.div`
  max-width: 896px;
  margin: 0 auto;
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: var(--ms-text-1);
`;

export const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
`;

export const Crumbs = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ms-text-2);
  min-width: 0;
`;

export const Row = styled.div<{ $gap?: number; $wrap?: boolean; $between?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${(p) => p.$gap ?? 8}px;
  flex-wrap: ${(p) => (p.$wrap === false ? "nowrap" : "wrap")};
  ${(p) => p.$between && "justify-content: space-between;"}
`;

export const Card = styled.section<{ $tone?: "success" }>`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 16px;
  border: 1px solid
    ${(p) => (p.$tone === "success" ? "color-mix(in srgb, var(--ms-success) 40%, transparent)" : "var(--ms-border)")};
  background: ${(p) =>
    p.$tone === "success" ? "color-mix(in srgb, var(--ms-success) 7%, var(--ms-bg-elv))" : "var(--ms-bg-elv)"};
`;

export const Hero = styled(Card)`
  padding: 24px;
  gap: 16px;
`;

export const H2 = styled.h2`
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ms-text-heading);
  svg {
    flex-shrink: 0;
    color: var(--ms-brand);
  }
`;

export const H1 = styled.h1`
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ms-text-heading);
`;

export const Subtitle = styled.p`
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--ms-text-2);
`;

export const Text = styled.p<{ $size?: number; $muted?: boolean }>`
  margin: 0;
  font-size: ${(p) => p.$size ?? 13}px;
  line-height: 1.6;
  color: ${(p) => (p.$muted ? "var(--ms-text-2)" : "var(--ms-text-1)")};
`;

export const Abstract = styled(Text)`
  font-size: 14px;
  white-space: pre-line;
`;

const badgeBase = css<{ $tone?: Tone; $mono?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: ${(p) => (p.$mono ? 500 : 700)};
  font-family: ${(p) => (p.$mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit")};
  letter-spacing: ${(p) => (p.$mono ? "0" : "0.05em")};
  text-transform: ${(p) => (p.$mono ? "none" : "uppercase")};
  text-decoration: none;
  color: ${(p) => toneColor[p.$tone ?? "neutral"]};
  background: color-mix(in srgb, ${(p) => toneColor[p.$tone ?? "neutral"]} 12%, transparent);
  border: 1px solid color-mix(in srgb, ${(p) => toneColor[p.$tone ?? "neutral"]} 28%, transparent);
`;

export const Badge = styled.span<{ $tone?: Tone; $mono?: boolean }>`
  ${badgeBase}
`;

export const BadgeLink = styled.a<{ $tone?: Tone; $mono?: boolean }>`
  ${badgeBase}
  &:hover {
    text-decoration: underline;
  }
`;

export const Divider = styled.div`
  height: 1px;
  background: var(--ms-divider);
`;

export const AuthorChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
  font-size: 12.5px;
  a {
    text-decoration: none;
    font-weight: 700;
    color: var(--ms-text-1);
  }
  a:hover {
    color: var(--ms-brand);
    text-decoration: underline;
  }
`;

export const Muted = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ms-text-3);
`;

export const MetaStrip = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding-top: 14px;
  border-top: 1px solid var(--ms-divider);
  font-size: 12.5px;
  color: var(--ms-text-2);
  strong {
    color: var(--ms-text-1);
    font-weight: 600;
  }
  a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
  }
  a:hover strong {
    color: var(--ms-brand);
  }
  svg {
    color: var(--ms-text-3);
  }
`;

export const Grid = styled.div<{ $cols?: "2" | "3" }>`
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
  @media (min-width: 720px) {
    grid-template-columns: ${(p) => (p.$cols === "3" ? "2fr 1fr" : "1fr 1fr")};
  }
`;

export const FieldGrid = styled.div`
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  @media (min-width: 560px) {
    grid-template-columns: 1fr 1fr;
  }
`;

export const Tile = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
  font-size: 12.5px;
  min-width: 0;
`;

export const TileLink = styled(Link)`
  display: block;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
  text-decoration: none;
  color: inherit;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
  &:hover {
    background: var(--ms-surface-hover);
    border-color: var(--ms-border-strong);
  }
`;

export const FieldLabel = styled.div`
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ms-text-3);
`;

export const FieldValue = styled.div<{ $mono?: boolean; $brand?: boolean; $truncate?: boolean }>`
  margin-top: 2px;
  color: ${(p) => (p.$brand ? "var(--ms-brand)" : "var(--ms-text-1)")};
  font-family: ${(p) => (p.$mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit")};
  ${(p) => p.$truncate && "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"}
`;

export const Stack = styled.div<{ $gap?: number }>`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.$gap ?? 8}px;
`;

export const Scroll = styled(Stack)`
  max-height: 224px;
  overflow-y: auto;
`;

export const Input = styled.input`
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--ms-border);
  background: var(--ms-bg-alt);
  color: var(--ms-text-1);
  font: inherit;
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: var(--ms-brand);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ms-brand) 25%, transparent);
  }
`;

export const TextButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  margin: -4px -6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-brand);
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
  &:focus-visible {
    outline: 2px solid var(--ms-brand);
  }
`;

/** Anchor styled like the shared Button. */
export const ALink = styled.a<{ $variant?: "primary" | "secondary" | "ghost" }>`
  ${(p) => buttonStyles(p.$variant)}
  ${(p) => p.$variant === "primary" && "&, &:hover { color: var(--ms-brand-contrast); }"}
`;

/** Router link styled like the shared Button. */
export const RLink = styled(Link)<{ $variant?: "primary" | "secondary" | "ghost" }>`
  ${(p) => buttonStyles(p.$variant)}
  ${(p) => p.$variant === "primary" && "&, &:hover { color: var(--ms-brand-contrast); }"}
`;

export const SmallALink = styled(ALink)`
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
`;

export const PdfFrame = styled.div`
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--ms-success) 40%, transparent);
  background: var(--ms-bg-alt);
  iframe {
    display: block;
    width: 100%;
    height: 540px;
    border: 0;
    background: #fff;
  }
`;

export const PdfBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ms-divider);
  background: var(--ms-bg-elv);
  font-size: 12.5px;
  font-weight: 600;
  a {
    color: var(--ms-brand);
    text-decoration: none;
  }
`;

export const Bars = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 144px;
  padding-top: 8px;
`;

export const Bar = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: var(--ms-text-3);
`;

export const BarTrack = styled.div`
  width: 100%;
  height: 96px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  border-radius: 6px 6px 0 0;
  background: var(--ms-surface-hover);
`;

export const BarFill = styled.div`
  width: 100%;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--ms-brand) 55%, transparent), var(--ms-brand));
`;

export const SkeletonBlock = styled.div<{ $h: number; $w?: string }>`
  height: ${(p) => p.$h}px;
  width: ${(p) => p.$w ?? "100%"};
  border-radius: 10px;
  background: var(--ms-surface-hover);
  animation: sdPulse 1.4s ease-in-out infinite;
  @keyframes sdPulse {
    50% {
      opacity: 0.5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const Clamp = styled.div<{ $lines?: number }>`
  display: -webkit-box;
  -webkit-line-clamp: ${(p) => p.$lines ?? 2};
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
