// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { IgtlErrorCode, lintIgtlDocument } from "../src/lints/index.js";
import { parseIgtl } from "../src/parser/index.js";

describe("OpenIGTLink & PLUS Surgical Navigation Semantic Linter (M9801–M9810)", () => {
  it("passes a valid surgical navigation configuration with zero diagnostics", () => {
    const validXml = `<PlusConfiguration version="2.1">
      <DataCollection>
        <DeviceSet Name="ValidNav">
          <Device Id="TrackerDevice" Type="PolarisTracker" AcquisitionRate="60">
            <OutputChannels><OutputChannel Id="TrackerStream"/></OutputChannels>
          </Device>
        </DeviceSet>
      </DataCollection>
      <CoordinateDefinitions>
        <Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0  0 1 0 0  0 0 1 120  0 0 0 1" Error="0.35"/>
        <Transform From="Stylus" To="Reference" Matrix="1 0 0 10  0 1 0 20  0 0 1 30  0 0 0 1" Error="0.25"/>
      </CoordinateDefinitions>
      <PlusOpenIGTLinkServer ListeningPort="18944" OutputChannelId="TrackerStream">
        <DefaultClientInfo>
          <TransformNames><Transform Name="StylusTipToReference"/></TransformNames>
        </DefaultClientInfo>
      </PlusOpenIGTLinkServer>
    </PlusConfiguration>`;

    const doc = parseIgtl(validXml);
    const diags = lintIgtlDocument(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M9801 (non-orthogonal R), M9802 (bad bottom row), M9805 (excessive error), M9808 (non-identity self-transform), and M9810 (duplicate edge)", () => {
    const badMatricesXml = `<PlusConfiguration version="2.1">
      <CoordinateDefinitions>
        <Transform From="StylusTip" To="Stylus" Matrix="2 0 0 0  0 1 0 0  0 0 1 100  0 0 0 1" Error="3.45"/>
        <Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0  0 1 0 0  0 0 1 100  0 0 0 1"/>
        <Transform From="Stylus" To="Reference" Matrix="1 0 0 0  0 1 0 0  0 0 1 10  0 0 5 2"/>
        <Transform From="Reference" To="Reference" Matrix="1 0 0 99  0 1 0 0  0 0 1 0  0 0 0 1"/>
      </CoordinateDefinitions>
    </PlusConfiguration>`;

    const doc = parseIgtl(badMatricesXml);
    const diags = lintIgtlDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(IgtlErrorCode.NON_ORTHOGONAL_ROTATION.code));
    assert(codes.has(IgtlErrorCode.INVALID_HOMOGENEOUS_BOTTOM_ROW.code));
    assert(codes.has(IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.code));
    assert(codes.has(IgtlErrorCode.SELF_TRANSFORM_IDENTITY_MISMATCH.code));
    assert(codes.has(IgtlErrorCode.DUPLICATE_TRANSFORM_EDGE.code));
  });

  it("detects M9803 (disconnected frame), M9804 (cyclic chain), M9806 (invalid rate), M9807 (unresolved channel), and M9809 (invalid TCP port)", () => {
    const graphAndServerXml = `<PlusConfiguration version="2.1">
      <DataCollection>
        <DeviceSet Name="BadSet">
          <Device Id="BrokenTracker" Type="PolarisTracker" AcquisitionRate="-10">
            <OutputChannels><OutputChannel Id="ValidStream"/></OutputChannels>
          </Device>
        </DeviceSet>
      </DataCollection>
      <CoordinateDefinitions>
        <Transform From="FrameA" To="FrameB" Matrix="1 0 0 1  0 1 0 0  0 0 1 0  0 0 0 1"/>
        <Transform From="FrameB" To="FrameC" Matrix="1 0 0 1  0 1 0 0  0 0 1 0  0 0 0 1"/>
        <Transform From="FrameC" To="FrameA" Matrix="1 0 0 1  0 1 0 0  0 0 1 0  0 0 0 1"/>
        <Transform From="IsolatedIsland1" To="IsolatedIsland2" Matrix="1 0 0 5  0 1 0 0  0 0 1 0  0 0 0 1"/>
      </CoordinateDefinitions>
      <PlusOpenIGTLinkServer ListeningPort="80" OutputChannelId="MissingStream">
        <DefaultClientInfo>
          <TransformNames><Transform Name="FrameAToIsolatedIsland1"/></TransformNames>
        </DefaultClientInfo>
      </PlusOpenIGTLinkServer>
    </PlusConfiguration>`;

    const doc = parseIgtl(graphAndServerXml);
    const diags = lintIgtlDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.code));
    assert(codes.has(IgtlErrorCode.CYCLIC_TRANSFORM_CHAIN.code));
    assert(codes.has(IgtlErrorCode.INVALID_ACQUISITION_RATE.code));
    assert(codes.has(IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.code));
    assert(codes.has(IgtlErrorCode.INVALID_SERVER_PORT.code));
  });
});
