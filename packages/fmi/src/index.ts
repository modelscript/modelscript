// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "./ad-codegen.js";
export * from "./fmi.js";
export * from "./fmi3.js";
export * from "./fmu-archive.js";
export * from "./fmu-codegen.js";
export * from "./fmu.js";
export * from "./fmu3-codegen.js";
export * from "./ssp-archive.js";
export * from "./sundials-codegen.js";
export * from "./wrapper-template.js";

import { ModelicaEntity } from "@modelscript/core";
import { ModelicaFmuEntity } from "./fmu.js";
import { ModelicaSspEntity } from "./ssp-archive.js";

ModelicaEntity.loaders.push({
  tryLoad(parent: ModelicaEntity, directoryPath: string, direntName: string): ModelicaEntity | null {
    const ext = direntName.includes(".") ? direntName.slice(((direntName.lastIndexOf(".") - 1) >>> 0) + 2) : "";
    if (ext === "xml") {
      const xmlPath = parent.context?.fs.join(directoryPath, direntName);
      if (xmlPath) {
        try {
          const xmlContent = parent.context?.fs.read(xmlPath);
          if (xmlContent?.includes("fmiModelDescription")) {
            const fmuEntity = new ModelicaFmuEntity(parent, xmlPath);
            fmuEntity.name = direntName.replace(/\.xml$/, "");
            return fmuEntity as unknown as ModelicaEntity;
          }
        } catch {
          /* skip unreadable */
        }
      }
    } else if (ext === "ssp") {
      const sspPath = parent.context?.fs.join(directoryPath, direntName);
      if (sspPath) {
        try {
          const sspEntity = new ModelicaSspEntity(parent, sspPath);
          sspEntity.name = direntName.replace(/\.ssp$/, "");
          return sspEntity as unknown as ModelicaEntity;
        } catch {
          /* skip unreadable */
        }
      }
    }
    return null;
  },
});
