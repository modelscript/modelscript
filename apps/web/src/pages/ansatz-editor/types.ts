// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HeroExample } from "./constants";

export type { HeroExample };

export interface AnsatzAnchor {
  elementId?: string;
  [key: string]: unknown;
}

export interface AnsatzDecodedPayload {
  v?: number;
  lang?: string;
  code?: string;
  title?: string;
  view?: string;
  anchor?: AnsatzAnchor;
  [key: string]: unknown;
}
