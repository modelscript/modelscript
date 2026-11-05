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
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { Textarea, TextInput, ToggleSwitch, useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
            borderRadius: 3,
            background: "rgba(128,128,128,0.15)",
            fontFamily: "var(--fontStack-monospace, monospace)",
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

  useEffect(() => {
    setLocalValue(value);
  }, [value, parameter.name]);

  useEffect(() => {
    if (isBoolean) return; // Boolean toggle calls onParameterChange immediately via onClick
    if (localValue === value || localValue === "-") return;

    const timeoutId = setTimeout(() => {
      if (onParameterChange) {
        onParameterChange(parameter.name, localValue);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [localValue, value, parameter.name, onParameterChange, isBoolean]);

  const isChecked = localValue === "true";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 16px",
        cursor: "default",
      }}
      onMouseDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
      }}
    >
      <div className="d-flex flex-row flex-justify-between flex-items-center" onClick={(e) => e.stopPropagation()}>
        <div
          id={`param-label-${parameter.name}`}
          className="f6 color-fg-muted"
          style={{
            marginRight: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "calc(100% - 130px)",
          }}
          title={parameter.localizedName || parameter.description || ""}
        >
          {parameter.localizedName || parameter.name}
        </div>
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
                    <span style={{ fontSize: 11, color: "var(--fgColor-muted, #656d76)", whiteSpace: "nowrap" }}>
                      {formatUnit(unit)}
                    </span>
                  )
                : undefined
            }
            style={{ width: 120, height: 24, fontSize: 12 }}
          />
        )}
      </div>
      {parameter.localizedDescription && (
        <div
          className="f6 color-fg-muted"
          style={{
            marginTop: 2,
            fontSize: 11,
            paddingLeft: 0,
            lineHeight: 1.35,
            opacity: 0.75,
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
  const [localVal, setLocalVal] = useState<string>(String(currentValue ?? field.defaultValue ?? ""));

  useEffect(() => {
    setLocalVal(String(currentValue ?? field.defaultValue ?? ""));
  }, [currentValue, field.defaultValue]);

  useEffect(() => {
    if (field.kind === "boolean") return;
    if (localVal === "-" || localVal === String(currentValue ?? field.defaultValue ?? "")) return;

    const timeout = setTimeout(() => {
      onParameterChange?.(field.key, localVal);
    }, 150);
    return () => clearTimeout(timeout);
  }, [localVal, currentValue, field.key, field.defaultValue, field.kind, onParameterChange]);

  const validationErr = validatePropertyValue(field, localVal, contextValues);
  const unitStr = field.unit ? formatUnit(field.unit) : undefined;
  const defaultValueStr =
    field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : "";
  const isOverridden = localVal !== "" && localVal !== "-" && defaultValueStr !== "" && localVal !== defaultValueStr;

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
      <div className="d-flex flex-row flex-justify-between flex-items-center" onClick={(e) => e.stopPropagation()}>
        <div className="d-flex flex-items-center" style={{ maxWidth: "calc(100% - 130px)", overflow: "hidden" }}>
          {isOverridden && (
            <span
              title={`Modified from default (${defaultValueStr})`}
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "var(--fgColor-accent, #58a6ff)",
                marginRight: 6,
                flexShrink: 0,
              }}
            />
          )}
          <label
            id={`schema-field-${field.key}`}
            className="f6"
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: isOverridden ? "var(--fgColor-default, #c9d1d9)" : "var(--fgColor-muted, #8b949e)",
              fontWeight: isOverridden ? 600 : 400,
            }}
            title={field.description || ""}
          >
            {field.label || field.key}
          </label>
        </div>

        <div className="d-flex flex-items-center" style={{ gap: 4 }}>
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
                color: "var(--fgColor-muted, #8b949e)",
                lineHeight: 1,
                borderRadius: 4,
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
                borderRadius: 4,
                border: "1px solid var(--borderColor-default, #30363d)",
                background: "var(--bgColor-muted, #161b22)",
                color: "var(--fgColor-default, #c9d1d9)",
                padding: "2px 6px",
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
                height: 24,
                padding: 2,
                borderRadius: 4,
                border: "1px solid var(--borderColor-default, #30363d)",
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
                background: "var(--bgColor-muted, #161b22)",
                borderRadius: 4,
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
              trailingVisual={
                unitStr
                  ? () => (
                      <span style={{ fontSize: 11, color: "var(--fgColor-muted, #656d76)", whiteSpace: "nowrap" }}>
                        {unitStr}
                      </span>
                    )
                  : undefined
              }
              style={{ width: 130, height: 24, fontSize: 12 }}
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
            background: "rgba(248, 81, 73, 0.12)",
            border: "1px solid var(--fgColor-danger, #f85149)",
            borderRadius: 4,
            padding: "4px 8px",
            marginTop: 4,
            fontSize: 11,
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
                border: "1px solid var(--fgColor-danger, #f85149)",
                borderRadius: 3,
                color: "var(--fgColor-default, #c9d1d9)",
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
                border: "1px solid var(--fgColor-danger, #f85149)",
                borderRadius: 3,
                color: "var(--fgColor-default, #c9d1d9)",
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
        <div style={{ color: "var(--fgColor-danger, #f85149)", fontSize: 11, marginTop: 2 }}>{validationErr}</div>
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

  const [localName, setLocalName] = useState(properties?.name || "");
  const [localDescription, setLocalDescription] = useState(properties?.description || "");
  const [descriptionEditing, setDescriptionEditing] = useState(false);

  useEffect(() => {
    setLocalName(properties?.name || "");
    setLocalDescription(properties?.description || "");
    setDescriptionEditing(false);
  }, [properties?.name, properties?.description]);

  useEffect(() => {
    if (!localName || localName === properties?.name) return;

    const timeoutId = setTimeout(() => {
      if (onNameChange) {
        onNameChange(localName);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [localName, properties?.name, onNameChange]);

  useEffect(() => {
    const propertiesDescription = properties?.description || "";
    if (localDescription === propertiesDescription) return;

    const timeoutId = setTimeout(() => {
      if (onDescriptionChange) {
        onDescriptionChange(localDescription);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [localDescription, properties?.description, onDescriptionChange]);

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
        className="height-full p-4 color-fg-muted f4 border-left d-flex flex-items-center flex-justify-center"
        style={{ width: props.width || 300, minHeight: 200 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Spinner size="medium" />
      </div>
    );
  }

  if (!properties) {
    return (
      <div
        className="height-full p-4 color-fg-muted f4 border-left"
        style={{ width: props.width || 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        {translations.noComponentSelected}
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
      <details open={expandedSections.info} className="mb-2 border-bottom">
        <summary
          className="p-2 cursor-pointer f6 text-bold color-fg-muted d-flex flex-items-center flex-justify-between"
          style={{ listStyle: "none" }}
          onClick={(e) => {
            e.preventDefault();
            toggleSection("info");
          }}
        >
          <span className="d-flex flex-items-center">
            {expandedSections.info ? <ChevronDownIcon className="mr-1" /> : <ChevronRightIcon className="mr-1" />}
            {translations.information}
          </span>
          {props.onClose && (
            <button
              type="button"
              aria-label="Close properties panel"
              title="Close properties panel"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onClose?.();
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--fgColor-muted, #8b949e)",
                cursor: "pointer",
                fontSize: "14px",
                lineHeight: 1,
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              ✕
            </button>
          )}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", padding: "8px 16px", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "row", gap: "24px", alignItems: "stretch" }}>
            {(liveIconSvg || properties.iconSvg) && (
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                <ComponentIcon iconSvg={liveIconSvg || properties.iconSvg} size={80} darkMode={colorMode === "dark"} />
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                overflow: "hidden",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <div style={{ padding: "4px 0" }}>
                <div className="f6 color-fg-muted" style={{ lineHeight: "1.2" }}>
                  {translations.type}
                </div>
                <div
                  className="f6"
                  style={{ wordBreak: "break-all", lineHeight: "1.2", fontWeight: "normal", padding: "4px 0" }}
                >
                  {properties.localizedClassName || properties.className}
                </div>
              </div>
              <div>
                <div className="f6 color-fg-muted" style={{ lineHeight: "1.2" }}>
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
                    height: 24,
                    fontSize: 12,
                    padding: "0 4px",
                  }}
                />
              </div>
            </div>
          </div>
          {localDescription || descriptionEditing ? (
            <div>
              <div className="f6 color-fg-muted" style={{ opacity: 0.4 }}>
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
                  padding: "4px",
                }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <button
                type="button"
                onClick={() => setDescriptionEditing(true)}
                style={{
                  background: "transparent",
                  border: `1px dashed ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`,
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 11,
                  color: "var(--fgColor-muted, #8b949e)",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                }}
              >
                + {translations.addDescription || "Add description"}
              </button>
            </div>
          )}
        </div>
      </details>

      {/* Schema-driven Tabs & Groups */}
      {visibleTabs.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {/* Tab Navigation */}
          <div
            style={{
              display: "flex",
              gap: 4,
              borderBottom: "1px solid var(--borderColor-default, #30363d)",
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
                    borderBottom: isActive ? "2px solid var(--fgColor-accent, #58a6ff)" : "2px solid transparent",
                    color: isActive ? "var(--fgColor-default, #c9d1d9)" : "var(--fgColor-muted, #8b949e)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    textTransform: "uppercase",
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

                      return (
                        <details key={grp.id} open className="border-bottom">
                          <summary
                            className="p-2 cursor-pointer f6 text-bold color-fg-muted"
                            style={{ listStyle: "none" }}
                          >
                            <ChevronDownIcon className="mr-1" />
                            {grp.label}
                          </summary>
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
                        </details>
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
          <details open={expandedSections.parameters} className="border-bottom">
            <summary
              className="p-2 cursor-pointer f6 text-bold color-fg-muted"
              style={{ listStyle: "none" }}
              onClick={(e) => {
                e.preventDefault();
                toggleSection("parameters");
              }}
            >
              {expandedSections.parameters ? (
                <ChevronDownIcon className="mr-1" />
              ) : (
                <ChevronRightIcon className="mr-1" />
              )}
              {translations.parameters}
            </summary>
            <div style={{ paddingBottom: 8 }}>
              {parameters.map((parameter) => (
                <ParameterRow
                  key={parameter.name}
                  parameter={parameter}
                  colorMode={colorMode}
                  onParameterChange={onParameterChange}
                />
              ))}
            </div>
          </details>
        )
      )}

      {doc?.info && (
        <details open={expandedSections.documentation} className="border-bottom">
          <summary
            className="p-2 cursor-pointer f6 text-bold color-fg-muted"
            style={{ listStyle: "none" }}
            onClick={(e) => {
              e.preventDefault();
              toggleSection("documentation");
            }}
          >
            {expandedSections.documentation ? (
              <ChevronDownIcon className="mr-1" />
            ) : (
              <ChevronRightIcon className="mr-1" />
            )}
            {translations.documentation}
          </summary>
          <div
            className="markdown-body p-3"
            style={{ fontSize: "14px", backgroundColor: "transparent" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(processHtml(doc.info)) }}
          />
        </details>
      )}

      {doc?.revisions && (
        <details open={expandedSections.revisions} className="border-bottom">
          <summary
            className="p-2 cursor-pointer f6 text-bold color-fg-muted"
            style={{ listStyle: "none" }}
            onClick={(e) => {
              e.preventDefault();
              toggleSection("revisions");
            }}
          >
            {expandedSections.revisions ? <ChevronDownIcon className="mr-1" /> : <ChevronRightIcon className="mr-1" />}
            {translations.revisions}
          </summary>
          <div
            className="markdown-body p-3"
            style={{ fontSize: "14px", backgroundColor: "transparent" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(processHtml(doc.revisions)) }}
          />
        </details>
      )}
    </div>
  );
}
