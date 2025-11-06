// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaComponentInstance,
  ModelicaNodeVisitor,
  ModelicaPredefinedClassInstance,
  type ModelicaClassInstance,
} from "../../model/modelica.js";

export class ModelicaFlattener extends ModelicaNodeVisitor<string> {
  visitClassInstance(node: ModelicaClassInstance, parentName = ""): void {
    if (parentName === "") {
      console.log("class " + node.name);
      for (const element of node.elements) if (element instanceof ModelicaComponentInstance) element.accept(this, "");
      console.log("end " + node.name + ";");
    } else {
      for (const element of node.elements)
        if (element instanceof ModelicaComponentInstance) element.accept(this, parentName);
    }
  }

  visitComponentInstance(node: ModelicaComponentInstance, parentName = ""): void {
    const name = parentName === "" ? node.name : parentName + "." + node.name;
    if (node.typeClassInstance instanceof ModelicaPredefinedClassInstance) {
      console.log("  " + node.typeClassInstance.name + " " + name + ";");
    } else {
      node.typeClassInstance?.accept(this, name);
    }
  }
}
