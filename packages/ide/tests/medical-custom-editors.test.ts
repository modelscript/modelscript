// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { DicomRtEditorProvider, IgtlEditorProvider, OpenSimEditorProvider } from "../src/medical-editor-provider.js";

const SAMPLE_OPENSIM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSimDocument Version="40000">
  <Model name="Arm26_SurgicalRehab">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <objects>
        <Body name="humerus">
          <mass>1.86457</mass>
          <mass_center>0 -0.180496 0</mass_center>
          <inertia>0.01481 0.004551 0.013193 0 0 0</inertia>
        </Body>
        <Body name="radius_ulna">
          <mass>1.53432</mass>
          <mass_center>0 -0.181479 0</mass_center>
          <inertia>0.019281 0.001571 0.020062 0 0 0</inertia>
        </Body>
      </objects>
    </BodySet>
    <JointSet>
      <objects>
        <PinJoint name="shoulder">
          <socket_parent_frame>ground</socket_parent_frame>
          <socket_child_frame>humerus</socket_child_frame>
          <coordinates>
            <Coordinate name="r_shoulder_elev">
              <default_value>0.1</default_value>
              <range>-1.5708 3.14159</range>
            </Coordinate>
          </coordinates>
        </PinJoint>
        <PinJoint name="elbow">
          <socket_parent_frame>humerus</socket_parent_frame>
          <socket_child_frame>radius_ulna</socket_child_frame>
          <coordinates>
            <Coordinate name="r_elbow_flex">
              <default_value>0.5</default_value>
              <range>0.0 2.61799</range>
            </Coordinate>
          </coordinates>
        </PinJoint>
      </objects>
    </JointSet>
    <ForceSet>
      <objects>
        <Thelen2003Muscle name="BIClong">
          <max_isometric_force>624.3</max_isometric_force>
          <optimal_fiber_length>0.1157</optimal_fiber_length>
          <tendon_slack_length>0.2723</tendon_slack_length>
          <pennation_angle_at_optimal>0.0</pennation_angle_at_optimal>
          <activation_time_constant>0.01</activation_time_constant>
          <deactivation_time_constant>0.04</deactivation_time_constant>
          <GeometryPath>
            <PathPointSet>
              <objects>
                <PathPoint name="BIClong_p1">
                  <socket_parent_frame>humerus</socket_parent_frame>
                  <location>-0.031 -0.015 0.012</location>
                </PathPoint>
                <PathPoint name="BIClong_p2">
                  <socket_parent_frame>radius_ulna</socket_parent_frame>
                  <location>0.008 -0.048 -0.002</location>
                </PathPoint>
              </objects>
            </PathPointSet>
          </GeometryPath>
        </Thelen2003Muscle>
      </objects>
    </ForceSet>
  </Model>
</OpenSimDocument>`;

const SAMPLE_DICOM_RT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DicomRtPlan planId="RTPLAN-PROSTATE-01" planLabel="Prostate_VMAT_78Gy" patientId="PT-1042" frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100" prescribedDoseGy="78.0" fractions="39">
  <StructureSet frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100">
    <ROI roiNumber="1" name="PTV_78" interpretedType="PTV" volumeCc="95.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR">
        <Point x="-20" y="-20" z="0.0"/>
        <Point x="20" y="-20" z="0.0"/>
        <Point x="20" y="20" z="0.0"/>
        <Point x="-20" y="20" z="0.0"/>
      </Contour>
    </ROI>
    <ROI roiNumber="2" name="Rectum" interpretedType="ORGAN" volumeCc="65.0" maxDoseLimitGy="75.0" meanDoseLimitGy="50.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR">
        <Point x="-15" y="-45" z="0.0"/>
        <Point x="15" y="-45" z="0.0"/>
        <Point x="15" y="-25" z="0.0"/>
      </Contour>
    </ROI>
  </StructureSet>
  <BeamSequence>
    <Beam beamNumber="1" name="Arc_1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="420.0" doseRateMuPerMin="600.0">
      <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="181.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX="-50 50" jawY="-50 50">
        <MLCLeafPair pairIndex="1" bankA="-22.0" bankB="22.0"/>
        <MLCLeafPair pairIndex="2" bankA="-25.0" bankB="25.0"/>
      </ControlPoint>
      <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="179.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX="-50 50" jawY="-50 50">
        <MLCLeafPair pairIndex="1" bankA="-20.0" bankB="20.0"/>
        <MLCLeafPair pairIndex="2" bankA="-24.0" bankB="24.0"/>
      </ControlPoint>
    </Beam>
  </BeamSequence>
  <DoseDistribution frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100">
    <DVH roiNumber="1" roiName="PTV_78" d98Gy="75.2" d95Gy="76.5" d50Gy="78.4" d2Gy="80.8" meanDoseGy="78.3" maxDoseGy="81.5" minDoseGy="73.9" v20GyPercent="100.0"/>
    <DVH roiNumber="2" roiName="Rectum" d98Gy="12.0" d95Gy="18.0" d50Gy="38.5" d2Gy="71.0" meanDoseGy="41.2" maxDoseGy="73.4" minDoseGy="8.0" v20GyPercent="72.0"/>
  </DoseDistribution>
</DicomRtPlan>`;

const SAMPLE_IGTL_PLUS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PlusConfiguration version="2.8">
  <DataCollection StartupDelaySec="1.0">
    <DeviceSet>
      <Device Id="TrackerDevice" Type="PolarisVicra" AcquisitionRate="60" ToolReferenceFrame="Tracker">
        <DataSources>
          <DataSource Type="Tool" Id="Stylus" PortName="0"/>
          <DataSource Type="Tool" Id="Reference" PortName="1"/>
        </DataSources>
        <OutputChannels>
          <OutputChannel Id="TrackerStream"/>
        </OutputChannels>
      </Device>
    </DeviceSet>
  </DataCollection>
  <CoordinateDefinitions>
    <Transform From="StylusTip" To="Stylus"
      Matrix="1 0 0 0  0 1 0 0  0 0 1 -150.0  0 0 0 1"
      Error="0.35"/>
    <Transform From="Stylus" To="Tracker"
      Matrix="1 0 0 120.0  0 1 0 -45.0  0 0 1 820.0  0 0 0 1"
      Error="0.22"/>
    <Transform From="Tracker" To="Reference"
      Matrix="1 0 0 -100.0  0 1 0 50.0  0 0 1 -800.0  0 0 0 1"
      Error="0.18"/>
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
  <PivotCalibration>
    <Pose Matrix="1 0 0 0  0 1 0 0  0 0 1 150.0  0 0 0 1"/>
    <Pose Matrix="0 -1 0 0  1 0 0 0  0 0 1 150.0  0 0 0 1"/>
    <Pose Matrix="1 0 0 0  0 0 -1 0  0 1 0 150.0  0 0 0 1"/>
  </PivotCalibration>
  <FiducialRegistration FLE="0.4" Target="10 15 20">
    <Fiducial Point="-50 -40 0"/>
    <Fiducial Point="50 -40 0"/>
    <Fiducial Point="50 40 0"/>
    <Fiducial Point="-50 40 30"/>
  </FiducialRegistration>
</PlusConfiguration>`;

describe("Radiology & Surgery Custom Visual Editor Providers (OpenSim, DICOM-RT, OpenIGTLink)", () => {
  it("resolves OpenSimEditorProvider and renders Musculoskeletal Kinematic Tree & Hill Muscle SVG", async () => {
    assert.equal(OpenSimEditorProvider.viewType, "modelscript.opensimEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new OpenSimEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    let receiveHandler: ((msg: any) => Promise<void> | void) | undefined;

    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: (cb: (msg: any) => Promise<void> | void) => {
        receiveHandler = cb;
        return { dispose: () => {} };
      },
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = {
      uri: { toString: () => "file:///workspace/arm26.osim" },
      getText: () => SAMPLE_OPENSIM_XML,
    };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for OpenSim");
    assert.equal(update.modelName, "Arm26_SurgicalRehab");
    assert.equal(update.bodyCount, 2);
    assert.equal(update.jointCount, 2);
    assert.equal(update.muscleCount, 1);
    assert.equal(update.diagnostics.length, 0);
    assert.ok(update.kinematicTreeSvg.includes("<svg"), "Must render OpenSim kinematic tree SVG");
    assert.ok(update.muscleChartSvg.includes("<svg"), "Must render Hill-type muscle force-length SVG");
    assert.ok(update.modelicaCode.includes("model Arm26_SurgicalRehab"), "Must project OpenSim to Modelica");
    assert.ok(update.urdfXml.includes('<robot name="Arm26_SurgicalRehab">'), "Must project OpenSim to URDF");

    if (receiveHandler) {
      await receiveHandler({ type: "exportModelica" });
      await receiveHandler({ type: "exportUrdf" });
    }
  });

  it("resolves DicomRtEditorProvider and renders DVH/BED/EQD2 Chart & Beam's Eye View MLC SVG", async () => {
    assert.equal(DicomRtEditorProvider.viewType, "modelscript.dicomRtEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new DicomRtEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    let receiveHandler: ((msg: any) => Promise<void> | void) | undefined;

    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: (cb: (msg: any) => Promise<void> | void) => {
        receiveHandler = cb;
        return { dispose: () => {} };
      },
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = {
      uri: { toString: () => "file:///workspace/plan.rtplan" },
      getText: () => SAMPLE_DICOM_RT_XML,
    };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for DICOM-RT");
    assert.equal(update.planLabel, "Prostate_VMAT_78Gy");
    assert.equal(update.prescribedDoseGy, 78.0);
    assert.equal(update.fractions, 39);
    assert.equal(update.diagnostics.length, 0);
    assert.ok(update.dosimetry.prescriptionBedGy > 90, "Must compute LQ BED (> 90 Gy)");
    assert.ok(Math.abs(update.dosimetry.prescriptionEqd2Gy - 78.0) < 0.1, "Must compute EQD2 (~78 Gy)");
    assert.ok(update.dvhChartSvg.includes("<svg"), "Must render cumulative DVH SVG");
    assert.ok(update.bevMlcSvg.includes("<svg"), "Must render Beam's Eye View MLC SVG");
    assert.ok(update.scadCode.includes("module roi_1_PTV_78"), "Must project DICOM-RT to OpenSCAD");
    assert.ok(update.sysml2Code.includes("package Prostate_VMAT_78Gy"), "Must project DICOM-RT to SysML v2");

    if (receiveHandler) {
      await receiveHandler({ type: "exportScad" });
      await receiveHandler({ type: "exportSysML2" });
    }
  });

  it("resolves IgtlEditorProvider and renders SE(3) Transform Chain & Stylus Pivot Calibration / TRE SVG", async () => {
    assert.equal(IgtlEditorProvider.viewType, "modelscript.igtlEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new IgtlEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    let receiveHandler: ((msg: any) => Promise<void> | void) | undefined;

    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: (cb: (msg: any) => Promise<void> | void) => {
        receiveHandler = cb;
        return { dispose: () => {} };
      },
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = {
      uri: { toString: () => "file:///workspace/nav.plus.xml" },
      getText: () => SAMPLE_IGTL_PLUS_XML,
    };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for OpenIGTLink / PLUS");
    assert.equal(update.deviceCount, 1);
    assert.equal(update.transformCount, 3);
    assert.equal(update.serverCount, 1);
    assert.equal(update.diagnostics.length, 0);
    assert.equal(update.navigation.isConnected, true);
    assert.ok(update.navigation.pivotCalibration, "Must compute stylus pivot calibration");
    assert.ok(update.navigation.fitzpatrickTre, "Must compute Fitzpatrick TRE");
    assert.ok(update.transformGraphSvg.includes("<svg"), "Must render SE(3) coordinate frame chain SVG");
    assert.ok(update.pivotTreSvg.includes("<svg"), "Must render Stylus Pivot Calibration & TRE SVG");
    assert.ok(update.urdfXml.includes('<robot name="SurgicalNavigationRobot">'), "Must project IGTL to URDF");
    assert.ok(update.modelicaCode.includes("model SurgicalNavigationModel"), "Must project IGTL to Modelica");

    if (receiveHandler) {
      await receiveHandler({ type: "exportUrdf" });
      await receiveHandler({ type: "exportModelica" });
    }
  });
});
