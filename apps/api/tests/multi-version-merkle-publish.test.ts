// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { getCachedClassIcon, iconCache } from "../../../packages/lsp/src/handlers/treeHandler.js";
import { mountedLibraryMetadata } from "../../../packages/lsp/src/utils/hierarchy-utils.js";
import { BrowserFileSystem } from "../../../packages/lsp/src/vfs/browser-file-system.js";
import {
  extractDeclaredDependenciesFromSource,
  unloadLibraryPackage,
  type LoaderContext,
} from "../../../packages/lsp/src/vfs/library-loader.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";
import { exportLspBundle } from "../src/util/lsp-bundle-exporter.js";
import { processLibrary } from "../src/util/svg-renderer.js";

async function writeZipFromFiles(zipPath: string, files: Record<string, string>): Promise<Buffer> {
  const zip = new AdmZip();
  for (const [relPath, content] of Object.entries(files)) {
    zip.addFile(relPath, Buffer.from(content, "utf-8"));
  }
  const buf = zip.toBuffer();
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, buf);
  return buf;
}

describe("Multi-Version Library Architecture: CAS, Merkle Invalidation, Cross-Library Hydration & LSP Hot-Swap", () => {
  let tmpDir: string;
  let db: LibraryDatabase;
  let storage: LibraryStorage;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-multiver-merkle-"));
    db = new LibraryDatabase(path.join(tmpDir, "test.db"));
    storage = new LibraryStorage(path.join(tmpDir, "libraries"));
  });

  after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. CAS Deduplication: identical extracted files and SVGs across versions share physical hardlinks in .cas", async () => {
    const v1Files = {
      "CasPkg/package.mo": `within;\npackage CasPkg\n  annotation(version="1.0.0");\nend CasPkg;\n`,
      "CasPkg/SharedModel.mo": `within CasPkg;\nmodel SharedModel\n  Real x = 1.0;\nend SharedModel;\n`,
    };
    const v2Files = {
      "CasPkg/package.mo": `within;\npackage CasPkg\n  annotation(version="1.1.0");\nend CasPkg;\n`,
      "CasPkg/SharedModel.mo": v1Files["CasPkg/SharedModel.mo"],
    };

    const zip1 = await writeZipFromFiles(path.join(tmpDir, "CasPkg-1.0.0.zip"), v1Files);
    const zip2 = await writeZipFromFiles(path.join(tmpDir, "CasPkg-1.1.0.zip"), v2Files);

    await storage.store("CasPkg", "1.0.0", zip1);
    await storage.store("CasPkg", "1.1.0", zip2);

    const ext1 = await storage.extractLibrary("CasPkg", "1.0.0");
    const ext2 = await storage.extractLibrary("CasPkg", "1.1.0");

    const sharedFile1 = path.join(ext1, "SharedModel.mo");
    const sharedFile2 = path.join(ext2, "SharedModel.mo");
    const statFile1 = fs.statSync(sharedFile1);
    const statFile2 = fs.statSync(sharedFile2);

    assert.equal(
      statFile1.ino,
      statFile2.ino,
      "Unchanged extracted .mo file across 1.0.0 and 1.1.0 must share the same CAS inode",
    );
    assert.ok(statFile1.nlink >= 3, "CAS file blob should have hardlinks from .cas/files and both extracted dirs");

    const identicalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#112233"/></svg>`;
    storage.storeSvg("CasPkg", "1.0.0", "CasPkg.SharedModel", identicalSvg, null);
    storage.storeSvg("CasPkg", "1.1.0", "CasPkg.SharedModel", identicalSvg, null);

    const svgPath1 = path.join(storage.dataDir, "CasPkg", "1.0.0", "svgs", "CasPkg.SharedModel", "icon.svg");
    const svgPath2 = path.join(storage.dataDir, "CasPkg", "1.1.0", "svgs", "CasPkg.SharedModel", "icon.svg");
    assert.equal(
      fs.statSync(svgPath1).ino,
      fs.statSync(svgPath2).ino,
      "Identical rendered SVGs across versions must share the same CAS inode",
    );

    // Ensure .cas directory is hidden from storage.list()
    assert.equal(storage.list().includes(".cas"), false);
  });

  it("2. Sound Transitive Merkle Hashing: modifying a base icon invalidates derived icons & parent diagrams even when their .mo files are byte-identical", async () => {
    const baseIconV1 = `within CustomLib.Icons;
partial class BaseIcon
  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={0,0,255}, fillPattern=FillPattern.Solid)}));
end BaseIcon;
`;
    const baseIconV2 = `within CustomLib.Icons;
partial class BaseIcon
  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={255,0,0}, fillPattern=FillPattern.Solid)}));
end BaseIcon;
`;
    const subSensorMo = `within CustomLib.Components;
model SubSensor
  extends CustomLib.Icons.BaseIcon;
  Real val = 1.0;
end SubSensor;
`;
    const systemModelMo = `within CustomLib.Examples;
model SystemModel
  CustomLib.Components.SubSensor s1 annotation(Placement(transformation(extent={{-20,-20},{20,20}})));
  annotation(Icon(graphics={Ellipse(extent={{-80,-80},{80,80}}, lineColor={0,128,0})}));
end SystemModel;
`;
    const unrelatedMo = `within CustomLib.Utilities;
model UnrelatedHelper
  Real k = 42.0;
  annotation(Icon(graphics={Rectangle(extent={{-50,-50},{50,50}}, fillColor={10,200,10}, fillPattern=FillPattern.Solid)}));
end UnrelatedHelper;
`;

    // Index v1.0.0
    const v1Zip = await writeZipFromFiles(path.join(tmpDir, "CustomLib-1.0.0.zip"), {
      "CustomLib/package.mo": `within;\npackage CustomLib\n  annotation(version="1.0.0");\nend CustomLib;\n`,
      "CustomLib/Icons/package.mo": `within CustomLib;\npackage Icons\nend Icons;\n`,
      "CustomLib/Icons/BaseIcon.mo": baseIconV1,
      "CustomLib/Components/package.mo": `within CustomLib;\npackage Components\nend Components;\n`,
      "CustomLib/Components/SubSensor.mo": subSensorMo,
      "CustomLib/Examples/package.mo": `within CustomLib;\npackage Examples\nend Examples;\n`,
      "CustomLib/Examples/SystemModel.mo": systemModelMo,
      "CustomLib/Utilities/package.mo": `within CustomLib;\npackage Utilities\nend Utilities;\n`,
      "CustomLib/Utilities/UnrelatedHelper.mo": unrelatedMo,
    });
    await storage.store("CustomLib", "1.0.0", v1Zip);
    const extV1 = await storage.extractLibrary("CustomLib", "1.0.0");

    await processLibrary(
      extV1,
      new Set(),
      async (className, metadata, svgs) => {
        storage.storeSvg("CustomLib", "1.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("CustomLib", "1.0.0", metadata);
      },
      undefined,
    );

    const v1SubSensor = db.getClass("CustomLib", "1.0.0", "CustomLib.Components.SubSensor");
    const v1System = db.getClass("CustomLib", "1.0.0", "CustomLib.Examples.SystemModel");
    const v1Unrelated = db.getClass("CustomLib", "1.0.0", "CustomLib.Utilities.UnrelatedHelper");
    assert.ok(v1SubSensor?.iconHash);
    assert.ok(v1System?.iconHash && v1System?.diagramHash);
    assert.ok(v1Unrelated?.iconHash && v1Unrelated?.diagramHash);

    // Index v1.1.0 where ONLY BaseIcon.mo changed (SubSensor.mo, SystemModel.mo, UnrelatedHelper.mo are byte-identical)
    const v2Zip = await writeZipFromFiles(path.join(tmpDir, "CustomLib-1.1.0.zip"), {
      "CustomLib/package.mo": `within;\npackage CustomLib\n  annotation(version="1.1.0");\nend CustomLib;\n`,
      "CustomLib/Icons/package.mo": `within CustomLib;\npackage Icons\nend Icons;\n`,
      "CustomLib/Icons/BaseIcon.mo": baseIconV2,
      "CustomLib/Components/package.mo": `within CustomLib;\npackage Components\nend Components;\n`,
      "CustomLib/Components/SubSensor.mo": subSensorMo,
      "CustomLib/Examples/package.mo": `within CustomLib;\npackage Examples\nend Examples;\n`,
      "CustomLib/Examples/SystemModel.mo": systemModelMo,
      "CustomLib/Utilities/package.mo": `within CustomLib;\npackage Utilities\nend Utilities;\n`,
      "CustomLib/Utilities/UnrelatedHelper.mo": unrelatedMo,
    });
    await storage.store("CustomLib", "1.1.0", v2Zip);
    const extV2 = await storage.extractLibrary("CustomLib", "1.1.0");

    const prevCache = db.getPreviousVersionClassHashes("CustomLib", "1.1.0");
    assert.ok(prevCache);
    assert.equal(prevCache.version, "1.0.0");

    let unrelatedProcessed = false;
    await processLibrary(
      extV2,
      new Set(),
      async (className, metadata, svgs) => {
        if (className === "CustomLib.Utilities.UnrelatedHelper") {
          unrelatedProcessed = true;
        }
        storage.storeSvg("CustomLib", "1.1.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("CustomLib", "1.1.0", metadata);
      },
      undefined,
      {
        previousVersion: {
          version: prevCache.version,
          classes: prevCache.classes,
          readSvg: (clsName, kind) => storage.readSvg("CustomLib", prevCache.version, clsName, kind),
        },
      },
    );
    assert.ok(unrelatedProcessed);

    const v2SubSensor = db.getClass("CustomLib", "1.1.0", "CustomLib.Components.SubSensor");
    const v2System = db.getClass("CustomLib", "1.1.0", "CustomLib.Examples.SystemModel");
    const v2Unrelated = db.getClass("CustomLib", "1.1.0", "CustomLib.Utilities.UnrelatedHelper");

    // 1. SubSensor.mo was byte-identical, yet its iconHash MUST change because BaseIcon changed!
    assert.notEqual(
      v2SubSensor?.iconHash,
      v1SubSensor?.iconHash,
      "SubSensor iconHash must change when inherited BaseIcon changes",
    );
    const subSensorIconV1 = storage.readSvg("CustomLib", "1.0.0", "CustomLib.Components.SubSensor", "icon");
    const subSensorIconV2 = storage.readSvg("CustomLib", "1.1.0", "CustomLib.Components.SubSensor", "icon");
    assert.notEqual(
      subSensorIconV1,
      subSensorIconV2,
      "SubSensor rendered icon SVG must reflect updated BaseIcon color",
    );

    // 2. SystemModel.mo was byte-identical; its own iconHash does NOT depend on s1, so iconHash stays equal,
    //    while its diagramHash DOES depend on s1's iconHash, so diagramHash MUST change!
    assert.equal(
      v2System?.iconHash,
      v1System?.iconHash,
      "SystemModel's own iconHash must remain unchanged when only a child component's icon changed",
    );
    assert.notEqual(
      v2System?.diagramHash,
      v1System?.diagramHash,
      "SystemModel's diagramHash must change when component s1's iconHash changed",
    );

    // 3. UnrelatedHelper's iconHash and diagramHash must remain identical and share CAS SVG hardlinks!
    assert.equal(v2Unrelated?.iconHash, v1Unrelated?.iconHash);
    assert.equal(v2Unrelated?.diagramHash, v1Unrelated?.diagramHash);
    const unrelSvg1 = path.join(
      storage.dataDir,
      "CustomLib",
      "1.0.0",
      "svgs",
      "CustomLib.Utilities.UnrelatedHelper",
      "icon.svg",
    );
    const unrelSvg2 = path.join(
      storage.dataDir,
      "CustomLib",
      "1.1.0",
      "svgs",
      "CustomLib.Utilities.UnrelatedHelper",
      "icon.svg",
    );
    assert.equal(fs.statSync(unrelSvg1).ino, fs.statSync(unrelSvg2).ino);
  });

  it("3. Lexical Import Invalidation: changing an enclosing package.mo import invalidates classes resolving through that import", async () => {
    const makePkg = (version: string, importedTarget: string) => ({
      "ImpLib/package.mo": `within;\npackage ImpLib\n  import ActiveIcon = ImpLib.Themes.${importedTarget};\n  annotation(version="${version}");\nend ImpLib;\n`,
      "ImpLib/Themes/package.mo": `within ImpLib;\npackage Themes\nend Themes;\n`,
      "ImpLib/Themes/BlueIcon.mo": `within ImpLib.Themes;\npartial class BlueIcon\n  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={0,0,255}, fillPattern=FillPattern.Solid)}));\nend BlueIcon;\n`,
      "ImpLib/Themes/GreenIcon.mo": `within ImpLib.Themes;\npartial class GreenIcon\n  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={0,255,0}, fillPattern=FillPattern.Solid)}));\nend GreenIcon;\n`,
      "ImpLib/Widget.mo": `within ImpLib;\nmodel Widget\n  extends ActiveIcon;\n  Real x = 1.0;\nend Widget;\n`,
    });

    const zip1 = await writeZipFromFiles(path.join(tmpDir, "ImpLib-1.0.0.zip"), makePkg("1.0.0", "BlueIcon"));
    await storage.store("ImpLib", "1.0.0", zip1);
    const ext1 = await storage.extractLibrary("ImpLib", "1.0.0");
    await processLibrary(
      ext1,
      new Set(),
      async (className, metadata, svgs) => {
        storage.storeSvg("ImpLib", "1.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("ImpLib", "1.0.0", metadata);
      },
      undefined,
    );

    const zip2 = await writeZipFromFiles(path.join(tmpDir, "ImpLib-2.0.0.zip"), makePkg("2.0.0", "GreenIcon"));
    await storage.store("ImpLib", "2.0.0", zip2);
    const ext2 = await storage.extractLibrary("ImpLib", "2.0.0");
    const prev = db.getPreviousVersionClassHashes("ImpLib", "2.0.0")!;
    await processLibrary(
      ext2,
      new Set(),
      async (className, metadata, svgs) => {
        storage.storeSvg("ImpLib", "2.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("ImpLib", "2.0.0", metadata);
      },
      undefined,
      {
        previousVersion: {
          version: prev.version,
          classes: prev.classes,
          readSvg: (c, k) => storage.readSvg("ImpLib", prev.version, c, k),
        },
      },
    );

    const w1 = db.getClass("ImpLib", "1.0.0", "ImpLib.Widget");
    const w2 = db.getClass("ImpLib", "2.0.0", "ImpLib.Widget");
    assert.notEqual(
      w1?.iconHash,
      w2?.iconHash,
      "Widget.mo is byte-identical, but changing import ActiveIcon in ImpLib/package.mo must invalidate Widget's iconHash",
    );
  });

  it("4. Cross-Library Dependency Hydration, Bundle Isolation, & Selective Cross-Library Upgrade", async () => {
    // 4a. Publish FoundationLib@1.0.0 and export its lsp-bundle.zip
    const foundV1Zip = await writeZipFromFiles(path.join(tmpDir, "FoundationLib-1.0.0.zip"), {
      "FoundationLib/package.mo": `within;\npackage FoundationLib\n  annotation(version="1.0.0");\nend FoundationLib;\n`,
      "FoundationLib/BaseIcon.mo": `within FoundationLib;\npartial class BaseIcon\n  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={0,180,90}, fillPattern=FillPattern.Solid)}));\nend BaseIcon;\n`,
      "FoundationLib/StableBlock.mo": `within FoundationLib;\npartial class StableBlock\n  annotation(Icon(graphics={Ellipse(extent={{-60,-60},{60,60}}, fillColor={240,200,0}, fillPattern=FillPattern.Solid)}));\nend StableBlock;\n`,
    });
    await storage.store("FoundationLib", "1.0.0", foundV1Zip);
    const extFoundV1 = await storage.extractLibrary("FoundationLib", "1.0.0");
    const foundV1Svgs: Record<string, string> = {};
    const foundV1Ctx = await processLibrary(
      extFoundV1,
      new Set(),
      async (className, metadata, svgs) => {
        if (svgs.icon) foundV1Svgs[className] = svgs.icon;
        storage.storeSvg("FoundationLib", "1.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("FoundationLib", "1.0.0", metadata);
      },
      undefined,
    );
    const foundV1BundlePath = path.join(storage.dataDir, "FoundationLib", "1.0.0", "lsp-bundle.zip");
    await exportLspBundle(foundV1Ctx.queryEngine, extFoundV1, foundV1BundlePath, foundV1Svgs);
    const foundV1BundleZip = new AdmZip(foundV1BundlePath);
    const foundV1IndexJson = JSON.parse(foundV1BundleZip.readAsText("index.json"));

    // 4b. Publish FoundationLib@2.0.0 where BaseIcon changes color, but StableBlock is unchanged
    const foundV2Zip = await writeZipFromFiles(path.join(tmpDir, "FoundationLib-2.0.0.zip"), {
      "FoundationLib/package.mo": `within;\npackage FoundationLib\n  annotation(version="2.0.0");\nend FoundationLib;\n`,
      "FoundationLib/BaseIcon.mo": `within FoundationLib;\npartial class BaseIcon\n  annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, fillColor={220,20,60}, fillPattern=FillPattern.Solid)}));\nend BaseIcon;\n`,
      "FoundationLib/StableBlock.mo": `within FoundationLib;\npartial class StableBlock\n  annotation(Icon(graphics={Ellipse(extent={{-60,-60},{60,60}}, fillColor={240,200,0}, fillPattern=FillPattern.Solid)}));\nend StableBlock;\n`,
    });
    await storage.store("FoundationLib", "2.0.0", foundV2Zip);
    const extFoundV2 = await storage.extractLibrary("FoundationLib", "2.0.0");
    const foundV2Svgs: Record<string, string> = {};
    const foundV2Ctx = await processLibrary(
      extFoundV2,
      new Set(),
      async (className, metadata, svgs) => {
        if (svgs.icon) foundV2Svgs[className] = svgs.icon;
        storage.storeSvg("FoundationLib", "2.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("FoundationLib", "2.0.0", metadata);
      },
      undefined,
    );
    const foundV2BundlePath = path.join(storage.dataDir, "FoundationLib", "2.0.0", "lsp-bundle.zip");
    await exportLspBundle(foundV2Ctx.queryEngine, extFoundV2, foundV2BundlePath, foundV2Svgs);
    const foundV2BundleZip = new AdmZip(foundV2BundlePath);
    const foundV2IndexJson = JSON.parse(foundV2BundleZip.readAsText("index.json"));

    // 4c. Process AppLib@1.0.0 depending on FoundationLib@1.0.0
    const appV1Zip = await writeZipFromFiles(path.join(tmpDir, "AppLib-1.0.0.zip"), {
      "AppLib/package.mo": `within;\npackage AppLib\n  annotation(version="1.0.0", uses(FoundationLib(version="1.0.0")));\nend AppLib;\n`,
      "AppLib/DynamicWidget.mo": `within AppLib;\nmodel DynamicWidget\n  extends FoundationLib.BaseIcon;\n  Real y = 2.0;\nend DynamicWidget;\n`,
      "AppLib/StableWidget.mo": `within AppLib;\nmodel StableWidget\n  extends FoundationLib.StableBlock;\n  Real z = 3.0;\nend StableWidget;\n`,
    });
    await storage.store("AppLib", "1.0.0", appV1Zip);
    const extAppV1 = await storage.extractLibrary("AppLib", "1.0.0");
    const appV1Svgs: Record<string, string> = {};
    const appV1Ctx = await processLibrary(
      extAppV1,
      new Set(),
      async (className, metadata, svgs) => {
        if (svgs.icon) appV1Svgs[className] = svgs.icon;
        storage.storeSvg("AppLib", "1.0.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("AppLib", "1.0.0", metadata);
      },
      undefined,
      {
        dependencies: [
          {
            name: "FoundationLib",
            version: "1.0.0",
            extractedPath: extFoundV1,
            bundleIndexJson: foundV1IndexJson,
            iconHashes: db.getClassIconHashes("FoundationLib", "1.0.0"),
          },
        ],
      },
    );

    // Verify AppLib.DynamicWidget inherited FoundationLib.BaseIcon's green color (rgb(0,180,90))
    const dynSvgV1 = storage.readSvg("AppLib", "1.0.0", "AppLib.DynamicWidget", "icon");
    assert.ok(dynSvgV1, "AppLib.DynamicWidget must have a rendered icon SVG inherited from FoundationLib.BaseIcon");
    assert.ok(
      dynSvgV1.includes("0,180,90") || dynSvgV1.toLowerCase().includes("#00b45a"),
      `Expected inherited green fill from FoundationLib.BaseIcon@1.0.0 in SVG, got: ${dynSvgV1}`,
    );

    // Verify Bundle Isolation: AppLib's exported lsp-bundle.zip & salsa-index.db must NOT contain FoundationLib symbols
    const appV1BundlePath = path.join(storage.dataDir, "AppLib", "1.0.0", "lsp-bundle.zip");
    await exportLspBundle(appV1Ctx.queryEngine, extAppV1, appV1BundlePath, appV1Svgs);
    const appV1BundleIndex = JSON.parse(new AdmZip(appV1BundlePath).readAsText("index.json")) as {
      symbols: Array<[number, { name: string; resourceId: string }]>;
      byName: Array<[string, number[]]>;
    };
    const exportedNames = appV1BundleIndex.byName.map(([k]) => k);
    assert.ok(exportedNames.includes("AppLib"));
    assert.ok(exportedNames.includes("DynamicWidget"));
    assert.ok(
      !exportedNames.includes("FoundationLib") && !exportedNames.includes("BaseIcon"),
      "Exported lsp-bundle.zip index.json must exclude hydrated external dependency symbols",
    );

    const { exportSalsaIndex } = await import("../src/util/salsa-index-exporter.js");
    const appV1SalsaPath = storage.getIndexPath("AppLib", "1.0.0");
    await exportSalsaIndex(appV1Ctx.queryEngine, appV1SalsaPath, extAppV1);
    const Database = (await import("better-sqlite3")).default;
    const salsaDb = new Database(appV1SalsaPath, { readonly: true });
    const salsaSymbols = (salsaDb.prepare("SELECT data FROM symbols").all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as { name: string; resourceId: string },
    );
    salsaDb.close();
    assert.ok(salsaSymbols.some((s) => s.name === "AppLib"));
    assert.ok(
      !salsaSymbols.some((s) => s.name === "FoundationLib" || s.resourceId?.startsWith("dep-bundle:/")),
      "Exported salsa-index.db must exclude hydrated external dependency symbols",
    );

    // 4d. Upgrade AppLib@1.1.0 to FoundationLib@2.0.0
    const appV2Zip = await writeZipFromFiles(path.join(tmpDir, "AppLib-1.1.0.zip"), {
      "AppLib/package.mo": `within;\npackage AppLib\n  annotation(version="1.1.0", uses(FoundationLib(version="2.0.0")));\nend AppLib;\n`,
      "AppLib/DynamicWidget.mo": `within AppLib;\nmodel DynamicWidget\n  extends FoundationLib.BaseIcon;\n  Real y = 2.0;\nend DynamicWidget;\n`,
      "AppLib/StableWidget.mo": `within AppLib;\nmodel StableWidget\n  extends FoundationLib.StableBlock;\n  Real z = 3.0;\nend StableWidget;\n`,
    });
    await storage.store("AppLib", "1.1.0", appV2Zip);
    const extAppV2 = await storage.extractLibrary("AppLib", "1.1.0");
    const appPrev = db.getPreviousVersionClassHashes("AppLib", "1.1.0")!;

    await processLibrary(
      extAppV2,
      new Set(),
      async (className, metadata, svgs) => {
        storage.storeSvg("AppLib", "1.1.0", className, svgs.icon, svgs.diagram);
        db.storeClassMetadata("AppLib", "1.1.0", metadata);
      },
      undefined,
      {
        dependencies: [
          {
            name: "FoundationLib",
            version: "2.0.0",
            extractedPath: extFoundV2,
            bundleIndexJson: foundV2IndexJson,
            iconHashes: db.getClassIconHashes("FoundationLib", "2.0.0"),
          },
        ],
        previousVersion: {
          version: appPrev.version,
          classes: appPrev.classes,
          readSvg: (c, k) => storage.readSvg("AppLib", appPrev.version, c, k),
        },
      },
    );

    const dynV1Meta = db.getClass("AppLib", "1.0.0", "AppLib.DynamicWidget")!;
    const dynV2Meta = db.getClass("AppLib", "1.1.0", "AppLib.DynamicWidget")!;
    const stableV1Meta = db.getClass("AppLib", "1.0.0", "AppLib.StableWidget")!;
    const stableV2Meta = db.getClass("AppLib", "1.1.0", "AppLib.StableWidget")!;

    assert.notEqual(
      dynV1Meta.iconHash,
      dynV2Meta.iconHash,
      "AppLib.DynamicWidget iconHash must change when FoundationLib.BaseIcon changes in FoundationLib@2.0.0",
    );
    const dynSvgV2 = storage.readSvg("AppLib", "1.1.0", "AppLib.DynamicWidget", "icon");
    assert.ok(
      dynSvgV2?.includes("220,20,60") || dynSvgV2?.toLowerCase().includes("#dc143c"),
      `Expected updated crimson fill from FoundationLib.BaseIcon@2.0.0 in SVG, got: ${dynSvgV2}`,
    );

    assert.equal(
      stableV1Meta.iconHash,
      stableV2Meta.iconHash,
      "AppLib.StableWidget iconHash must stay identical across FoundationLib 1.0.0 -> 2.0.0 because FoundationLib.StableBlock did not change",
    );
  });

  it("5. Unified LSP Version Resolution & Hot-Swapping: swaps mounted library versions and version-namespaced icons", async () => {
    // Test dependency extraction from both Modelica uses(...) and package.json
    const moDeps = extractDeclaredDependenciesFromSource(
      `within;\npackage MyPkg\n  annotation(uses(Modelica(version="4.0.0"), FoundationLib(version="2.0.0")));\nend MyPkg;`,
      "file:///workspace/package.mo",
    );
    assert.deepEqual(moDeps, [
      { name: "Modelica", version: "4.0.0" },
      { name: "FoundationLib", version: "2.0.0" },
    ]);

    const jsonDeps = extractDeclaredDependenciesFromSource(
      JSON.stringify({
        name: "my-project",
        dependencies: {
          Modelica: "^4.1.0",
          FoundationLib: "1.0.0",
        },
      }),
      "file:///workspace/package.json",
    );
    assert.deepEqual(jsonDeps, [
      { name: "Modelica", version: "4.1.0" },
      { name: "FoundationLib", version: "1.0.0" },
    ]);

    // Test version-namespaced iconCache and hot-swapping in LoaderContext
    const wsIndex = createModelicaWorkspaceIndex();
    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      sharedFs: new BrowserFileSystem(),
      sharedContext: null,
      globalWorkspaceIndex: wsIndex,
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    iconCache.set("FoundationLib@1.0.0:FoundationLib.BaseIcon", "<svg id='v1'/>");
    iconCache.set("FoundationLib@2.0.0:FoundationLib.BaseIcon", "<svg id='v2'/>");

    // Simulate mounting FoundationLib@1.0.0 in WorkspaceIndex
    wsIndex.hydrate("library-bundle:/FoundationLib@1.0.0", {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "FoundationLib",
            kind: "Class",
            ruleName: "class_definition",
            parentId: null,
            resourceId: "library-bundle:/FoundationLib@1.0.0",
            startOffset: 0,
            endOffset: 10,
          } as any,
        ],
      ]),
      byName: new Map([["FoundationLib", [1]]]),
      childrenOf: new Map([[null, [1]]]),
    });
    mountedLibraryMetadata.set("FoundationLib", { name: "FoundationLib", version: "1.0.0" });
    assert.equal(getCachedClassIcon("FoundationLib.BaseIcon"), "<svg id='v1'/>");

    // Switch active metadata to 2.0.0 and verify getCachedClassIcon resolves the 2.0.0 icon
    mountedLibraryMetadata.set("FoundationLib", { name: "FoundationLib", version: "2.0.0" });
    assert.equal(getCachedClassIcon("FoundationLib.BaseIcon"), "<svg id='v2'/>");

    // Verify unloadLibraryPackage evicts library-bundle:/FoundationLib@1.0.0 from WorkspaceIndex
    const evicted = unloadLibraryPackage("FoundationLib", loaderCtx);
    assert.ok(evicted >= 1, "unloadLibraryPackage must evict hydrated library-bundle URI");
    assert.equal(mountedLibraryMetadata.has("FoundationLib"), false);
  });
});
