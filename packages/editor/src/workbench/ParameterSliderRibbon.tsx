// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useState } from "react";
import type { ParameterInfo } from "./SimulationParameters";

export interface ParameterRibbonItem extends ParameterInfo {
  min?: number | undefined;
  max?: number | undefined;
}

interface ParameterSliderRibbonProps {
  parameters: ParameterRibbonItem[];
  overrides: Map<string, number>;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
  onSimulate?: (() => void) | undefined;
  isSimulating?: boolean | undefined;
  dark?: boolean | undefined;
  hasFloatingDock?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  fullWidth?: boolean | undefined;
}

interface RibbonContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  $dark: boolean;
  $expanded: boolean;
  $hasFloatingDock: boolean;
  $fullWidth: boolean;
}

const RibbonContainer: React.FC<RibbonContainerProps> = ({
  $dark,
  $expanded,
  $hasFloatingDock,
  $fullWidth,
  className,
  style,
  ...rest
}) => (
  <div
    className={className ? `ms-param-ribbon-container ${className}` : "ms-param-ribbon-container"}
    style={{
      position: "absolute",
      bottom: $hasFloatingDock ? "68px" : "12px",
      left: "12px",
      maxWidth: $fullWidth ? "calc(100% - 24px)" : "calc(100% - 190px)",
      width: $expanded ? "auto" : "max-content",
      zIndex: 90,
      display: "flex",
      flexDirection: "column",
      background: "var(--ms-surface-glass)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid var(--borderColor-default, var(--ms-border))",
      borderRadius: $expanded ? "10px" : "999px",
      boxShadow: `0 6px 24px rgba(0, 0, 0, ${$dark ? "0.4" : "0.14"})`,
      overflow: "hidden",
      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      ...style,
    }}
    {...rest}
  />
);

interface RibbonHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  $dark: boolean;
  $expanded: boolean;
}

const RibbonHeader: React.FC<RibbonHeaderProps> = ({ $dark: _dark, $expanded, style, ...rest }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: $expanded ? "6px 12px" : "5px 10px 5px 12px",
      cursor: "pointer",
      userSelect: "none",
      borderBottom: $expanded ? "1px solid var(--borderColor-muted, var(--ms-divider))" : "none",
      background: "var(--bgColor-muted, var(--ms-bg-elv))",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "var(--font-mono, monospace)",
      color: "var(--fgColor-default, var(--ms-text-1))",
      ...style,
    }}
    {...rest}
  />
);

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  $dark: boolean;
}

const Badge: React.FC<BadgeProps> = ({ $dark: _dark, style, ...rest }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--ms-brand-soft)",
      color: "var(--fgColor-accent, var(--ms-brand))",
      padding: "1px 6px",
      borderRadius: "10px",
      fontSize: "10px",
      marginLeft: "4px",
      ...style,
    }}
    {...rest}
  />
);

const SlidersTrack: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, style, ...rest }) => (
  <div
    className={className ? `ms-param-sliders-track ${className}` : "ms-param-sliders-track"}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "8px 12px",
      overflowX: "auto",
      overflowY: "hidden",
      scrollbarWidth: "thin",
      ...style,
    }}
    {...rest}
  />
);

interface DarkDivProps extends React.HTMLAttributes<HTMLDivElement> {
  $dark: boolean;
}

const SliderCard: React.FC<DarkDivProps> = ({ $dark, style, ...rest }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "136px",
      flexShrink: 0,
      padding: "6px 10px",
      borderRadius: "8px",
      background: $dark ? "rgba(33, 38, 45, 0.7)" : "rgba(246, 248, 250, 0.7)",
      border: `1px solid ${$dark ? "rgba(48, 54, 61, 0.5)" : "rgba(208, 215, 222, 0.5)"}`,
      ...style,
    }}
    {...rest}
  />
);

const CardTop: React.FC<DarkDivProps> = ({ $dark, style, ...rest }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "var(--font-mono, monospace)",
      color: $dark ? "#f0f6fc" : "#1f2328",
      ...style,
    }}
    {...rest}
  />
);

interface ValueInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  $dark: boolean;
}

const ValueInput: React.FC<ValueInputProps> = ({ $dark, className, style, ...rest }) => (
  <input
    className={className ? `ms-param-value-input ${className}` : "ms-param-value-input"}
    style={{
      width: "54px",
      background: $dark ? "var(--bgColor-inset, #121214)" : "#ffffff",
      border: `1px solid ${$dark ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.8)"}`,
      borderRadius: "4px",
      padding: "1px 4px",
      fontSize: "11px",
      fontFamily: "var(--font-mono, monospace)",
      color: $dark ? "#f0f6fc" : "#1f2328",
      textAlign: "right",
      ...style,
    }}
    {...rest}
  />
);

const RangeInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ style, ...rest }) => (
  <input
    style={{
      width: "100%",
      height: "4px",
      borderRadius: "2px",
      accentColor: "#06b6d4",
      cursor: "pointer",
      margin: "6px 0 2px 0",
      ...style,
    }}
    {...rest}
  />
);

interface ResetButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  $dark: boolean;
}

const ResetButton: React.FC<ResetButtonProps> = ({ $dark, className, style, ...rest }) => (
  <button
    data-dark={$dark ? "true" : "false"}
    className={className ? `ms-param-reset-btn ${className}` : "ms-param-reset-btn"}
    style={{
      background: "none",
      border: "none",
      padding: "2px",
      cursor: "pointer",
      color: $dark ? "#8b949e" : "#656d76",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "4px",
      transition: "all 0.15s ease",
      ...style,
    }}
    {...rest}
  />
);

export const ParameterSliderRibbon: React.FC<ParameterSliderRibbonProps> = ({
  parameters,
  overrides,
  onChange,
  onReset,
  onSimulate,
  isSimulating = false,
  dark = true,
  hasFloatingDock = false,
  defaultExpanded = true,
  fullWidth = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleSliderChange = useCallback(
    (name: string, value: number) => {
      onChange(name, value);
    },
    [onChange],
  );

  if (parameters.length === 0) return null;

  const isAnsatzEditorRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/editor");
  const effectiveHasFloatingDock = Boolean(hasFloatingDock && !isAnsatzEditorRoute);

  return (
    <RibbonContainer
      $dark={dark}
      $expanded={isExpanded}
      $hasFloatingDock={effectiveHasFloatingDock}
      $fullWidth={fullWidth}
    >
      <RibbonHeader $dark={dark} $expanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span>🎛️ Parameters</span>
          <Badge $dark={dark}>{parameters.length}</Badge>
          {overrides.size > 0 && (
            <span
              style={{
                fontSize: "10px",
                color: dark ? "#22d3ee" : "#0891b2",
                marginLeft: 4,
              }}
            >
              • {overrides.size} edited
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onSimulate && (
            <button
              type="button"
              aria-live="polite"
              aria-busy={isSimulating}
              onClick={(e) => {
                e.stopPropagation();
                onSimulate();
              }}
              disabled={isSimulating}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "var(--ms-brand)",
                color: "#ffffff",
                border: "none",
                borderRadius: "999px",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
                opacity: isSimulating ? 0.6 : 1,
              }}
            >
              {isSimulating ? <SyncIcon className="spin" size={10} /> : <PlayIcon size={10} />}
              <span>{isSimulating ? "Simulating…" : "Run"}</span>
            </button>
          )}
          <span style={{ fontSize: "10px", opacity: 0.75 }}>{isExpanded ? "▼" : "▲"}</span>
        </div>
      </RibbonHeader>

      {isExpanded && (
        <SlidersTrack>
          {parameters.map((param) => {
            const currentVal = overrides.has(param.name) ? overrides.get(param.name)! : param.defaultValue;
            const isOverridden = overrides.has(param.name);

            // Compute slider bounds
            const base = param.defaultValue;
            let min = param.min ?? (base > 0 ? 0 : base < 0 ? base * 2 : -10);
            let max = param.max ?? (base > 0 ? base * 2.5 : base < 0 ? 0 : 10);
            if (min === max) {
              if (base === 0) {
                min = -10;
                max = 10;
              } else {
                min = base * 0.5;
                max = base * 1.5;
              }
            }
            if (min > currentVal) min = currentVal < 0 ? currentVal * 1.2 : currentVal * 0.8;
            if (max < currentVal) max = currentVal > 0 ? currentVal * 1.2 : currentVal * 0.8;

            const step =
              base === 0 && param.min === undefined && param.max === undefined ? 0.1 : (max - min) / 100 || 0.1;

            return (
              <SliderCard key={param.name} $dark={dark}>
                <CardTop $dark={dark}>
                  <span title={param.name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {param.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <ValueInput
                      $dark={dark}
                      type="number"
                      step={step}
                      value={currentVal}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) handleSliderChange(param.name, v);
                      }}
                    />
                    {param.unit && (
                      <span style={{ fontSize: "10px", color: dark ? "#8b949e" : "#656d76" }}>{param.unit}</span>
                    )}
                    {isOverridden && (
                      <ResetButton
                        $dark={dark}
                        type="button"
                        onClick={() => onReset(param.name)}
                        title="Reset to default"
                      >
                        <XIcon size={10} />
                      </ResetButton>
                    )}
                  </div>
                </CardTop>
                <RangeInput
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={currentVal}
                  onChange={(e) => handleSliderChange(param.name, parseFloat(e.target.value))}
                />
              </SliderCard>
            );
          })}
        </SlidersTrack>
      )}
    </RibbonContainer>
  );
};

export default ParameterSliderRibbon;
