// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseIgtl } from "../src/parser/index.js";

describe("OpenIGTLink (.igtl) and PLUS Toolkit (.plus.xml) Parser", () => {
  const samplePlusXml = `<PlusConfiguration version="2.1">
  <DataCollection StartupDelaySec="1.0">
    <DeviceSet Name="SurgicalNavigationSet" Description="NDI Polaris Optical Tracker + Ultrasound">
      <Device Id="TrackerDevice" Type="PolarisTracker" AcquisitionRate="60" ToolReferenceFrame="Tracker">
        <DataSources>
          <DataSource Type="Tool" Id="Stylus" PortName="0" BufferSize="150"/>
          <DataSource Type="Tool" Id="Reference" PortName="1" BufferSize="150"/>
        </DataSources>
        <OutputChannels>
          <OutputChannel Id="TrackerStream"/>
        </OutputChannels>
      </Device>
    </DeviceSet>
  </DataCollection>
  <CoordinateDefinitions>
    <Transform From="StylusTip" To="Stylus"
      Matrix="1 0 0 0  0 1 0 0  0 0 1 150.0  0 0 0 1"
      Error="0.42" Date="2026.01.15"/>
    <Transform From="Stylus" To="Tracker"
      Matrix="1 0 0 10.0  0 1 0 20.0  0 0 1 30.0  0 0 0 1"
      Error="0.18"/>
    <Transform From="Tracker" To="Reference"
      Matrix="1 0 0 5.0  0 1 0 -10.0  0 0 1 40.0  0 0 0 1"
      Error="0.22"/>
  </CoordinateDefinitions>
  <PlusOpenIGTLinkServer MaxNumberOfIgtlMessagesToSend="5" ListeningPort="18944" OutputChannelId="TrackerStream">
    <DefaultClientInfo>
      <MessageTypes>
        <Message Type="TRANSFORM"/>
      </MessageTypes>
      <TransformNames>
        <Transform Name="StylusTipToReference"/>
      </TransformNames>
    </DefaultClientInfo>
  </PlusOpenIGTLinkServer>
  <FiducialRegistration FLE="0.5" FRE="0.45" TRE="0.62" Target="20 15 30">
    <Fiducial Position="-50 -50 0"/>
    <Fiducial Position="50 -50 0"/>
    <Fiducial Position="50 50 0"/>
    <Fiducial Position="-50 50 0"/>
  </FiducialRegistration>
</PlusConfiguration>`;

  it("parses PLUS Toolkit .plus.xml configuration, devices, channels, SE(3) transforms, and IGTL servers", () => {
    const doc = parseIgtl(samplePlusXml, "file:///polaris.plus.xml");
    assert.strictEqual(doc.version, "2.1");
    assert.strictEqual(doc.devices.length, 1);
    assert.strictEqual(doc.devices[0]?.id, "TrackerDevice");
    assert.strictEqual(doc.devices[0]?.acquisitionRate, 60);
    assert.strictEqual(doc.devices[0]?.dataSources.length, 2);
    assert.deepStrictEqual(doc.devices[0]?.outputChannelIds, ["TrackerStream"]);

    assert.strictEqual(doc.transforms.length, 3);
    assert.strictEqual(doc.transforms[0]?.from, "StylusTip");
    assert.strictEqual(doc.transforms[0]?.to, "Stylus");
    assert.strictEqual(doc.transforms[0]?.matrix[11], 150.0);
    assert.strictEqual(doc.transforms[0]?.errorMm, 0.42);

    assert.strictEqual(doc.servers.length, 1);
    assert.strictEqual(doc.servers[0]?.listeningPort, 18944);
    assert.strictEqual(doc.servers[0]?.transformNames[0]?.from, "StylusTip");
    assert.strictEqual(doc.servers[0]?.transformNames[0]?.to, "Reference");

    assert(doc.fiducialConfig !== undefined);
    assert.strictEqual(doc.fiducialConfig?.fiducials.length, 4);

    // JSON round-trip
    const roundTrip = parseIgtl(JSON.stringify(doc));
    assert.strictEqual(roundTrip.transforms.length, 3);
  });

  it("parses OpenIGTLink .igtl XML message stream", () => {
    const igtlStream = `<OpenIGTLinkStream>
      <IgtlMessage Type="TRANSFORM" DeviceName="ProbeToTracker" Matrix="1 0 0 12.5  0 1 0 -4.0  0 0 1 88.0  0 0 0 1" Error="0.3"/>
    </OpenIGTLinkStream>`;
    const doc = parseIgtl(igtlStream, "file:///stream.igtl");
    assert.strictEqual(doc.messages.length, 1);
    assert.strictEqual(doc.transforms.length, 1);
    assert.strictEqual(doc.transforms[0]?.from, "Probe");
    assert.strictEqual(doc.transforms[0]?.to, "Tracker");
    assert.strictEqual(doc.transforms[0]?.matrix[3], 12.5);
  });
});
