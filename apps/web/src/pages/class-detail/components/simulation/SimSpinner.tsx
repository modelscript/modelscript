// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styledImport, { keyframes } from "styled-components";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const Ring = styled.span<{ $size: number }>`
  display: inline-block;
  flex-shrink: 0;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: 50%;
  border: ${({ $size }) => Math.max(2, Math.round($size / 10))}px solid var(--ms-brand-soft, rgba(6, 182, 212, 0.2));
  border-top-color: var(--ms-brand, #06b6d4);
  animation: ${spin} 0.8s linear infinite;
  will-change: transform;

  /* Loading indicators must keep moving even under the global reduced-motion rule. */
  animation-duration: 0.8s !important;
  animation-iteration-count: infinite !important;
`;

/** Self-contained CSS spinner (transform-based, so it keeps animating even when the main thread is busy). */
export const SimSpinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <Ring $size={size} role="progressbar" aria-label="Simulating" />
);
