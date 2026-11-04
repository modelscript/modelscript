// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { renderDicomRtBevSvg, renderDicomRtDvhSvg, type DicomRtDocumentLike } from "../src/dicom-rt-diagram-builder.js";
import {
  renderIgtlTransformTreeSvg,
  type IgtlDocumentLike,
  type IgtlNavigationResultLike,
} from "../src/igtl-diagram-builder.js";
import {
  renderOpenSimForceCurveSvg,
  renderOpenSimTopologySvg,
  type OpenSimDocumentLike,
  type OpenSimSimulationLike,
} from "../src/opensim-diagram-builder.js";

const sampleOpenSimDoc: OpenSimDocumentLike = {
  modelName: "Arm26_Musculoskeletal",
  version: "40000",
  gravity: [0, -9.80665, 0],
  bodies: [
    {
      name: "humerus",
      mass: 1.864,
      massCenter: [0, -0.18, 0],
      inertia: [0.0148, 0.0045, 0.0131, 0, 0, 0],
    },
    {
      name: "radius_ulna",
      mass: 1.534,
      massCenter: [0, -0.14, 0],
      inertia: [0.0192, 0.0015, 0.02, 0, 0, 0],
    },
  ],
  joints: [
    {
      name: "shoulder",
      jointType: "PinJoint",
      parentFrame: "ground",
      childFrame: "humerus",
      coordinates: [
        {
          name: "shoulder_elev",
          motionType: "rotational",
          defaultValue: 0,
          rangeMin: -1.57,
          rangeMax: 3.14,
          clamped: true,
          locked: false,
        },
      ],
    },
    {
      name: "elbow",
      jointType: "PinJoint",
      parentFrame: "humerus",
      childFrame: "radius_ulna",
      coordinates: [
        {
          name: "elbow_flexion",
          motionType: "rotational",
          defaultValue: 0.5,
          rangeMin: 0.0,
          rangeMax: 2.62,
          clamped: true,
          locked: false,
        },
      ],
    },
  ],
  wrapObjects: [
    {
      name: "WrapElbowCyl",
      wrapType: "WrapCylinder",
      bodyFrame: "humerus",
      radius: 0.025,
      length: 0.05,
    },
  ],
  markers: [
    { name: "LatEpicondyle", bodyFrame: "humerus", location: [0.01, -0.28, 0.03] },
    { name: "RadialStyloid", bodyFrame: "radius_ulna", location: [0.0, -0.24, 0.02] },
  ],
  muscles: [
    {
      name: "BIClong",
      muscleType: "Thelen2003Muscle",
      maxIsometricForce: 624.3,
      optimalFiberLength: 0.1157,
      tendonSlackLength: 0.2723,
      pennationAngleAtOptimal: 0.0,
      pathPoints: [
        { name: "BIClong_p1", bodyFrame: "ground", location: [-0.03, 0.01, 0] },
        { name: "BIClong_p2", bodyFrame: "humerus", location: [0.02, -0.15, 0] },
        { name: "BIClong_p3", bodyFrame: "radius_ulna", location: [0.04, -0.05, 0] },
      ],
      wrapObjects: ["WrapElbowCyl"],
    },
    {
      name: "TRIlong",
      muscleType: "Millard2012EquilibriumMuscle",
      maxIsometricForce: 798.5,
      optimalFiberLength: 0.134,
      tendonSlackLength: 0.143,
      pennationAngleAtOptimal: 0.21,
      pathPoints: [
        { name: "TRIlong_p1", bodyFrame: "humerus", location: [-0.02, -0.12, 0] },
        { name: "TRIlong_p2", bodyFrame: "radius_ulna", location: [-0.02, 0.02, 0] },
      ],
    },
  ],
};

const sampleOpenSimSim: OpenSimSimulationLike = {
  time: [0.0, 0.05, 0.1, 0.15, 0.2],
  steps: 4,
  muscles: {
    BIClong: {
      activation: [0.05, 0.35, 0.68, 0.85, 0.92],
      tendonForce: [30.0, 210.0, 415.0, 520.0, 565.0],
    },
    TRIlong: {
      activation: [0.05, 0.12, 0.18, 0.22, 0.25],
      tendonForce: [40.0, 95.0, 140.0, 175.0, 195.0],
    },
  },
};

const sampleDicomRtDoc: DicomRtDocumentLike = {
  planId: "PROSTATE_VMAT_78GY",
  planLabel: "Prostate VMAT 78Gy / 39fx",
  patientId: "PT-00942",
  frameOfReferenceUid: "1.2.840.10008.1.400.1",
  prescribedDoseGy: 78.0,
  fractions: 39,
  structures: [
    {
      roiNumber: 1,
      name: "PTV_78",
      interpretedType: "PTV",
      color: [239, 68, 68],
      volumeCc: 85.4,
      contours: [
        {
          z: 0,
          geometricType: "CLOSED_PLANAR",
          points: [
            [-24, -18, -20],
            [24, -18, -20],
            [24, 18, 20],
            [-24, 18, 20],
          ],
        },
      ],
    },
    {
      roiNumber: 2,
      name: "Rectum",
      interpretedType: "ORGAN",
      color: [56, 189, 248],
      volumeCc: 62.0,
      maxDoseLimitGy: 75.0,
      meanDoseLimitGy: 50.0,
      contours: [
        {
          z: 0,
          geometricType: "CLOSED_PLANAR",
          points: [
            [-18, -42, -35],
            [18, -42, -35],
            [18, -22, -15],
            [-18, -22, -15],
          ],
        },
      ],
    },
    {
      roiNumber: 3,
      name: "Bladder",
      interpretedType: "ORGAN",
      color: [34, 197, 94],
      volumeCc: 140.0,
      maxDoseLimitGy: 80.0,
      meanDoseLimitGy: 55.0,
    },
  ],
  beams: [
    {
      beamNumber: 1,
      name: "ARC1_CW",
      modality: "PHOTON",
      treatmentDeliveryType: "TREATMENT",
      energyMeV: 6,
      metersetMu: 342.5,
      doseRateMuPerMin: 600,
      controlPoints: [
        {
          index: 0,
          cumulativeMetersetWeight: 0.5,
          gantryAngleDeg: 45.0,
          collimatorAngleDeg: 15.0,
          couchAngleDeg: 0.0,
          jawX_mm: [-45.0, 45.0],
          jawY_mm: [-40.0, 40.0],
          mlcLeaves: [
            { pairIndex: 1, bankA_mm: -22.0, bankB_mm: 24.0 },
            { pairIndex: 2, bankA_mm: -28.0, bankB_mm: 28.0 },
            { pairIndex: 3, bankA_mm: -26.0, bankB_mm: 25.0 },
            { pairIndex: 4, bankA_mm: -18.0, bankB_mm: 20.0 },
          ],
        },
      ],
    },
  ],
  dvhs: [
    {
      roiNumber: 1,
      roiName: "PTV_78",
      d98Gy: 75.8,
      d95Gy: 77.2,
      d50Gy: 79.1,
      d2Gy: 81.2,
      meanDoseGy: 78.9,
      maxDoseGy: 82.0,
      v20GyPercent: 100.0,
      bins: [
        { doseGy: 0, volumePercent: 100 },
        { doseGy: 75, volumePercent: 99 },
        { doseGy: 78, volumePercent: 95 },
        { doseGy: 80, volumePercent: 30 },
        { doseGy: 82, volumePercent: 0 },
      ],
    },
    {
      roiNumber: 2,
      roiName: "Rectum",
      d98Gy: 12.0,
      d95Gy: 18.0,
      d50Gy: 38.5,
      d2Gy: 71.4,
      meanDoseGy: 41.2,
      maxDoseGy: 73.5,
      v20GyPercent: 68.4,
      bins: [
        { doseGy: 0, volumePercent: 100 },
        { doseGy: 20, volumePercent: 68.4 },
        { doseGy: 50, volumePercent: 32.0 },
        { doseGy: 70, volumePercent: 5.0 },
        { doseGy: 74, volumePercent: 0 },
      ],
    },
  ],
};

const sampleIgtlDoc: IgtlDocumentLike = {
  version: "2.1",
  devices: [
    {
      id: "NdiPolarisTracker",
      type: "PolariSpectra",
      acquisitionRate: 60,
      toolReferenceFrame: "Tracker",
    },
  ],
  servers: [
    {
      id: "PlusOpenIGTLinkServer",
      listeningPort: 18944,
      outputChannelId: "TrackedVideoStream",
    },
  ],
  transforms: [
    {
      from: "Reference",
      to: "Tracker",
      matrix: [1, 0, 0, 110, 0, 1, 0, -45, 0, 0, 1, 820, 0, 0, 0, 1],
      errorMm: 0.21,
    },
    {
      from: "Stylus",
      to: "Reference",
      matrix: [1, 0, 0, 35, 0, 1, 0, 82, 0, 0, 1, -12, 0, 0, 0, 1],
      errorMm: 0.18,
    },
    {
      from: "StylusTip",
      to: "Stylus",
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -145, 0, 0, 0, 1],
      errorMm: 0.34,
    },
    {
      from: "Image",
      to: "UltrasoundProbe",
      matrix: [1, 0, 0, 12, 0, 1, 0, 4, 0, 0, 1, 45, 0, 0, 0, 1],
      errorMm: 0.42,
    },
  ],
  fiducialConfig: {
    fleMm: 0.45,
    freMm: 0.39,
    treMm: 0.64,
    fiducials: [
      [-40, -30, 0],
      [40, -30, 0],
      [40, 30, 0],
      [-40, 30, 25],
    ],
    targetPoint: [5, 10, 15],
  },
  messages: [
    {
      deviceName: "StylusToReference",
      messageType: "TRANSFORM",
      timestampSec: 12.04,
      fromFrame: "Stylus",
      toFrame: "Reference",
      matrix: [1, 0, 0, 35, 0, 1, 0, 82, 0, 0, 1, -12, 0, 0, 0, 1],
    },
  ],
};

const sampleIgtlNav: IgtlNavigationResultLike = {
  fromFrame: "StylusTip",
  toFrame: "Tracker",
  framePath: ["StylusTip", "Stylus", "Reference", "Tracker"],
  isConnected: true,
  rotationDeterminant: 1.0,
  orthogonalityErrorFrobenius: 0.0,
  pivotCalibration: {
    poseCount: 16,
    stylusTipOffsetMm: [0.0, 0.0, -145.0],
    pivotPointMm: [145.0, 37.0, 663.0],
    stylusLengthMm: 145.0,
    rmsErrorMm: 0.34,
  },
  fitzpatrickTre: {
    fiducialCount: 4,
    fleMm: 0.45,
    expectedFreMm: 0.39,
    treMm: 0.64,
  },
};

test("OpenSim Topology SVG: Renders kinematic tree with rigid bodies, joints, wrapping surfaces, and muscle chords", () => {
  const svg = renderOpenSimTopologySvg(sampleOpenSimDoc);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("#0f172a"), "Should use dark mode canvas background");
  assert.ok(svg.includes("Arm26_Musculoskeletal"));
  assert.ok(svg.includes("humerus"));
  assert.ok(svg.includes("radius_ulna"));
  assert.ok(svg.includes("shoulder (PinJoint)"));
  assert.ok(svg.includes("elbow (PinJoint)"));
  assert.ok(svg.includes("elbow_flexion"));
  assert.ok(svg.includes("WrapElbowCyl"));
  assert.ok(svg.includes("BIClong"));
  assert.ok(svg.includes("F0 = 624 N"));
  assert.ok(svg.includes("TRIlong"));
});

test("OpenSim Force Curve SVG: Renders active/passive Hill force-length curves and simulated activation/force trajectories", () => {
  const svg = renderOpenSimForceCurveSvg(sampleOpenSimDoc, sampleOpenSimSim);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("Normalized Force-Length Curve"));
  assert.ok(svg.includes("Active f_L"));
  assert.ok(svg.includes("Passive f_PE"));
  assert.ok(svg.includes("BIClong (F0=624.3N)"));
  assert.ok(svg.includes("TRIlong (F0=798.5N)"));

  // Also test fallback trajectory synthesis when simResult is omitted
  const svgFallback = renderOpenSimForceCurveSvg(sampleOpenSimDoc);
  assert.ok(svgFallback.startsWith("<svg"));
  assert.ok(svgFallback.includes("BIClong"));
});

test("DICOM-RT BEV SVG: Renders collimator jaws, opposing MLC leaf banks, gantry/collimator/couch HUD, and ROI contours", () => {
  const svg = renderDicomRtBevSvg(sampleDicomRtDoc, 0, 0);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("Beam&apos;s Eye View (BEV)"));
  assert.ok(svg.includes("ARC1_CW"));
  assert.ok(svg.includes("45.0°"), "Should display Gantry Angle");
  assert.ok(svg.includes("15.0°"), "Should display Collimator Angle");
  assert.ok(svg.includes("Pair #1"));
  assert.ok(svg.includes("Bank A: -22.0 mm"));
  assert.ok(svg.includes("Bank B: 24.0 mm"));
  assert.ok(svg.includes("PTV_78 (PTV)"));
  assert.ok(svg.includes("Rectum (ORGAN)"));
});

test("DICOM-RT DVH SVG: Renders cumulative dose-volume histogram curves, D95% crosshairs, and QUANTEC limit markers", () => {
  const svg = renderDicomRtDvhSvg(sampleDicomRtDoc);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("Cumulative Dose-Volume Histogram (DVH)"));
  assert.ok(svg.includes("Rx D95% (78.0 Gy)"));
  assert.ok(svg.includes("QUANTEC Max 75Gy"));
  assert.ok(svg.includes("PTV_78 (PTV)"));
  assert.ok(svg.includes("Rectum (ORGAN)"));
  assert.ok(svg.includes("D95%: 77.2 Gy"));
});

test("OpenIGTLink Transform Tree SVG: Renders SE(3) coordinate frame tree, orthogonality badges, pivot sphere, and Fitzpatrick TRE", () => {
  const svg = renderIgtlTransformTreeSvg(sampleIgtlDoc, sampleIgtlNav);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("Tracker"));
  assert.ok(svg.includes("Reference"));
  assert.ok(svg.includes("Stylus"));
  assert.ok(svg.includes("StylusTip"));
  assert.ok(svg.includes("UltrasoundProbe"));
  assert.ok(svg.includes("Image"));
  assert.ok(svg.includes("det=1.000"));
  assert.ok(svg.includes("Stylus Pivot Calibration Sphere"));
  assert.ok(svg.includes("145.00 mm"));
  assert.ok(svg.includes("Fitzpatrick Target Registration Error (TRE)"));
  assert.ok(svg.includes("TRE PASS"));
  assert.ok(svg.includes("0.640 mm"));
});
