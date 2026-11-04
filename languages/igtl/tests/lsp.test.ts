// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeIgtlAction,
  getIgtlCompletions,
  getIgtlDefinition,
  getIgtlDocumentSymbols,
  getIgtlHover,
  igtlLanguage,
  IgtlWorkspaceIndex,
  validateIgtl,
} from "../src/index.js";

describe("OpenIGTLink / PLUS LSP Service & WorkspaceIndex", () => {
  const sampleXml = `<PlusConfiguration version="2.1">
  <DataCollection>
    <DeviceSet Name="SurgicalTracking">
      <Device Id="TrackerDevice" Type="PolarisTracker" AcquisitionRate="60" ToolReferenceFrame="Tracker">
        <DataSources>
          <DataSource Type="Tool" Id="Stylus" PortName="0"/>
        </DataSources>
        <OutputChannels>
          <OutputChannel Id="TrackerStream"/>
        </OutputChannels>
      </Device>
    </DeviceSet>
  </DataCollection>
  <CoordinateDefinitions>
    <Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0  0 1 0 0  0 0 1 150  0 0 0 1" Error="0.35"/>
    <Transform From="Stylus" To="Reference" Matrix="1 0 0 10  0 1 0 20  0 0 1 30  0 0 0 1" Error="0.25"/>
  </CoordinateDefinitions>
  <PlusOpenIGTLinkServer ListeningPort="18944" OutputChannelId="TrackerStream">
    <DefaultClientInfo>
      <TransformNames><Transform Name="StylusTipToReference"/></TransformNames>
    </DefaultClientInfo>
  </PlusOpenIGTLinkServer>
</PlusConfiguration>`;

  it("indexes symbols in IgtlWorkspaceIndex and resolves across scope", () => {
    const idx = new IgtlWorkspaceIndex();
    const uri = "file:///nav.plus.xml";
    idx.indexFile(uri, sampleXml);
    assert.strictEqual(idx.fileCount, 1);
    assert(idx.has(uri));

    const devSyms = idx.findByName("TrackerDevice");
    assert.strictEqual(devSyms.length, 1);
    assert.strictEqual(devSyms[0]?.kind, "Component");

    const ds = idx.resolveInScope("Stylus", devSyms[0]!.id, uri);
    assert(ds !== null);
    assert.strictEqual(ds.namePath, "TrackerDevice.Stylus");
  });

  it("provides LSP diagnostics, symbols, hover cards, completions, definition, and actions", async () => {
    assert.strictEqual(igtlLanguage.name, "igtl");
    assert(igtlLanguage.fileExtensions.includes(".igtl"));
    assert(igtlLanguage.fileExtensions.includes(".plus.xml"));

    const diags = validateIgtl(sampleXml);
    assert.strictEqual(diags.length, 0);

    const symbols = getIgtlDocumentSymbols(sampleXml);
    assert.strictEqual(symbols.length, 4);

    const hover = getIgtlHover(sampleXml, sampleXml.indexOf("StylusTip"));
    assert(hover !== null);
    assert(hover.contents.value.includes("Orthogonality Error"));

    const def = getIgtlDefinition(sampleXml, sampleXml.lastIndexOf("TrackerStream"), "file:///nav.plus.xml");
    assert(def !== null);
    assert.strictEqual(def.range.start.line, 3);

    const completions = getIgtlCompletions(sampleXml);
    assert(completions.some((c) => c.label === "TrackerDevice"));
    assert(completions.some((c) => c.label === "StylusTipToStylus"));

    const kinRes = await executeIgtlAction("igtl_solve_kinematics", sampleXml);
    assert.strictEqual(kinRes.isConnected, true);
    assert.deepStrictEqual(kinRes.translationMm, [10, 20, 180]);
  });
});
