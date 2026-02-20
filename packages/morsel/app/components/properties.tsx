// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaComponentInstance, ModelicaVariability } from "@modelscript/modelscript";
import { NavList } from "@primer/react";

interface PropertiesWidgetProps {
  component: ModelicaComponentInstance | null;
  width?: number;
}

export default function PropertiesWidget(props: PropertiesWidgetProps) {
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

  return (
    <NavList className="height-full overflow-auto" style={{ width: props.width || 300, paddingBottom: 80 }}>
      <NavList.Group>
        <NavList.Item>
          <div className="d-flex flex-column">
            <div className="f6 color-fg-muted">Name</div>
            <div className="f5 text-bold">{component.name}</div>
          </div>
        </NavList.Item>
        <NavList.Item>
          <div className="d-flex flex-column">
            <div className="f6 color-fg-muted">Type</div>
            <div className="f5">{component.classInstance?.name}</div>
          </div>
        </NavList.Item>
        <NavList.Item>
          <div className="d-flex flex-column">
            <div className="f6 color-fg-muted">Description</div>
            <div className="f5" style={{ whiteSpace: "normal" }}>
              {component.description || "-"}
            </div>
          </div>
        </NavList.Item>
      </NavList.Group>
      {parameters.length > 0 && (
        <NavList.Group title="Parameters">
          {parameters.map((parameter) => (
            <NavList.Item key={parameter.name}>
              <div className="d-flex flex-column">
                <div className="d-flex flex-row flex-justify-between">
                  <div className="f6 color-fg-muted">{parameter.name}</div>
                  <div className="f5">
                    {component.modification
                      ?.getModificationArgument(parameter.name ?? "")
                      ?.expression?.toJSON()
                      ?.toString() ??
                      parameter.modification?.expression?.toJSON()?.toString() ??
                      "-"}
                  </div>
                </div>
                {parameter.description && <div className="f6 color-fg-muted text-italic">{parameter.description}</div>}
              </div>
            </NavList.Item>
          ))}
        </NavList.Group>
      )}
      {doc?.info && (
        <NavList.Group title="Documentation">
          <NavList.Item>
            <div
              className="markdown-body p-2"
              style={{ fontSize: "14px", backgroundColor: "transparent" }}
              dangerouslySetInnerHTML={{ __html: processHtml(doc.info) }}
            />
          </NavList.Item>
        </NavList.Group>
      )}
      {doc?.revisions && (
        <NavList.Group title="Revisions">
          <NavList.Item>
            <div
              className="markdown-body p-2"
              style={{ fontSize: "14px", backgroundColor: "transparent" }}
              dangerouslySetInnerHTML={{ __html: processHtml(doc.revisions) }}
            />
          </NavList.Item>
        </NavList.Group>
      )}
    </NavList>
  );
}
