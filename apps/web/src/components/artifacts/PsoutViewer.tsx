// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, SegmentedControl } from "@primer/react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";

export interface PsoutViewerProps {
  viewConfig: {
    title?: string | undefined;
    timeStepSec?: number | undefined;
    durationSec?: number | undefined;
    channels?: string[] | undefined;
    data?: Record<string, number>[] | undefined;
    url?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.35);
`;

const ChartContainer = styled.div`
  flex: 1;
  padding: 16px;
  background: var(--color-canvas-inset, #010409);
`;

export const PsoutViewer: React.FC<PsoutViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [activeSignal, setActiveSignal] = useState<"voltages" | "currents" | "power">("voltages");
  const title = viewConfig.title || "PSCAD Simulation Waveforms (.psout)";

  // Generate synthetic high-density EMT waveform trajectory if raw data is omitted
  const waveformData = useMemo(() => {
    if (viewConfig.data && Array.isArray(viewConfig.data) && viewConfig.data.length > 0) {
      return viewConfig.data;
    }
    const points: Record<string, number>[] = [];
    const dt = 0.0005;
    const f0 = 60; // 60 Hz fundamental
    for (let i = 0; i < 200; i++) {
      const t = i * dt;
      // 3-phase symmetrical sinusoidal voltages with mild 5th harmonic distortion
      const va = 330 * Math.sin(2 * Math.PI * f0 * t) + 12 * Math.sin(10 * Math.PI * f0 * t);
      const vb = 330 * Math.sin(2 * Math.PI * f0 * t - (2 * Math.PI) / 3) + 12 * Math.sin(10 * Math.PI * f0 * t);
      const vc = 330 * Math.sin(2 * Math.PI * f0 * t + (2 * Math.PI) / 3) + 12 * Math.sin(10 * Math.PI * f0 * t);

      // Inverter currents with high-frequency switching ripple
      const ia = 24 * Math.sin(2 * Math.PI * f0 * t - 0.2);
      const ib = 24 * Math.sin(2 * Math.PI * f0 * t - (2 * Math.PI) / 3 - 0.2);
      const ic = 24 * Math.sin(2 * Math.PI * f0 * t + (2 * Math.PI) / 3 - 0.2);

      const pMw = (va * ia + vb * ib + vc * ic) * 0.001;

      points.push({
        time: Number((t * 1000).toFixed(2)), // in ms
        Va: Number(va.toFixed(2)),
        Vb: Number(vb.toFixed(2)),
        Vc: Number(vc.toFixed(2)),
        Ia: Number(ia.toFixed(2)),
        Ib: Number(ib.toFixed(2)),
        Ic: Number(ic.toFixed(2)),
        P: Number(pMw.toFixed(2)),
      });
    }
    return points;
  }, [viewConfig.data]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="#c084fc" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PSOUT Waveform</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <SegmentedControl size="small" aria-label="Signal Selector">
            <SegmentedControl.Button selected={activeSignal === "voltages"} onClick={() => setActiveSignal("voltages")}>
              Voltages (kV)
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={activeSignal === "currents"} onClick={() => setActiveSignal("currents")}>
              Currents (kA)
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={activeSignal === "power"} onClick={() => setActiveSignal("power")}>
              Power (MW)
            </SegmentedControl.Button>
          </SegmentedControl>

          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/ide?title=${encodeURIComponent(title)}`)}
          >
            Waveform Studio
          </Button>
        </Box>
      </Toolbar>

      <ChartContainer>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={waveformData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="time" stroke="#8b949e" tick={{ fontSize: 11 }} unit="ms" />
            <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#161b22",
                borderColor: "#30363d",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />

            {activeSignal === "voltages" && (
              <>
                <Line type="monotone" dataKey="Va" stroke="#38bdf8" dot={false} strokeWidth={1.8} name="Phase A (kV)" />
                <Line type="monotone" dataKey="Vb" stroke="#f59e0b" dot={false} strokeWidth={1.8} name="Phase B (kV)" />
                <Line type="monotone" dataKey="Vc" stroke="#10b981" dot={false} strokeWidth={1.8} name="Phase C (kV)" />
              </>
            )}

            {activeSignal === "currents" && (
              <>
                <Line type="monotone" dataKey="Ia" stroke="#a855f7" dot={false} strokeWidth={1.8} name="Ia (kA)" />
                <Line type="monotone" dataKey="Ib" stroke="#ec4899" dot={false} strokeWidth={1.8} name="Ib (kA)" />
                <Line type="monotone" dataKey="Ic" stroke="#06b6d4" dot={false} strokeWidth={1.8} name="Ic (kA)" />
              </>
            )}

            {activeSignal === "power" && (
              <Line type="monotone" dataKey="P" stroke="#10b981" dot={false} strokeWidth={2} name="Active Power (MW)" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </CardWrapper>
  );
};

export default PsoutViewer;
