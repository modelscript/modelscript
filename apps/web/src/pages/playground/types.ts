// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HeroExample } from "./constants";

export type { HeroExample };

export interface MorselAnchor {
  elementId?: string;
  [key: string]: unknown;
}

export interface MorselDecodedPayload {
  v?: number;
  lang?: string;
  code?: string;
  title?: string;
  view?: string;
  anchor?: MorselAnchor;
  [key: string]: unknown;
}
