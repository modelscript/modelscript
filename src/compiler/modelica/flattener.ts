// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaComponentInstance,
  ModelicaEntity,
  ModelicaModelVisitor,
  ModelicaPredefinedClassInstance,
  type ModelicaClassInstance,
} from "./model.js";

export class ModelicaFlattener extends ModelicaModelVisitor<string> {
  visitEntity(node: ModelicaEntity, parentName = ""): void {
    this.visitClassInstance(node, parentName);
  }

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
    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      console.log("  " + node.classInstance.name + " " + name + ";");
    } else {
      node.classInstance?.accept(this, name);
    }
  }
}
