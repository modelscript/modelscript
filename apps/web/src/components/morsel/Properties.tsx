// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ConflictManager,
  evaluatePropertyPredicate,
  validatePropertyValue,
  type PropertyChoice,
  type PropertyConflict,
  type PropertyFieldConfig,
  type PropertyGroupConfig,
  type PropertyTabConfig,
} from "@modelscript/diagram";
import {
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  InfoIcon,
  LocationIcon,
  RowsIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import { Textarea, TextInput, ToggleSwitch, useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnsatzSketchIcon } from "../icons";
import Spinner from "../Spinner";
import { ComponentIcon } from "./ComponentList";
import { formatChoiceLabel, isFormula, tryEvaluateFormula } from "./util/formula";
import type { Translations } from "./util/i18n";
import type { ComponentProperties, PropertyData } from "./util/lsp-bridge";

function formatUnit(unit: string): string {
  if (unit === "Ohm") return "Ω";
  return unit;
}

function formatDescription(desc?: string) {
  if (!desc) return null;
  const formulaMatch = desc.match(/^(.*?)\s*(\([a-zA-Z0-9_]+\s*=\s*[^)]+\))$/);
  if (formulaMatch) {
    return (
      <>
        <span>{formulaMatch[1]} </span>
        <code
          style={{
            fontSize: 10,
            padding: "1px 4px",
            borderRadius: "var(--ms-radius-sm, 3px)",
            background: "var(--ms-surface-hover, rgba(128,128,128,0.12))",
            color: "var(--ms-brand, var(--color-accent-fg))",
            fontFamily: "var(--ms-font-mono, monospace)",
          }}
        >
          {formulaMatch[2]}
        </code>
      </>
    );
  }
  return desc;
}

interface PropertiesWidgetProps {
  properties: ComponentProperties | null;
  isLoading?: boolean | undefined;
  context?: any;
  width?: number | undefined;
  onNameChange?: ((name: string) => void) | undefined;
  onDescriptionChange?: ((description: string) => void) | undefined;
  onParameterChange?: ((name: string, value: string) => void) | undefined;
  onClose?: (() => void) | undefined;
  translations: Translations;
  onLocateComponent?: ((name: string) => void) | undefined;
  onGoToSource?: ((name: string) => void) | undefined;
  onDuplicateComponent?: ((name: string) => void) | undefined;
  onDeleteComponent?: ((name: string) => void) | undefined;
}

function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  badge,
  action,
  children,
  className = "",
}: {
  title: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-bottom ${className}`}
      style={{ borderColor: "var(--ms-border, var(--color-border-muted))" }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          width: "100%",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--color-fg-muted)",
          fontSize: 12,
          fontWeight: 600,
          transition: "background 0.15s ease, color 0.15s ease",
          borderRadius: "var(--ms-radius-sm, 4px)",
          boxSizing: "border-box",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--ms-surface-hover, rgba(125, 125, 125, 0.06))";
          e.currentTarget.style.color = "var(--color-fg-default)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--color-fg-muted)";
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ChevronRightIcon
            size={14}
            style={{
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.18s cubic-bezier(0.2, 0, 0, 1)",
              flexShrink: 0,
            }}
          />
          <span>{title}</span>
          {badge}
        </span>
        {action && (
          <span
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {action}
          </span>
        )}
      </div>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

function ExpandedFormulaEditor({
  fieldName,
  value,
  onChange,
  onClose,
  unit,
  contextValues,
}: {
  fieldName: string;
  value: string;
  onChange: (val: string) => void;
  onClose?: () => void;
  unit?: string | undefined;
  contextValues?: Record<string, any> | undefined;
}) {
  const evalResult = useMemo(() => {
    return tryEvaluateFormula(value, contextValues);
  }, [value, contextValues]);

  const quickChips = [
    { label: "π", insert: "Modelica.Constants.pi" },
    { label: "sqrt()", insert: "sqrt(" },
    { label: "^2", insert: "^2" },
    { label: "if-then-else", insert: "if cond then a else b" },
    { label: "sin()", insert: "sin(" },
    { label: "cos()", insert: "cos(" },
  ];

  return (
    <div
      style={{
        marginTop: 6,
        padding: "8px 10px",
        borderRadius: "var(--ms-radius-sm, 6px)",
        background: "var(--color-canvas-subtle, var(--ms-bg-soft))",
        border: "1px solid var(--color-border-subtle, var(--ms-border))",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-default)" }}>
          Formula Editor <code style={{ fontSize: 10, color: "var(--ms-brand, #0891b2)" }}>{fieldName}</code>
        </span>
        {onClose && (
          <button
            type="button"
            aria-label="Close formula editor"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-fg-muted)",
              cursor: "pointer",
              padding: "1px 4px",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>

      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter mathematical formula, e.g. 2*Modelica.Constants.pi*f"
        style={{
          width: "100%",
          fontSize: 11,
          fontFamily: "var(--ms-font-mono, monospace)",
          padding: "4px 6px",
          borderRadius: "var(--ms-radius-sm, 4px)",
          border: "1px solid var(--color-border-default, var(--ms-border))",
          background: "var(--color-canvas-default)",
          color: "var(--color-fg-default)",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--color-fg-muted)", marginRight: 2 }}>Quick:</span>
        {quickChips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => {
              const insert = chip.insert;
              const next = value ? `${value} * ${insert}` : insert;
              onChange(next);
            }}
            style={{
              background: "transparent",
              border: "1px dashed var(--color-border-default, var(--ms-border))",
              borderRadius: 3,
              fontSize: 10,
              fontFamily: "var(--ms-font-mono, monospace)",
              color: "var(--color-fg-muted)",
              padding: "1px 5px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--ms-brand, #0891b2)";
              (e.currentTarget as HTMLElement).style.color = "var(--ms-brand, #0891b2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border-default, var(--ms-border))";
              (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
            }}
          >
            +{chip.label}
          </button>
        ))}
      </div>

      {evalResult && (
        <div style={{ fontSize: 11, fontFamily: "var(--ms-font-mono, monospace)", paddingTop: 2 }}>
          {evalResult.success ? (
            <span style={{ color: "var(--ms-brand, #0891b2)" }}>
              = <strong>{evalResult.formatted}</strong> {unit ? formatUnit(unit) : ""}{" "}
              <span style={{ fontSize: 10, opacity: 0.7 }}>(evaluated)</span>
            </span>
          ) : (
            <span style={{ color: "var(--color-attention-fg, #d97706)" }}>⚠ {evalResult.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ParameterRow({
  parameter,
  onParameterChange,
  contextValues,
  density = "comfortable",
}: {
  parameter: PropertyData;
  colorMode?: string | undefined;
  onParameterChange?: ((name: string, value: string) => void) | undefined;
  contextValues?: Record<string, any> | undefined;
  density?: "comfortable" | "compact" | undefined;
}) {
  const { value, unit, isBoolean } = parameter;
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isFormulaExpanded, setIsFormulaExpanded] = useState(false);
  const lastCommittedRef = useRef(value);
  const onParameterChangeRef = useRef(onParameterChange);
  onParameterChangeRef.current = onParameterChange;

  useEffect(() => {
    if (value !== localValue && value !== lastCommittedRef.current) {
      setLocalValue(value);
      lastCommittedRef.current = value;
      setIsSaving(false);
    }
  }, [value, parameter.name]);

  useEffect(() => {
    if (isBoolean) return; // Boolean toggle calls onParameterChange immediately via onClick
    if (localValue === lastCommittedRef.current || localValue === "-") {
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    const timeoutId = setTimeout(() => {
      lastCommittedRef.current = localValue;
      onParameterChangeRef.current?.(parameter.name, localValue);
      setIsSaving(false);
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [localValue, parameter.name, isBoolean]);

  const isNumeric = !isBoolean && !isNaN(parseFloat(localValue));
  const hasFormula = !isBoolean && isFormula(localValue);

  const formulaResult = useMemo(() => {
    if (hasFormula) {
      return tryEvaluateFormula(localValue, contextValues);
    }
    return null;
  }, [hasFormula, localValue, contextValues]);

  const handleLabelMouseDown = (e: React.MouseEvent) => {
    if (!isNumeric) return;
    const startVal = parseFloat(localValue);
    if (isNaN(startVal)) return;

    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let hasMoved = false;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!hasMoved && Math.abs(dx) > 2) {
        hasMoved = true;
        setIsScrubbing(true);
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
      }
      if (hasMoved) {
        const step = ev.shiftKey ? 10 : ev.altKey ? 0.01 : Math.abs(startVal) >= 10 ? 1 : 0.1;
        const nextVal = startVal + dx * step;
        const decimals = ev.altKey ? 3 : step < 1 ? 2 : Number.isInteger(startVal) ? 0 : 2;
        const factor = Math.pow(10, decimals);
        const formatted = String(Math.round(nextVal * factor) / factor);
        setLocalValue(formatted);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setIsScrubbing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const isChecked = localValue === "true";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: density === "compact" ? "3px 16px" : "6px 16px",
        cursor: "default",
      }}
      onMouseDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id={`param-label-${parameter.name}`}
          onMouseDown={handleLabelMouseDown}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            fontSize: density === "compact" ? 11 : 12,
            fontWeight: 500,
            color: isSaving || isScrubbing ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.15s ease",
            cursor: isNumeric ? "ew-resize" : "default",
            userSelect: isScrubbing ? "none" : undefined,
            display: "flex",
            alignItems: "center",
          }}
          title={
            (parameter.localizedName || parameter.description || parameter.name) +
            (isNumeric ? " (Drag horizontally to scrub value)" : "")
          }
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {parameter.localizedName || parameter.name}
          </span>
          {density === "compact" && parameter.localizedDescription && (
            <span
              title={parameter.localizedDescription}
              style={{
                display: "inline-flex",
                alignItems: "center",
                marginLeft: 4,
                color: "var(--color-fg-muted)",
                cursor: "help",
                flexShrink: 0,
              }}
            >
              <InfoIcon size={12} />
            </span>
          )}
          {isSaving && (
            <span
              style={{
                marginLeft: 4,
                fontSize: 10,
                color: "var(--ms-accent-cyan, #06b6d4)",
                fontWeight: 600,
              }}
            >
              •
            </span>
          )}
        </div>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
          {isBoolean ? (
            <ToggleSwitch
              size="small"
              statusLabelPosition="hidden"
              checked={isChecked}
              aria-labelledby={`param-label-${parameter.name}`}
              onClick={() => {
                const newVal = isChecked ? "false" : "true";
                setLocalValue(newVal);
                if (onParameterChange) {
                  onParameterChange(parameter.name, newVal);
                }
              }}
              onChange={() => {
                /* controlled via onClick */
              }}
            />
          ) : (
            <>
              <button
                type="button"
                title={isFormulaExpanded ? "Close formula editor" : "Formula editor (𝑓(𝑥))"}
                aria-label="Formula editor"
                onClick={() => setIsFormulaExpanded(!isFormulaExpanded)}
                style={{
                  background:
                    isFormulaExpanded || hasFormula ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))" : "transparent",
                  border: `1px solid ${isFormulaExpanded || hasFormula ? "var(--ms-brand, #0891b2)" : "var(--color-border-default, var(--ms-border))"}`,
                  borderRadius: "var(--ms-radius-sm, 4px)",
                  color: isFormulaExpanded || hasFormula ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                  cursor: "pointer",
                  padding: "1px 4px",
                  fontSize: 10,
                  fontStyle: "italic",
                  fontFamily: "var(--ms-font-mono, monospace)",
                  fontWeight: 600,
                  height: 24,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.15s ease",
                }}
              >
                𝑓(𝑥)
              </button>
              <TextInput
                size="small"
                value={localValue}
                onChange={(e) => {
                  e.stopPropagation();
                  setLocalValue(e.target.value);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    const num = parseFloat(localValue);
                    if (!isNaN(num)) {
                      e.preventDefault();
                      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
                      const nextNum = e.key === "ArrowUp" ? num + step : num - step;
                      const formatted = String(Math.round(nextNum * 1000) / 1000);
                      setLocalValue(formatted);
                    }
                  }
                }}
                onKeyUp={(e) => e.stopPropagation()}
                onBlur={() => {
                  if (localValue !== value && localValue !== "-" && onParameterChange) {
                    onParameterChange(parameter.name, localValue);
                  }
                }}
                trailingVisual={
                  unit
                    ? () => (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-fg-muted)",
                            fontFamily: "var(--ms-font-mono, monospace)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatUnit(unit)}
                        </span>
                      )
                    : undefined
                }
                style={{
                  width: 120,
                  height: 26,
                  fontSize: 12,
                  fontFamily: "var(--ms-font-mono, monospace)",
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Evaluated formula preview badge */}
      {!isFormulaExpanded && formulaResult?.success && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: "var(--ms-brand, #0891b2)",
            fontFamily: "var(--ms-font-mono, monospace)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ opacity: 0.7 }}>=</span>
          <strong>{formulaResult.formatted}</strong>
          {unit && <span style={{ opacity: 0.75 }}>{formatUnit(unit)}</span>}
          <span style={{ fontSize: 10, opacity: 0.65 }}>(evaluated)</span>
        </div>
      )}

      {/* Expanded formula editor */}
      {isFormulaExpanded && (
        <ExpandedFormulaEditor
          fieldName={parameter.localizedName || parameter.name}
          value={localValue}
          onChange={(newVal) => setLocalValue(newVal)}
          onClose={() => setIsFormulaExpanded(false)}
          unit={unit}
          contextValues={contextValues}
        />
      )}

      {density !== "compact" && parameter.localizedDescription && (
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            lineHeight: 1.35,
            color: "var(--color-fg-muted)",
            opacity: 0.8,
            wordBreak: "break-word",
          }}
        >
          {formatDescription(parameter.localizedDescription)}
        </div>
      )}
    </div>
  );
}

function SchemaFieldRow({
  field,
  currentValue,
  contextValues,
  conflict,
  onParameterChange,
  onResolveConflict,
  density = "comfortable",
}: {
  field: any;
  currentValue: any;
  contextValues: Record<string, any>;
  conflict?: PropertyConflict | null | undefined;
  onParameterChange?: ((name: string, value: string) => void) | undefined;
  onResolveConflict?: ((resolution: "keep_local" | "accept_remote") => void) | undefined;
  density?: "comfortable" | "compact" | undefined;
}) {
  const isEnabled = evaluatePropertyPredicate(field.enabledIf, contextValues) && !field.readOnly;
  const initialValStr = String(currentValue ?? field.defaultValue ?? "");
  const [localVal, setLocalVal] = useState<string>(initialValStr);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormulaExpanded, setIsFormulaExpanded] = useState(false);
  const lastCommittedRef = useRef<string>(initialValStr);
  const onParameterChangeRef = useRef(onParameterChange);
  onParameterChangeRef.current = onParameterChange;

  useEffect(() => {
    const nextVal = String(currentValue ?? field.defaultValue ?? "");
    if (nextVal !== localVal && nextVal !== lastCommittedRef.current) {
      setLocalVal(nextVal);
      lastCommittedRef.current = nextVal;
      setIsSaving(false);
    }
  }, [currentValue, field.defaultValue]);

  useEffect(() => {
    if (field.kind === "boolean") return;
    if (localVal === "-" || localVal === lastCommittedRef.current) {
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    const timeout = setTimeout(() => {
      lastCommittedRef.current = localVal;
      onParameterChangeRef.current?.(field.key, localVal);
      setIsSaving(false);
    }, 200);
    return () => clearTimeout(timeout);
  }, [localVal, field.key, field.kind]);

  const validationErr = validatePropertyValue(field, localVal, contextValues);
  const unitStr = field.unit ? formatUnit(field.unit) : undefined;
  const defaultValueStr =
    field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : "";
  const isOverridden = localVal !== "" && localVal !== "-" && defaultValueStr !== "" && localVal !== defaultValueStr;

  const isNumberField = field.kind === "number";
  const [isScrubbing, setIsScrubbing] = useState(false);

  const canHaveFormula = field.kind !== "boolean" && field.kind !== "choice" && field.kind !== "color";
  const hasFormula = canHaveFormula && isFormula(localVal);
  const formulaResult = useMemo(() => {
    if (hasFormula) {
      return tryEvaluateFormula(localVal, contextValues);
    }
    return null;
  }, [hasFormula, localVal, contextValues]);

  const handleLabelMouseDown = (e: React.MouseEvent) => {
    if (!isNumberField || !isEnabled) return;
    const startVal = parseFloat(localVal);
    if (isNaN(startVal)) return;

    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let hasMoved = false;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!hasMoved && Math.abs(dx) > 2) {
        hasMoved = true;
        setIsScrubbing(true);
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
      }
      if (hasMoved) {
        const step = ev.shiftKey ? 10 : ev.altKey ? 0.01 : Math.abs(startVal) >= 10 ? 1 : 0.1;
        const nextVal = startVal + dx * step;
        const decimals = ev.altKey ? 3 : step < 1 ? 2 : Number.isInteger(startVal) ? 0 : 2;
        const factor = Math.pow(10, decimals);
        const formatted = String(Math.round(nextVal * factor) / factor);
        setLocalVal(formatted);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setIsScrubbing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalVal(defaultValueStr);
    onParameterChange?.(field.key, defaultValueStr);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: density === "compact" ? "3px 16px" : "6px 16px",
        opacity: isEnabled ? 1 : 0.45,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          {isOverridden && (
            <span
              title={`Modified from default (${defaultValueStr})`}
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "var(--ms-brand, #0891b2)",
                boxShadow: "0 0 4px var(--ms-brand, #0891b2)",
                marginRight: 6,
                flexShrink: 0,
              }}
            />
          )}
          <label
            id={`schema-field-${field.key}`}
            onMouseDown={handleLabelMouseDown}
            style={{
              fontSize: density === "compact" ? 11 : 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color:
                isSaving || isScrubbing
                  ? "var(--ms-brand, #0891b2)"
                  : isOverridden
                    ? "var(--color-fg-default)"
                    : "var(--color-fg-muted)",
              fontWeight: isOverridden ? 600 : 400,
              transition: "color 0.15s ease",
              cursor: isNumberField && isEnabled ? "ew-resize" : "default",
              userSelect: isScrubbing ? "none" : undefined,
              display: "flex",
              alignItems: "center",
            }}
            title={
              (field.description || field.label || field.key) +
              (isNumberField && isEnabled ? " (Drag horizontally to scrub value)" : "")
            }
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {field.label || field.key}
            </span>
            {density === "compact" && field.description && (
              <span
                title={field.description}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginLeft: 4,
                  color: "var(--color-fg-muted)",
                  cursor: "help",
                  flexShrink: 0,
                }}
              >
                <InfoIcon size={12} />
              </span>
            )}
            {isSaving && (
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  color: "var(--ms-accent-cyan, #06b6d4)",
                  fontWeight: 600,
                }}
              >
                •
              </span>
            )}
          </label>
        </div>

        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
          {isOverridden && (
            <button
              type="button"
              title={`Revert to default (${defaultValueStr})`}
              aria-label={`Revert ${field.label || field.key} to default`}
              onClick={handleReset}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: "12px",
                color: "var(--color-fg-muted)",
                lineHeight: 1,
                borderRadius: "var(--ms-radius-sm, 4px)",
                transition: "color 0.15s ease",
              }}
            >
              ↺
            </button>
          )}

          {field.kind === "boolean" ? (
            <ToggleSwitch
              size="small"
              statusLabelPosition="hidden"
              aria-labelledby={`schema-field-${field.key}`}
              checked={localVal === "true" || localVal === "1"}
              disabled={!isEnabled}
              onClick={() => {
                if (!isEnabled) return;
                const next = localVal === "true" || localVal === "1" ? "false" : "true";
                setLocalVal(next);
                onParameterChange?.(field.key, next);
              }}
              onChange={() => {}}
            />
          ) : field.kind === "choice" && Array.isArray(field.choices) ? (
            <select
              value={localVal}
              disabled={!isEnabled}
              onChange={(e) => {
                setLocalVal(e.target.value);
                onParameterChange?.(field.key, e.target.value);
              }}
              style={{
                width: 130,
                height: 26,
                fontSize: 12,
                borderRadius: "var(--ms-radius-sm, 6px)",
                border: "1px solid var(--color-border-default, var(--ms-border))",
                background: "var(--color-canvas-subtle, var(--ms-bg-soft))",
                color: "var(--color-fg-default)",
                padding: "2px 6px",
                fontFamily: "inherit",
              }}
            >
              {field.choices.map((c: PropertyChoice | string) => {
                const val = typeof c === "string" ? c : c.value;
                const rawLbl = typeof c === "string" ? c : c.label;
                const lbl = formatChoiceLabel(rawLbl, val);
                return (
                  <option key={val} value={val} title={val}>
                    {lbl}
                  </option>
                );
              })}
            </select>
          ) : field.kind === "color" ? (
            <input
              type="color"
              value={localVal || "#000000"}
              disabled={!isEnabled}
              onChange={(e) => {
                setLocalVal(e.target.value);
                onParameterChange?.(field.key, e.target.value);
              }}
              style={{
                width: 40,
                height: 26,
                padding: 2,
                borderRadius: "var(--ms-radius-sm, 4px)",
                border: "1px solid var(--color-border-default, var(--ms-border))",
                background: "transparent",
                cursor: isEnabled ? "pointer" : "not-allowed",
              }}
            />
          ) : field.kind === "codeBlock" ? (
            <pre
              style={{
                maxHeight: 120,
                overflow: "auto",
                fontSize: 11,
                padding: "4px 8px",
                background: "var(--color-canvas-subtle, var(--ms-bg-soft))",
                border: "1px solid var(--color-border-subtle, var(--ms-border))",
                color: "var(--color-fg-default)",
                fontFamily: "var(--ms-font-mono, monospace)",
                borderRadius: "var(--ms-radius-sm, 4px)",
                width: "100%",
              }}
            >
              {localVal}
            </pre>
          ) : (
            <>
              {canHaveFormula && (
                <button
                  type="button"
                  title={isFormulaExpanded ? "Close formula editor" : "Formula editor (𝑓(𝑥))"}
                  aria-label="Formula editor"
                  onClick={() => setIsFormulaExpanded(!isFormulaExpanded)}
                  style={{
                    background:
                      isFormulaExpanded || hasFormula ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))" : "transparent",
                    border: `1px solid ${isFormulaExpanded || hasFormula ? "var(--ms-brand, #0891b2)" : "var(--color-border-default, var(--ms-border))"}`,
                    borderRadius: "var(--ms-radius-sm, 4px)",
                    color: isFormulaExpanded || hasFormula ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                    cursor: "pointer",
                    padding: "1px 4px",
                    fontSize: 10,
                    fontStyle: "italic",
                    fontFamily: "var(--ms-font-mono, monospace)",
                    fontWeight: 600,
                    height: 24,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease",
                  }}
                >
                  𝑓(𝑥)
                </button>
              )}
              <TextInput
                size="small"
                type="text"
                inputMode={field.kind === "number" ? "decimal" : undefined}
                disabled={!isEnabled}
                value={localVal}
                onChange={(e) => setLocalVal(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  } else if (field.kind === "number" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    const num = parseFloat(localVal);
                    if (!isNaN(num)) {
                      e.preventDefault();
                      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
                      const nextNum = e.key === "ArrowUp" ? num + step : num - step;
                      const formatted = String(Math.round(nextNum * 1000) / 1000);
                      setLocalVal(formatted);
                    }
                  }
                }}
                onBlur={() => {
                  if (localVal !== "-" && localVal !== lastCommittedRef.current) {
                    lastCommittedRef.current = localVal;
                    onParameterChangeRef.current?.(field.key, localVal);
                    setIsSaving(false);
                  }
                }}
                trailingVisual={
                  unitStr
                    ? () => (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-fg-muted)",
                            fontFamily: "var(--ms-font-mono, monospace)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {unitStr}
                        </span>
                      )
                    : undefined
                }
                style={{
                  width: 130,
                  height: 26,
                  fontSize: 12,
                  fontFamily: field.kind === "number" ? "var(--ms-font-mono, monospace)" : "inherit",
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Evaluated formula preview badge */}
      {!isFormulaExpanded && formulaResult?.success && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: "var(--ms-brand, #0891b2)",
            fontFamily: "var(--ms-font-mono, monospace)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ opacity: 0.7 }}>=</span>
          <strong>{formulaResult.formatted}</strong>
          {unitStr && <span style={{ opacity: 0.75 }}>{unitStr}</span>}
          <span style={{ fontSize: 10, opacity: 0.65 }}>(evaluated)</span>
        </div>
      )}

      {/* Expanded formula editor */}
      {isFormulaExpanded && (
        <ExpandedFormulaEditor
          fieldName={field.label || field.key}
          value={localVal}
          onChange={(newVal) => setLocalVal(newVal)}
          onClose={() => setIsFormulaExpanded(false)}
          unit={unitStr}
          contextValues={contextValues}
        />
      )}

      {conflict && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            background: "var(--ms-status-fail-bg, rgba(225, 29, 72, 0.12))",
            border: "1px solid var(--ms-status-fail-border, var(--ms-danger, #e11d48))",
            borderRadius: "var(--ms-radius-sm, 4px)",
            padding: "4px 8px",
            marginTop: 4,
            fontSize: 11,
            color: "var(--color-fg-default)",
          }}
        >
          <span>
            ⚡ External change: <strong>{conflict.remoteValue}</strong>
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={() => onResolveConflict?.("keep_local")}
              style={{
                background: "transparent",
                border: "1px solid var(--ms-status-fail-border, var(--ms-danger, #e11d48))",
                borderRadius: 3,
                color: "var(--color-fg-default)",
                fontSize: 10,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              Keep Mine ({conflict.localValue})
            </button>
            <button
              type="button"
              onClick={() => onResolveConflict?.("accept_remote")}
              style={{
                background: "transparent",
                border: "1px solid var(--ms-status-fail-border, var(--ms-danger, #e11d48))",
                borderRadius: 3,
                color: "var(--color-fg-default)",
                fontSize: 10,
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              Use {conflict.remoteValue}
            </button>
          </div>
        </div>
      )}
      {validationErr && (
        <div style={{ color: "var(--ms-danger, #e11d48)", fontSize: 11, marginTop: 2 }}>{validationErr}</div>
      )}
      {density !== "compact" && field.description && (
        <div
          className="f6 color-fg-muted"
          style={{ marginTop: 2, fontSize: 11, lineHeight: 1.35, opacity: 0.75, wordBreak: "break-word" }}
        >
          {formatDescription(field.description)}
        </div>
      )}
    </div>
  );
}

export default function PropertiesWidget(props: PropertiesWidgetProps) {
  const { colorMode } = useTheme();
  const { properties, isLoading, onNameChange, onDescriptionChange, onParameterChange, translations } = props;
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    info: true,
    parameters: true,
    documentation: true,
    revisions: true,
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  type DensityMode = "comfortable" | "compact";
  const [density, setDensity] = useState<DensityMode>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("ms-properties-density");
      if (saved === "compact" || saved === "comfortable") return saved;
    }
    return "comfortable";
  });

  const toggleDensity = useCallback(() => {
    setDensity((prev) => {
      const next = prev === "comfortable" ? "compact" : "comfortable";
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("ms-properties-density", next);
      }
      return next;
    });
  }, []);

  const [onlyModified, setOnlyModified] = useState(false);

  const [localName, setLocalName] = useState(properties?.name || "");
  const [localDescription, setLocalDescription] = useState(properties?.description || "");
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const lastCommittedNameRef = useRef(properties?.name || "");
  const lastCommittedDescRef = useRef(properties?.description || "");
  const onNameChangeRef = useRef(onNameChange);
  onNameChangeRef.current = onNameChange;
  const onDescriptionChangeRef = useRef(onDescriptionChange);
  onDescriptionChangeRef.current = onDescriptionChange;

  useEffect(() => {
    setLocalName(properties?.name || "");
    lastCommittedNameRef.current = properties?.name || "";
    setLocalDescription(properties?.description || "");
    lastCommittedDescRef.current = properties?.description || "";
    setDescriptionEditing(false);
  }, [properties?.name, properties?.description]);

  useEffect(() => {
    if (!localName || localName === lastCommittedNameRef.current) return;

    const timeoutId = setTimeout(() => {
      lastCommittedNameRef.current = localName;
      onNameChangeRef.current?.(localName);
    }, 60);

    return () => clearTimeout(timeoutId);
  }, [localName]);

  useEffect(() => {
    if (localDescription === lastCommittedDescRef.current) return;

    const timeoutId = setTimeout(() => {
      lastCommittedDescRef.current = localDescription;
      onDescriptionChangeRef.current?.(localDescription);
    }, 60);

    return () => clearTimeout(timeoutId);
  }, [localDescription]);

  // Optimistic local values map with 3-way bidirectional conflict management
  const conflictMgrRef = useRef<ConflictManager>(new ConflictManager());
  const [, setConflictVersion] = useState(0);
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(() => properties?.values || {});
  const [filterText, setFilterText] = useState("");

  const isFieldModified = useCallback((fld: PropertyFieldConfig, values: Record<string, unknown>): boolean => {
    const cur = values[fld.key];
    if (cur === undefined || cur === null || cur === "") return false;
    if (fld.defaultValue !== undefined && fld.defaultValue !== null) {
      return String(cur) !== String(fld.defaultValue);
    }
    return true;
  }, []);

  const isParamModified = useCallback((param: PropertyData): boolean => {
    return param.value !== undefined && param.value !== "" && param.value !== "-";
  }, []);

  useEffect(() => {
    conflictMgrRef.current.reset(properties?.values || {});
    setConflictVersion(0);
  }, [properties?.name]);

  const prevRemoteValuesRef = useRef<string>("");
  useEffect(() => {
    if (properties?.values) {
      const remote: Record<string, string> = {};
      for (const [k, v] of Object.entries(properties.values)) {
        remote[k] = String(v ?? "");
      }
      const serialized = JSON.stringify(remote);
      if (serialized === prevRemoteValuesRef.current) return;
      prevRemoteValuesRef.current = serialized;

      conflictMgrRef.current.syncRemote(remote);
      setLocalValues({ ...conflictMgrRef.current.getLocalValues() });
      setConflictVersion((v) => v + 1);
    }
  }, [properties?.values]);

  const handleParameterChangeWrapper = useCallback(
    (name: string, val: string) => {
      conflictMgrRef.current.recordLocalChange(name, val);
      setLocalValues((prev) => ({ ...prev, [name]: val }));
      setConflictVersion((v) => v + 1);
      onParameterChange?.(name, val);
    },
    [onParameterChange],
  );

  // Live icon SVG that immediately updates matching parameter labels in the icon preview
  const liveIconSvg = useMemo(() => {
    const rawSvg = properties?.iconSvg;
    const propName = properties?.name;
    if (!rawSvg) return "";
    let svg = rawSvg;
    for (const [key, val] of Object.entries(localValues)) {
      if (val !== undefined && val !== "") {
        const regex = new RegExp(`(<text[^>]*>\\s*${key}\\s*=\\s*)([^<]+)(</text>)`, "gi");
        svg = svg.replace(regex, `$1${val}$3`);
      }
    }
    if (localName && propName) {
      const nameRegex = new RegExp(`(<text[^>]*>\\s*)${propName}(\\s*</text>)`, "gi");
      svg = svg.replace(nameRegex, `$1${localName}$2`);
    }
    return svg;
  }, [properties?.iconSvg, properties?.name, localValues, localName]);

  // Schema tabs management
  const schema = properties?.schema;
  const visibleTabs = (schema?.tabs || []).filter((t: PropertyTabConfig) =>
    evaluatePropertyPredicate(t.visibleIf, localValues),
  );
  const [activeTabId, setActiveTabId] = useState<string>(visibleTabs[0]?.id || "");

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t: PropertyTabConfig) => t.id === activeTabId)) {
      setActiveTabId(visibleTabs[0]!.id);
    }
  }, [visibleTabs, activeTabId]);

  if (isLoading && !properties) {
    return (
      <div
        className="height-full border-left d-flex flex-column flex-items-center flex-justify-center p-4"
        style={{
          width: props.width || 300,
          minHeight: 240,
          backgroundColor: "var(--color-canvas-default)",
          color: "var(--color-fg-muted)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Spinner size="medium" />
        <span style={{ marginTop: 12, fontSize: 12, fontWeight: 500 }}>Loading properties…</span>
      </div>
    );
  }

  if (!properties) {
    return (
      <div
        className="height-full border-left d-flex flex-column flex-items-center flex-justify-center p-4 text-center"
        style={{
          width: props.width || 300,
          backgroundColor: "var(--color-canvas-default)",
          color: "var(--color-fg-muted)",
          userSelect: "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            backgroundColor: "var(--color-canvas-subtle, var(--ms-bg-soft))",
            border: "1px solid var(--color-border-subtle, var(--ms-border))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            color: "var(--ms-brand, #0891b2)",
          }}
        >
          <AnsatzSketchIcon size={24} variant="triangle" />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg-default)", marginBottom: 6 }}>
          {translations.noComponentSelected}
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, maxWidth: 220 }}>
          Click any component or connection in the schematic diagram to inspect and edit its parameters.
        </p>
      </div>
    );
  }

  const parameters = properties.parameters || [];
  const doc = properties.documentation;

  const processHtml = (html: string | undefined) => {
    if (!html) return "";
    const context = props.context;
    if (!context) return html;

    return html.replace(/<img\s+[^>]*src=(["'])modelica:\/\/([^"']+)\1[^>]*>/gi, (match, _quote, uriPath) => {
      const uri = `modelica://${uriPath}`;
      const resolvedPath = context.resolveURI(uri);
      if (resolvedPath) {
        try {
          const binary = context.fs.readBinary(resolvedPath);
          const chunks: string[] = [];
          const chunkSize = 8192;
          for (let i = 0; i < binary.length; i += chunkSize) {
            chunks.push(String.fromCharCode(...binary.subarray(i, i + chunkSize)));
          }
          const base64 = btoa(chunks.join(""));
          const ext = context.fs.extname(resolvedPath).toLowerCase().substring(1);
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
          return match.replace(`modelica://${uriPath}`, `data:${mimeType};base64,${base64}`);
        } catch (e) {
          console.warn(`Failed to read image ${uri}:`, e);
        }
      }
      return match.replace(/src=(["'])modelica:\/\/[^"']+\1/, 'style="display:none"');
    });
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const activeTab = visibleTabs.find((t: any) => t.id === activeTabId) || visibleTabs[0];

  const quickActionBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid var(--color-border-default, var(--ms-border))",
    borderRadius: "var(--ms-radius-sm, 4px)",
    color: "var(--color-fg-muted)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    fontSize: 11,
    transition: "all 0.15s ease",
  };

  return (
    <div
      className="height-full overflow-auto border-left"
      style={{ width: props.width || 300, paddingBottom: 80 }}
      onClick={(e) => e.stopPropagation()}
    >
      <CollapsibleSection
        title={translations.information}
        isOpen={expandedSections.info}
        onToggle={() => toggleSection("info")}
        className="mb-2"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              title={`Density: ${density === "compact" ? "Compact (click for Comfortable)" : "Comfortable (click for Compact)"}`}
              aria-label="Toggle density"
              onClick={(e) => {
                e.stopPropagation();
                toggleDensity();
              }}
              style={{
                background:
                  density === "compact" ? "var(--ms-surface-hover, rgba(125, 125, 125, 0.15))" : "transparent",
                border: "none",
                color: density === "compact" ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: "var(--ms-radius-sm, 4px)",
                transition: "all 0.15s ease",
              }}
            >
              <RowsIcon size={13} />
            </button>
            {props.onClose && (
              <button
                type="button"
                aria-label="Close properties panel"
                title="Close properties panel (Esc)"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onClose?.();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: "var(--ms-radius-sm, 4px)",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--color-action-list-item-default-hover-bg, var(--ms-surface-hover, rgba(125, 125, 125, 0.1)))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", padding: "8px 16px", gap: "10px" }}>
          <div style={{ display: "flex", flexDirection: "row", gap: "16px", alignItems: "center" }}>
            {(liveIconSvg || properties.iconSvg) && (
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 6,
                  borderRadius: "var(--ms-radius-sm, 8px)",
                  backgroundColor: "var(--color-canvas-subtle, var(--ms-bg-soft))",
                  border: "1px solid var(--color-border-subtle, var(--ms-border))",
                }}
              >
                <ComponentIcon iconSvg={liveIconSvg || properties.iconSvg} size={64} darkMode={colorMode === "dark"} />
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                overflow: "hidden",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <div style={{ padding: "2px 0" }}>
                <div className="f6 color-fg-muted" style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>
                  {translations.type}
                </div>
                <div
                  style={{
                    wordBreak: "break-all",
                    fontSize: 11,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    fontWeight: 600,
                    color: "var(--ms-brand, #0891b2)",
                    backgroundColor: "var(--ms-brand-soft, rgba(8, 145, 178, 0.1))",
                    border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 25%, transparent)",
                    padding: "2px 6px",
                    borderRadius: "var(--ms-radius-sm, 4px)",
                    display: "inline-block",
                  }}
                >
                  {properties.localizedClassName || properties.className}
                </div>
              </div>
              <div>
                <div className="f6 color-fg-muted" style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>
                  {translations.name}
                </div>
                <TextInput
                  size="small"
                  block
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={() => {
                    if (localName !== properties.name && onNameChange) {
                      onNameChange(localName);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  style={{
                    width: "100%",
                    height: 26,
                    fontSize: 12,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    fontWeight: 600,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Quick action buttons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingTop: 6,
              borderTop: "1px solid var(--color-border-subtle, var(--ms-border))",
              flexWrap: "wrap",
            }}
          >
            {props.onLocateComponent && (
              <button
                type="button"
                title="Locate component on schematic"
                aria-label="Locate on schematic"
                onClick={() => props.onLocateComponent?.(properties.name)}
                style={quickActionBtnStyle}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-default)";
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--ms-surface-hover, rgba(125,125,125,0.08))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <LocationIcon size={13} />
                <span>Locate</span>
              </button>
            )}
            {props.onGoToSource && (
              <button
                type="button"
                title="Go to declaration in Modelica source"
                aria-label="Go to source"
                onClick={() => props.onGoToSource?.(properties.name)}
                style={quickActionBtnStyle}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-default)";
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--ms-surface-hover, rgba(125,125,125,0.08))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <CodeIcon size={13} />
                <span>Source</span>
              </button>
            )}
            {props.onDuplicateComponent && (
              <button
                type="button"
                title="Duplicate component"
                aria-label="Duplicate component"
                onClick={() => props.onDuplicateComponent?.(properties.name)}
                style={quickActionBtnStyle}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-default)";
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--ms-surface-hover, rgba(125,125,125,0.08))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <CopyIcon size={13} />
                <span>Duplicate</span>
              </button>
            )}
            {props.onDeleteComponent && (
              <button
                type="button"
                title="Delete component"
                aria-label="Delete component"
                onClick={() => props.onDeleteComponent?.(properties.name)}
                style={quickActionBtnStyle}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--ms-danger, #e11d48)";
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--ms-danger, #e11d48)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border-default, var(--ms-border))";
                }}
              >
                <TrashIcon size={13} />
                <span>Delete</span>
              </button>
            )}
          </div>

          {localDescription || descriptionEditing ? (
            <div>
              <div className="f6 color-fg-muted" style={{ fontSize: 11, marginBottom: 2 }}>
                {translations.description}
              </div>
              <Textarea
                block
                autoFocus={descriptionEditing && !localDescription}
                value={localDescription}
                onChange={(e) => setLocalDescription(e.target.value)}
                onBlur={() => {
                  if (!localDescription) {
                    setDescriptionEditing(false);
                    if (properties.description && onDescriptionChange) {
                      onDescriptionChange("");
                    }
                  } else if (localDescription !== (properties.description || "") && onDescriptionChange) {
                    onDescriptionChange(localDescription);
                  }
                }}
                rows={3}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: "6px",
                  borderRadius: "var(--ms-radius-sm, 6px)",
                }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
              <button
                type="button"
                onClick={() => setDescriptionEditing(true)}
                style={{
                  background: "transparent",
                  border: "1px dashed var(--color-border-default, var(--ms-border))",
                  borderRadius: "var(--ms-radius-sm, 6px)",
                  padding: "4px 12px",
                  fontSize: 11,
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--color-action-list-item-default-hover-bg, var(--ms-surface-hover, rgba(125, 125, 125, 0.08)))";
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-default)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--color-fg-muted)";
                }}
              >
                + {translations.addDescription || "Add description"}
              </button>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Schema-driven Tabs & Groups */}
      {visibleTabs.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {/* Tab Navigation */}
          <div
            style={{
              display: "flex",
              gap: 4,
              borderBottom: "1px solid var(--color-border-default, var(--ms-border))",
              padding: "0 12px",
              overflowX: "auto",
            }}
          >
            {visibleTabs.map((t: any) => {
              const isActive = t.id === activeTab?.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTabId(t.id)}
                  style={{
                    padding: "6px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: isActive ? "2px solid var(--ms-brand, #0891b2)" : "2px solid transparent",
                    color: isActive ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    transition: "all 0.15s ease",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Active Tab Groups */}
          {activeTab && (
            <div style={{ paddingBottom: 8 }}>
              {(() => {
                const activeGroups = (activeTab.groups || []).filter((grp: PropertyGroupConfig) =>
                  evaluatePropertyPredicate(grp.visibleIf, localValues),
                );
                const totalFieldsInActiveTab = activeGroups.reduce(
                  (acc: number, grp: PropertyGroupConfig) =>
                    acc +
                    (grp.fields || []).filter((fld: PropertyFieldConfig) =>
                      evaluatePropertyPredicate(fld.visibleIf, localValues),
                    ).length,
                  0,
                );

                return (
                  <>
                    {totalFieldsInActiveTab > 4 && (
                      <div style={{ padding: "8px 16px 4px 16px", display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <TextInput
                            size="small"
                            block
                            leadingVisual={SearchIcon}
                            placeholder="Filter parameters..."
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            trailingAction={
                              filterText ? (
                                <TextInput.Action
                                  icon={XIcon}
                                  aria-label="Clear filter"
                                  onClick={() => setFilterText("")}
                                />
                              ) : undefined
                            }
                            style={{ fontSize: 11, height: 26 }}
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Filter modified parameters only"
                          title={onlyModified ? "Show all parameters" : "Show modified parameters only"}
                          onClick={() => setOnlyModified(!onlyModified)}
                          style={{
                            flexShrink: 0,
                            height: 26,
                            padding: "0 8px",
                            fontSize: 11,
                            fontWeight: onlyModified ? 600 : 500,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            borderRadius: "var(--ms-radius-sm, 6px)",
                            border: `1px solid ${onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-border-default, var(--ms-border))"}`,
                            background: onlyModified ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))" : "transparent",
                            color: onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                            }}
                          />
                          <span>Modified</span>
                        </button>
                      </div>
                    )}

                    {activeGroups.map((grp: PropertyGroupConfig) => {
                      const visibleFields = (grp.fields || [])
                        .filter((fld: PropertyFieldConfig) => evaluatePropertyPredicate(fld.visibleIf, localValues))
                        .filter((fld: PropertyFieldConfig) => {
                          if (onlyModified && !isFieldModified(fld, localValues)) return false;
                          if (!filterText) return true;
                          const q = filterText.toLowerCase();
                          return (
                            fld.key.toLowerCase().includes(q) ||
                            (fld.label && fld.label.toLowerCase().includes(q)) ||
                            (fld.description && fld.description.toLowerCase().includes(q))
                          );
                        });

                      if (visibleFields.length === 0 && (filterText || onlyModified)) return null;

                      const isGrpOpen = openGroups[grp.id] ?? true;
                      return (
                        <CollapsibleSection
                          key={grp.id}
                          title={grp.label}
                          isOpen={isGrpOpen}
                          onToggle={() =>
                            setOpenGroups((prev) => ({
                              ...prev,
                              [grp.id]: !isGrpOpen,
                            }))
                          }
                        >
                          <div style={{ paddingBottom: 8 }}>
                            {visibleFields.map((fld: PropertyFieldConfig) => (
                              <SchemaFieldRow
                                key={fld.key}
                                field={fld}
                                currentValue={localValues[fld.key] ?? fld.defaultValue}
                                contextValues={localValues}
                                conflict={conflictMgrRef.current.getConflict(fld.key)}
                                onParameterChange={handleParameterChangeWrapper}
                                onResolveConflict={(resolution) => {
                                  const chosenValue = conflictMgrRef.current.resolveConflict(fld.key, resolution);
                                  setLocalValues((prev) => ({ ...prev, [fld.key]: chosenValue }));
                                  setConflictVersion((v) => v + 1);
                                  onParameterChange?.(fld.key, chosenValue);
                                }}
                                density={density}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ) : (
        /* Legacy flat parameters fallback */
        parameters.length > 0 && (
          <CollapsibleSection
            title={translations.parameters}
            isOpen={expandedSections.parameters}
            onToggle={() => toggleSection("parameters")}
            badge={
              <span
                style={{
                  marginLeft: 2,
                  fontSize: 10,
                  fontFamily: "var(--ms-font-mono, monospace)",
                  padding: "1px 5px",
                  borderRadius: 999,
                  background: "var(--ms-surface-hover, rgba(128,128,128,0.12))",
                  color: "var(--color-fg-muted)",
                }}
              >
                {parameters.length}
              </span>
            }
          >
            {parameters.length > 4 && (
              <div style={{ padding: "4px 16px 8px 16px", display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    size="small"
                    block
                    leadingVisual={SearchIcon}
                    placeholder="Filter parameters..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    trailingAction={
                      filterText ? (
                        <TextInput.Action icon={XIcon} aria-label="Clear filter" onClick={() => setFilterText("")} />
                      ) : undefined
                    }
                    style={{ fontSize: 11, height: 26 }}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Filter modified parameters only"
                  title={onlyModified ? "Show all parameters" : "Show modified parameters only"}
                  onClick={() => setOnlyModified(!onlyModified)}
                  style={{
                    flexShrink: 0,
                    height: 26,
                    padding: "0 8px",
                    fontSize: 11,
                    fontWeight: onlyModified ? 600 : 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    borderRadius: "var(--ms-radius-sm, 6px)",
                    border: `1px solid ${onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-border-default, var(--ms-border))"}`,
                    background: onlyModified ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))" : "transparent",
                    color: onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: onlyModified ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
                    }}
                  />
                  <span>Modified</span>
                </button>
              </div>
            )}
            <div style={{ paddingBottom: 8 }}>
              {parameters
                .filter((p) => {
                  if (onlyModified && !isParamModified(p)) return false;
                  if (!filterText) return true;
                  const q = filterText.toLowerCase();
                  return (
                    p.name.toLowerCase().includes(q) ||
                    (p.localizedName && p.localizedName.toLowerCase().includes(q)) ||
                    (p.description && p.description.toLowerCase().includes(q))
                  );
                })
                .map((parameter) => (
                  <ParameterRow
                    key={parameter.name}
                    parameter={parameter}
                    colorMode={colorMode}
                    onParameterChange={handleParameterChangeWrapper}
                    contextValues={localValues}
                    density={density}
                  />
                ))}
            </div>
          </CollapsibleSection>
        )
      )}

      {doc?.info && (
        <CollapsibleSection
          title={translations.documentation}
          isOpen={expandedSections.documentation}
          onToggle={() => toggleSection("documentation")}
        >
          <div
            className="markdown-body p-3"
            style={{ fontSize: "14px", backgroundColor: "transparent" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(processHtml(doc.info)) }}
          />
        </CollapsibleSection>
      )}

      {doc?.revisions && (
        <CollapsibleSection
          title={translations.revisions}
          isOpen={expandedSections.revisions}
          onToggle={() => toggleSection("revisions")}
        >
          <div
            className="markdown-body p-3"
            style={{ fontSize: "14px", backgroundColor: "transparent" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(processHtml(doc.revisions)) }}
          />
        </CollapsibleSection>
      )}
    </div>
  );
}
