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
import { ChevronRightIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { Textarea, TextInput, ToggleSwitch, useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnsatzSketchIcon } from "../icons";
import Spinner from "../Spinner";
import { ComponentIcon } from "./ComponentList";
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

function ParameterRow({
  parameter,
  onParameterChange,
}: {
  parameter: PropertyData;
  colorMode?: string | undefined;
  onParameterChange?: ((name: string, value: string) => void) | undefined;
}) {
  const { value, unit, isBoolean } = parameter;
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const lastCommittedRef = useRef(value);
  const onParameterChangeRef = useRef(onParameterChange);
  onParameterChangeRef.current = onParameterChange;

  useEffect(() => {
    setLocalValue(value);
    lastCommittedRef.current = value;
    setIsSaving(false);
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
    }, 60);

    return () => clearTimeout(timeoutId);
  }, [localValue, parameter.name, isBoolean]);

  const isNumeric = !isBoolean && !isNaN(parseFloat(localValue));

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
        padding: "6px 16px",
        cursor: "default",
      }}
      onMouseDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
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
            fontSize: 12,
            fontWeight: 500,
            color: isSaving || isScrubbing ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.15s ease",
            cursor: isNumeric ? "ew-resize" : "default",
            userSelect: isScrubbing ? "none" : undefined,
          }}
          title={
            (parameter.localizedName || parameter.description || parameter.name) +
            (isNumeric ? " (Drag horizontally to scrub value)" : "")
          }
        >
          {parameter.localizedName || parameter.name}
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
          )}
        </div>
      </div>
      {parameter.localizedDescription && (
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
}: {
  field: any;
  currentValue: any;
  contextValues: Record<string, any>;
  conflict?: PropertyConflict | null | undefined;
  onParameterChange?: ((name: string, value: string) => void) | undefined;
  onResolveConflict?: ((resolution: "keep_local" | "accept_remote") => void) | undefined;
}) {
  const isEnabled = evaluatePropertyPredicate(field.enabledIf, contextValues) && !field.readOnly;
  const initialValStr = String(currentValue ?? field.defaultValue ?? "");
  const [localVal, setLocalVal] = useState<string>(initialValStr);
  const [isSaving, setIsSaving] = useState(false);
  const lastCommittedRef = useRef<string>(initialValStr);
  const onParameterChangeRef = useRef(onParameterChange);
  onParameterChangeRef.current = onParameterChange;

  useEffect(() => {
    const nextVal = String(currentValue ?? field.defaultValue ?? "");
    setLocalVal(nextVal);
    lastCommittedRef.current = nextVal;
    setIsSaving(false);
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
    }, 60);
    return () => clearTimeout(timeout);
  }, [localVal, field.key, field.kind]);

  const validationErr = validatePropertyValue(field, localVal, contextValues);
  const unitStr = field.unit ? formatUnit(field.unit) : undefined;
  const defaultValueStr =
    field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : "";
  const isOverridden = localVal !== "" && localVal !== "-" && defaultValueStr !== "" && localVal !== defaultValueStr;

  const isNumberField = field.kind === "number";
  const [isScrubbing, setIsScrubbing] = useState(false);

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
        padding: "6px 16px",
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
              fontSize: 12,
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
            }}
            title={
              (field.description || field.label || field.key) +
              (isNumberField && isEnabled ? " (Drag horizontally to scrub value)" : "")
            }
          >
            {field.label || field.key}
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
                const lbl = typeof c === "string" ? c : c.label;
                return (
                  <option key={val} value={val}>
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
          )}
        </div>
      </div>
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
      {field.description && (
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

  useEffect(() => {
    conflictMgrRef.current.reset(properties?.values || {});
    setConflictVersion(0);
  }, [properties?.name]);

  useEffect(() => {
    if (properties?.values) {
      const remote: Record<string, string> = {};
      for (const [k, v] of Object.entries(properties.values)) {
        remote[k] = String(v ?? "");
      }
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
  }, [properties, localValues, localName]);

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
          props.onClose && (
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
          )
        }
      >
        <div style={{ display: "flex", flexDirection: "column", padding: "8px 16px", gap: "12px" }}>
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
                rows={4}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: "6px",
                  borderRadius: "var(--ms-radius-sm, 6px)",
                }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
              <button
                type="button"
                onClick={() => setDescriptionEditing(true)}
                style={{
                  background: "transparent",
                  border: "1px dashed var(--color-border-default, var(--ms-border))",
                  borderRadius: "var(--ms-radius-sm, 6px)",
                  padding: "6px 12px",
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
                      <div style={{ padding: "8px 16px 4px 16px" }}>
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
                    )}

                    {activeGroups.map((grp: PropertyGroupConfig) => {
                      const visibleFields = (grp.fields || [])
                        .filter((fld: PropertyFieldConfig) => evaluatePropertyPredicate(fld.visibleIf, localValues))
                        .filter((fld: PropertyFieldConfig) => {
                          if (!filterText) return true;
                          const q = filterText.toLowerCase();
                          return (
                            fld.key.toLowerCase().includes(q) ||
                            (fld.label && fld.label.toLowerCase().includes(q)) ||
                            (fld.description && fld.description.toLowerCase().includes(q))
                          );
                        });

                      if (visibleFields.length === 0 && filterText) return null;

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
              <div style={{ padding: "4px 16px 8px 16px" }}>
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
            )}
            <div style={{ paddingBottom: 8 }}>
              {parameters
                .filter((p) => {
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
