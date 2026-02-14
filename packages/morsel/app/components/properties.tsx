// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaComponentInstance, ModelicaVariability } from "@modelscript/modelscript";
import { NavList } from "@primer/react";

interface PropertiesWidgetProps {
  component: ModelicaComponentInstance | null;
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

  return (
    <NavList className="height-full overflow-auto" style={{ width: "300px" }}>
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
    </NavList>
  );
}
