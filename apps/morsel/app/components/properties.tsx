import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { Button, Textarea, TextInput, ToggleSwitch, useTheme } from "@primer/react";
import { useEffect, useState } from "react";
import type { Translations } from "~/util/i18n";
import type { ComponentProperties, PropertyData } from "~/util/lsp-bridge";
import { ComponentIcon } from "./component-list";

function formatUnit(unit: string): string {
  if (unit === "Ohm") return "Ω";
  return unit;
}

interface PropertiesWidgetProps {
  properties: ComponentProperties | null;
  context?: any;
  width?: number;
  onNameChange?: (name: string) => void;
  onDescriptionChange?: (description: string) => void;
  onParameterChange?: (name: string, value: string) => void;
  translations: Translations;
}

function ParameterRow({
  parameter,
  colorMode,
  onParameterChange,
}: {
  parameter: PropertyData;
  colorMode?: string;
  onParameterChange?: (name: string, value: string) => void;
}) {
  const { value, unit, isBoolean } = parameter;
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value, parameter.name]);

  useEffect(() => {
    if (isBoolean) return; // Boolean toggle calls onParameterChange immediately via onClick
    if (localValue === value) return;

    const timeoutId = setTimeout(() => {
      if (onParameterChange) {
        onParameterChange(parameter.name, localValue);
      }
    }, 500);

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
          className="f6 color-fg-muted"
          style={{
            marginRight: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "calc(100% - 130px)",
          }}
          title={parameter.localizedName || ""}
        >
          {parameter.localizedName}
        </div>
        {isBoolean ? (
          <ToggleSwitch
            size="small"
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
            value={localValue === "-" ? "" : localValue}
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
              if (localValue !== value && onParameterChange) {
                onParameterChange(parameter.name, localValue);
              }
            }}
            trailingVisual={
              unit
                ? () => (
                    <span style={{ fontSize: 11, color: "var(--fgColor-muted, #656d76)", whiteSpace: "nowrap" }}>
                      {unit}
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
          className="f6 color-fg-muted text-italic"
          style={{ marginTop: 2, fontSize: 11, paddingLeft: 0, opacity: 0.6 }}
        >
          {parameter.localizedDescription}
        </div>
      )}
    </div>
  );
}

export default function PropertiesWidget(props: PropertiesWidgetProps) {
  const { colorMode } = useTheme();
  const { properties, onNameChange, onDescriptionChange, onParameterChange, translations } = props;
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
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [localName, properties?.name, onNameChange]);

  useEffect(() => {
    const propertiesDescription = properties?.description || "";
    if (localDescription === propertiesDescription) return;

    const timeoutId = setTimeout(() => {
      if (onDescriptionChange) {
        onDescriptionChange(localDescription);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [localDescription, properties?.description, onDescriptionChange]);

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

    return html.replace(/<img\s+[^>]*src=(["'])modelica:\/\/([^"']+)\1[^>]*>/gi, (match, quote, uriPath) => {
      const uri = `modelica://${uriPath}`;
      const resolvedPath = context.resolveURI(uri);
      if (resolvedPath) {
        try {
          const binary = context.fs.readBinary(resolvedPath);
          // Convert Uint8Array to base64 in chunks to avoid stack overflow
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
      // Hide unresolvable modelica:// images to avoid broken image icons
      return match.replace(/src=(["'])modelica:\/\/[^"']+\1/, 'style="display:none"');
    });
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div
      className="height-full overflow-auto"
      style={{ width: props.width || 300, paddingBottom: 80 }}
      onClick={(e) => e.stopPropagation()}
    >
      <details open={expandedSections.info} className="mb-2border-bottom">
        <summary
          className="p-2 cursor-pointer f6 text-bold color-fg-muted"
          style={{ listStyle: "none" }}
          onClick={(e) => {
            e.preventDefault();
            toggleSection("info");
          }}
        >
          {expandedSections.info ? <ChevronDownIcon className="mr-1" /> : <ChevronRightIcon className="mr-1" />}
          {translations.information}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", padding: "8px 16px", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "row", gap: "24px", alignItems: "stretch" }}>
            {properties.iconSvg && (
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                <ComponentIcon iconSvg={properties.iconSvg} size={80} darkMode={colorMode === "dark"} />
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
                rows={5}
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: "4px",
                }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <Button
                variant="invisible"
                size="small"
                onClick={() => setDescriptionEditing(true)}
                style={{
                  fontSize: 12,
                  color: "var(--fgColor-muted, #656d76)",
                  padding: "16px 24px",
                  borderRadius: "8px",
                  border: `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`,
                  width: "100%",
                }}
              >
                {translations.addDescription}
              </Button>
            </div>
          )}
        </div>
      </details>

      {parameters.length > 0 && (
        <details open={expandedSections.parameters} className="border-bottom">
          <summary
            className="p-2 cursor-pointer f6 text-bold color-fg-muted"
            style={{ listStyle: "none" }}
            onClick={(e) => {
              e.preventDefault();
              toggleSection("parameters");
            }}
          >
            {expandedSections.parameters ? <ChevronDownIcon className="mr-1" /> : <ChevronRightIcon className="mr-1" />}
            {translations.parameters}
          </summary>
          <div style={{ paddingBottom: 8 }}>
            {parameters.map((parameter) => {
              return (
                <ParameterRow
                  key={parameter.name}
                  parameter={parameter}
                  colorMode={colorMode}
                  onParameterChange={onParameterChange}
                />
              );
            })}
          </div>
        </details>
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
            dangerouslySetInnerHTML={{ __html: processHtml(doc.info) }}
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
            dangerouslySetInnerHTML={{ __html: processHtml(doc.revisions) }}
          />
        </details>
      )}
    </div>
  );
}
