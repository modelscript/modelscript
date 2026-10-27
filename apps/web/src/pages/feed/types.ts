// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";

export interface FilterChip {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  emoji?: string | undefined;
  artifactType?: string | undefined;
  description: string;
}

export interface TopicItem {
  concept: string;
  displayName: string;
  postCount?: number | undefined;
}

export interface DisciplineItem {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  isPackage: boolean;
  description: string;
  exploreUrl: string;
}

export interface DisciplineCategory {
  id: string;
  name: string;
  emoji: string;
  items: DisciplineItem[];
}
