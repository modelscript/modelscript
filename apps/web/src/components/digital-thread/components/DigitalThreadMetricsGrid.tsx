// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CodeIcon, CpuIcon, SyncIcon } from "@primer/octicons-react";
import React from "react";
import { MetricCard, MetricLabel, MetricValue, MetricsGrid } from "../styles";
import type { DigitalThreadMetrics } from "../types";

export interface DigitalThreadMetricsGridProps {
  metrics: DigitalThreadMetrics;
}

export const DigitalThreadMetricsGrid: React.FC<DigitalThreadMetricsGridProps> = ({ metrics }) => {
  return (
    <MetricsGrid>
      <MetricCard>
        <MetricLabel>Total Digital Thread Twins</MetricLabel>
        <MetricValue>
          <SyncIcon size={24} fill="#06b6d4" />
          {metrics.total}
        </MetricValue>
      </MetricCard>

      <MetricCard>
        <MetricLabel>Physical Quantity Parity</MetricLabel>
        <MetricValue style={{ color: "var(--ms-success)" }}>
          <CheckCircleFillIcon size={24} fill="var(--ms-success)" />
          {`${metrics.parityRate}%`}
        </MetricValue>
      </MetricCard>

      <MetricCard>
        <MetricLabel>CAD 3D Bindings</MetricLabel>
        <MetricValue style={{ color: "#fbbf24" }}>
          <CpuIcon size={24} fill="#fbbf24" />
          {metrics.cadBindings}
        </MetricValue>
      </MetricCard>

      <MetricCard>
        <MetricLabel>SysML v2 Alignments</MetricLabel>
        <MetricValue style={{ color: "#a855f7" }}>
          <CodeIcon size={24} fill="#a855f7" />
          {metrics.sysmlAlignments}
        </MetricValue>
      </MetricCard>
    </MetricsGrid>
  );
};
