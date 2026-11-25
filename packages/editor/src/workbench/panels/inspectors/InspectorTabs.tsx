// SPDX-License-Identifier: AGPL-3.0-or-later

import { SegmentedControl } from "@primer/react";

export interface InspectorTabItem<T extends string = string> {
  id: T;
  label: string;
}

export interface InspectorTabsProps<T extends string = string> {
  tabs: readonly InspectorTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}

/**
 * Shared Primer SegmentedControl sub-view switcher for Ansatz domain inspectors and visualizers.
 */
export function InspectorTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  ariaLabel = "Inspector sub-views",
}: InspectorTabsProps<T>) {
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      size="small"
      onChange={(idx) => {
        const item = tabs[idx];
        if (item) onChange(item.id);
      }}
    >
      {tabs.map((t) => (
        <SegmentedControl.Button key={t.id} selected={value === t.id}>
          {t.label}
        </SegmentedControl.Button>
      ))}
    </SegmentedControl>
  );
}
