import { ModelicaComponentInstance, ModelicaVariability } from "@modelscript/modelscript";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { TextInput, useTheme } from "@primer/react";
import { useEffect, useState } from "react";

interface PropertiesWidgetProps {
  component: ModelicaComponentInstance | null;
  width?: number;
  onParameterChange?: (name: string, value: string) => void;
}

function ParameterRow({
  parameter,
  value,
  colorMode,
  onParameterChange,
}: {
  parameter: ModelicaComponentInstance;
  value: string;
  colorMode?: string;
  onParameterChange?: (name: string, value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value, parameter.name]);

  useEffect(() => {
    if (localValue === value) return;

    const timeoutId = setTimeout(() => {
      if (onParameterChange) {
        onParameterChange(parameter.name!, localValue);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [localValue, value, parameter.name, onParameterChange]);

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
          title={parameter.name || ""}
        >
          {parameter.name}
        </div>
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
              onParameterChange(parameter.name!, localValue);
            }
          }}
          style={{ width: 120, height: 24, fontSize: 12 }}
        />
      </div>
      {parameter.description && (
        <div className="f6 color-fg-muted text-italic" style={{ marginTop: 2, fontSize: 11, paddingLeft: 0 }}>
          {parameter.description}
        </div>
      )}
    </div>
  );
}

export default function PropertiesWidget(props: PropertiesWidgetProps) {
  const { colorMode } = useTheme();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    info: true,
    parameters: true,
    documentation: true,
    revisions: false,
  });

  if (!props.component) {
    return <div className="p-3 text-center color-fg-muted">No component selected</div>;
  }

  const { component } = props;

  const parameters: ModelicaComponentInstance[] = [];
  if (component.classInstance) {
    for (const element of component.classInstance.elements) {
      if (element instanceof ModelicaComponentInstance && element.variability === ModelicaVariability.PARAMETER) {
        parameters.push(element);
      }
    }
  }

  const doc = component.classInstance?.annotation<{ info?: string; revisions?: string }>("Documentation");

  const processHtml = (html: string | undefined) => {
    if (!html) return "";
    const context = component.context;
    if (!context) return html;

    return html.replace(/<img\s+[^>]*src=(["'])modelica:\/\/([^"']+)\1[^>]*>/gi, (match, quote, uriPath) => {
      const uri = `modelica://${uriPath}`;
      const resolvedPath = context.resolveURI(uri);
      if (resolvedPath) {
        try {
          const binary = context.fs.readBinary(resolvedPath);
          let binaryString = "";
          for (let i = 0; i < binary.length; i++) {
            binaryString += String.fromCharCode(binary[i]);
          }
          const base64 = btoa(binaryString);
          const ext = context.fs.extname(resolvedPath).toLowerCase().substring(1);
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
          return match.replace(`modelica://${uriPath}`, `data:${mimeType};base64,${base64}`);
        } catch (e) {
          console.error(`Failed to resolve image ${uri}:`, e);
        }
      }
      return match;
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
      <details open={expandedSections.info} className="border-bottom">
        <summary
          className="p-2 cursor-pointer f6 text-bold color-fg-muted"
          style={{ listStyle: "none" }}
          onClick={(e) => {
            e.preventDefault();
            toggleSection("info");
          }}
        >
          {expandedSections.info ? <ChevronDownIcon className="mr-1" /> : <ChevronRightIcon className="mr-1" />}
          INFORMATION
        </summary>
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: 8 }}>
          <div style={{ padding: "8px 16px" }}>
            <div className="f6 color-fg-muted">Name</div>
            <div className="f5 text-bold">{component.name}</div>
          </div>
          <div style={{ padding: "8px 16px" }}>
            <div className="f6 color-fg-muted">Type</div>
            <div className="f5">{component.classInstance?.name}</div>
          </div>
          <div style={{ padding: "8px 16px" }}>
            <div className="f6 color-fg-muted">Description</div>
            <div className="f5" style={{ whiteSpace: "normal" }}>
              {component.description || "-"}
            </div>
          </div>
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
            PARAMETERS
          </summary>
          <div style={{ paddingBottom: 8 }}>
            {parameters.map((parameter) => {
              const value =
                component.modification
                  ?.getModificationArgument(parameter.name ?? "")
                  ?.expression?.toJSON()
                  ?.toString() ??
                parameter.modification?.expression?.toJSON()?.toString() ??
                "-";
              return (
                <ParameterRow
                  key={parameter.name}
                  parameter={parameter}
                  value={value}
                  colorMode={colorMode}
                  onParameterChange={props.onParameterChange}
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
            DOCUMENTATION
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
            REVISIONS
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
