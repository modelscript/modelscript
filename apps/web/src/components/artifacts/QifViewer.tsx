// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderQifMbdHeatmapSvg, renderQifSpcChartSvg } from "@modelscript/diagram/qif-diagram-builder";
import { parseQif } from "@modelscript/qif/parser";
import {
  buildQif3dMbdScene,
  type Qif3dCalloutAnchor,
  type Qif3dMbdScene,
  type Qif3dMeshPayload,
} from "@modelscript/qif/step-bridge";
import type { QifDocument } from "@modelscript/qif/types";
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import { Environment, Html, Line } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import DOMPurify from "dompurify";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import { adaptSvgMarkupForTheme, highlightPolyglotLine } from "./PolyglotArtifactViewer";
import SafeOrbitControls from "./SafeOrbitControls";
import ViewportCameraControls, { type CameraPreset, type ClipAxis, type RenderMode } from "./ViewportCameraControls";

export interface QifViewerProps {
  artifactId?: string | number | undefined;
  viewConfig: unknown;
  isFullScreen?: boolean | undefined;
}

export type QifViewTab = "3d" | "boc" | "spc" | "code";

const DEFAULT_QIF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument versionQIF="3.0.0" qpId="f47ac10b-58cc-4372-a567-0e02b2c3d479">
  <Header>
    <Author><Name>Dr. Kenji Takahashi — Precision Metrology Lab</Name></Author>
    <Application><Name>ModelScript QIF 3.0 MBD &amp; SPC Engine</Name></Application>
    <FileUnits>
      <PrimaryUnits>
        <LinearUnit><UnitName>mm</UnitName></LinearUnit>
      </PrimaryUnits>
    </FileUnits>
  </Header>
  <DatumDefinitions>
    <DatumDefinition id="D_A" qpId="11000000-0000-4000-8000-000000000001">
      <DatumLabel>A</DatumLabel>
      <FeatureNominalIds><Id>F_ROOT_BASE</Id></FeatureNominalIds>
    </DatumDefinition>
    <DatumDefinition id="D_B" qpId="11000000-0000-4000-8000-000000000002">
      <DatumLabel>B</DatumLabel>
      <FeatureNominalIds><Id>F_COOLING_BORE</Id></FeatureNominalIds>
    </DatumDefinition>
    <DatumDefinition id="D_C" qpId="11000000-0000-4000-8000-000000000003">
      <DatumLabel>C</DatumLabel>
      <FeatureNominalIds><Id>F_RETENTION_SLOT</Id></FeatureNominalIds>
    </DatumDefinition>
  </DatumDefinitions>
  <FeatureNominals>
    <PlaneFeatureNominal id="F_ROOT_BASE" qpId="22000000-0000-4000-8000-000000000001">
      <Name>FirTreePlatformDatumPlaneA</Name>
      <Location>0.0 0.0 0.0</Location>
      <Normal>0.0 0.0 1.0</Normal>
      <StepEntityId>#101</StepEntityId>
      <ProbingPoints>9</ProbingPoints>
    </PlaneFeatureNominal>
    <CylinderFeatureNominal id="F_COOLING_BORE" qpId="22000000-0000-4000-8000-000000000002">
      <Name>RootInternalCoolingBoreB</Name>
      <Diameter>12.000</Diameter>
      <Location>24.0 0.0 15.0</Location>
      <AxisVector>0.0 0.0 1.0</AxisVector>
      <StepEntityId>#108</StepEntityId>
      <ProbingPoints>12</ProbingPoints>
    </CylinderFeatureNominal>
    <SlotFeatureNominal id="F_RETENTION_SLOT" qpId="22000000-0000-4000-8000-000000000003">
      <Name>AxialLockingPinSlotC</Name>
      <Width>6.000</Width>
      <Location>-18.0 0.0 8.0</Location>
      <Normal>0.0 1.0 0.0</Normal>
      <StepEntityId>#112</StepEntityId>
      <ProbingPoints>8</ProbingPoints>
    </SlotFeatureNominal>
    <CylinderFeatureNominal id="F_PIN_HOLE" qpId="22000000-0000-4000-8000-000000000004">
      <Name>DamperWirePinBore</Name>
      <Diameter>4.500</Diameter>
      <Location>42.0 12.5 15.0</Location>
      <AxisVector>0.0 0.0 1.0</AxisVector>
      <StepEntityId>#118</StepEntityId>
      <ProbingPoints>10</ProbingPoints>
    </CylinderFeatureNominal>
  </FeatureNominals>
  <CharacteristicNominals>
    <FlatnessCharacteristicNominal id="CHAR_FLAT_A" qpId="33000000-0000-4000-8000-000000000001" balloonNumber="1">
      <Name>PlatformBase_Flatness</Name>
      <ToleranceValue>0.025</ToleranceValue>
      <FeatureNominalIds><Id>F_ROOT_BASE</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM_HEXAGON_01</MeasurementDeviceId>
    </FlatnessCharacteristicNominal>
    <CylindricityCharacteristicNominal id="CHAR_CYL_B" qpId="33000000-0000-4000-8000-000000000002" balloonNumber="2">
      <Name>CoolingBore_Cylindricity</Name>
      <ToleranceValue>0.030</ToleranceValue>
      <FeatureNominalIds><Id>F_COOLING_BORE</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM_HEXAGON_01</MeasurementDeviceId>
    </CylindricityCharacteristicNominal>
    <PositionCharacteristicNominal id="CHAR_POS_BORE" qpId="33000000-0000-4000-8000-000000000003" balloonNumber="3">
      <Name>CoolingBore_TruePosition</Name>
      <ToleranceValue>0.050</ToleranceValue>
      <DiametricalZone>true</DiametricalZone>
      <MaterialCondition>MMC</MaterialCondition>
      <DatumReferenceFrame>
        <DatumReference precedence="1"><DatumLabel>A</DatumLabel></DatumReference>
        <DatumReference precedence="2"><DatumLabel>C</DatumLabel><MaterialCondition>MMC</MaterialCondition></DatumReference>
      </DatumReferenceFrame>
      <FeatureNominalIds><Id>F_COOLING_BORE</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM_HEXAGON_01</MeasurementDeviceId>
    </PositionCharacteristicNominal>
    <PositionCharacteristicNominal id="CHAR_POS_PIN" qpId="33000000-0000-4000-8000-000000000004" balloonNumber="4">
      <Name>DamperPinBore_TruePosition</Name>
      <ToleranceValue>0.040</ToleranceValue>
      <DiametricalZone>true</DiametricalZone>
      <MaterialCondition>MMC</MaterialCondition>
      <DatumReferenceFrame>
        <DatumReference precedence="1"><DatumLabel>A</DatumLabel></DatumReference>
        <DatumReference precedence="2"><DatumLabel>B</DatumLabel><MaterialCondition>MMC</MaterialCondition></DatumReference>
        <DatumReference precedence="3"><DatumLabel>C</DatumLabel><MaterialCondition>MMC</MaterialCondition></DatumReference>
      </DatumReferenceFrame>
      <FeatureNominalIds><Id>F_PIN_HOLE</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM_HEXAGON_01</MeasurementDeviceId>
    </PositionCharacteristicNominal>
  </CharacteristicNominals>
  <MeasurementResources>
    <MeasurementDevice id="CMM_HEXAGON_01" deviceType="CMM">
      <Name>Hexagon_Global_S_07_10_07</Name>
      <CalibrationUncertainty>0.0018</CalibrationUncertainty>
    </MeasurementDevice>
  </MeasurementResources>
  <Results>
    <GeometricCharacteristicActual id="ACT_01" characteristicNominalId="CHAR_FLAT_A" partSerialNumber="HPT-2026-001">
      <MeasuredValue>0.011</MeasuredValue>
      <DeviationVector>0.0 0.0 0.011</DeviationVector>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
    <GeometricCharacteristicActual id="ACT_02" characteristicNominalId="CHAR_CYL_B" partSerialNumber="HPT-2026-001">
      <MeasuredValue>0.012</MeasuredValue>
      <ActualFeatureSize>12.015</ActualFeatureSize>
      <DeviationVector>0.008 0.009 0.0</DeviationVector>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
    <GeometricCharacteristicActual id="ACT_03" characteristicNominalId="CHAR_POS_BORE" partSerialNumber="HPT-2026-001">
      <MeasuredValue>0.034</MeasuredValue>
      <ActualFeatureSize>12.012</ActualFeatureSize>
      <DeviationVector>0.024 0.024 0.0</DeviationVector>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
    <GeometricCharacteristicActual id="ACT_04" characteristicNominalId="CHAR_POS_PIN" partSerialNumber="HPT-2026-001">
      <MeasuredValue>0.022</MeasuredValue>
      <ActualFeatureSize>4.510</ActualFeatureSize>
      <DeviationVector>0.015 0.016 0.0</DeviationVector>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
  </Results>
</QIFDocument>`;

function formatMaterialModifier(mod?: "RFS" | "MMC" | "LMC"): string {
  if (mod === "MMC") return "Ⓜ";
  if (mod === "LMC") return "Ⓛ";
  return "";
}

function getStatusHexColor(status: string, ratio = 0): string {
  if (status === "FAIL" || ratio > 1.0) return "#ef4444";
  if (status === "REWORK" || status === "MARGINAL" || ratio > 0.75) return "#f59e0b";
  return "#22c55e";
}

interface OrbitControlsHandle {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function CameraController({
  controlsRef,
  presetTrigger,
}: {
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  presetTrigger: { preset: CameraPreset; timestamp: number } | null;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (!presetTrigger) return;
    const dist = 48;
    switch (presetTrigger.preset) {
      case "front":
        camera.position.set(0, -dist, 8);
        break;
      case "back":
        camera.position.set(0, dist, 8);
        break;
      case "top":
        camera.position.set(0, -0.01, dist);
        break;
      case "bottom":
        camera.position.set(0, 0.01, -dist);
        break;
      case "left":
        camera.position.set(-dist, 0, 8);
        break;
      case "right":
        camera.position.set(dist, 0, 8);
        break;
      case "iso":
      case "fit":
      default:
        camera.position.set(34, -36, 28);
        break;
    }
    camera.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [presetTrigger, camera, controlsRef]);
  return null;
}

function QifFeatureMesh({
  payload,
  isSelected,
  showHeatmap,
  renderMode,
  clippingPlanes,
  onSelectFeature,
}: {
  payload: Qif3dMeshPayload;
  isSelected: boolean;
  showHeatmap: boolean;
  renderMode: RenderMode;
  clippingPlanes: THREE.Plane[];
  onSelectFeature: (featureId: string | undefined) => void;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(payload.vertices, 3));
    if (payload.normals.length > 0) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(payload.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    if (payload.indices.length > 0) {
      geo.setIndex(new THREE.Uint32BufferAttribute(payload.indices, 1));
    }
    geo.computeBoundingSphere();
    return geo;
  }, [payload]);

  const color = useMemo(() => {
    if (isSelected) return new THREE.Color("#38bdf8");
    if (payload.isBodyEnvelope) return new THREE.Color("#334155");
    if (showHeatmap) {
      return new THREE.Color(payload.color[0], payload.color[1], payload.color[2]);
    }
    return new THREE.Color("#64748b");
  }, [isSelected, payload, showHeatmap]);

  const opacity = useMemo(() => {
    if (renderMode === "xray") return 0.32;
    if (payload.isBodyEnvelope) return 0.72;
    return 0.96;
  }, [renderMode, payload.isBodyEnvelope]);

  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        if (payload.featureId) {
          onSelectFeature(payload.featureId);
        }
      }}
    >
      <meshPhysicalMaterial
        color={color}
        metalness={payload.isBodyEnvelope ? 0.35 : 0.22}
        roughness={payload.isBodyEnvelope ? 0.45 : 0.32}
        emissive={isSelected ? new THREE.Color("#0284c7") : new THREE.Color("#000000")}
        emissiveIntensity={isSelected ? 0.35 : 0}
        wireframe={renderMode === "wireframe"}
        transparent={opacity < 1.0}
        opacity={opacity}
        clearcoat={0.15}
        side={THREE.DoubleSide}
        clippingPlanes={clippingPlanes}
        clipShadows={true}
      />
    </mesh>
  );
}

export const QifViewer: React.FC<QifViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const [viewTab, setViewTab] = useState<QifViewTab>("3d");
  const [sourceSubTab, setSourceSubTab] = useState<"qif" | "step">("qif");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(true);
  const [showProbes, setShowProbes] = useState<boolean>(true);
  const [show3dLabels, setShow3dLabels] = useState<boolean>(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("shaded");
  const [clipAxis, setClipAxis] = useState<ClipAxis>("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [presetTrigger, setPresetTrigger] = useState<{
    preset: CameraPreset;
    timestamp: number;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const controlsRef = useRef<OrbitControlsHandle | null>(null);

  const rawQifText: string = useMemo(() => {
    const cfg = (viewConfig && typeof viewConfig === "object" ? viewConfig : {}) as Record<string, unknown>;
    const candidate = cfg["code"] || cfg["qifCode"] || cfg["source"] || cfg["content"] || "";
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : DEFAULT_QIF_XML;
  }, [viewConfig]);

  const externalStepText: string | undefined = useMemo(() => {
    const candidate = viewConfig?.stepCode || viewConfig?.stepSource;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
  }, [viewConfig]);

  const parsedData = useMemo((): {
    doc: QifDocument;
    scene: Qif3dMbdScene;
    spcSvg: string;
    heatmapSvg: string;
  } => {
    let doc: QifDocument;
    try {
      doc = parseQif(rawQifText);
    } catch {
      doc = parseQif(DEFAULT_QIF_XML);
    }
    const scene = buildQif3dMbdScene(doc, externalStepText);
    const rawSpcSvg = renderQifSpcChartSvg(scene.spcSummary);
    const rawHeatmapSvg = renderQifMbdHeatmapSvg(doc, scene.spcSummary);
    return {
      doc,
      scene,
      spcSvg: DOMPurify.sanitize(adaptSvgMarkupForTheme(rawSpcSvg, isDark)),
      heatmapSvg: DOMPurify.sanitize(adaptSvgMarkupForTheme(rawHeatmapSvg, isDark)),
    };
  }, [rawQifText, externalStepText, isDark]);

  const { doc, scene, spcSvg, heatmapSvg } = parsedData;

  const activeClippingPlanes = useMemo(() => {
    if (clipAxis === "none") return [];
    const span = 24;
    const d = clipOffset * span;
    if (clipAxis === "x") return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), d)];
    if (clipAxis === "y") return [new THREE.Plane(new THREE.Vector3(0, -1, 0), d)];
    return [new THREE.Plane(new THREE.Vector3(0, 0, -1), d)];
  }, [clipAxis, clipOffset]);

  const sceneScale = useMemo(() => {
    return scene.boundingBox.radius > 0 ? 18 / scene.boundingBox.radius : 0.45;
  }, [scene.boundingBox.radius]);

  const sceneCenter = scene.boundingBox.center;

  const title: string =
    viewConfig?.title || viewConfig?.filename || doc.header.partName || "TurbineBladeRoot_MBD_Inspection.qif";

  const handleSelectCallout = (callout: Qif3dCalloutAnchor) => {
    setSelectedCharId((prev) => (prev === callout.characteristicId ? null : callout.characteristicId));
    setSelectedFeatureId(callout.featureId);
  };

  const handleCopySource = async () => {
    const textToCopy = sourceSubTab === "qif" ? rawQifText : scene.stepSource;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownloadQif = () => {
    const ext = sourceSubTab === "qif" ? ".qif" : ".step";
    const mime = sourceSubTab === "qif" ? "application/xml" : "application/step";
    const text = sourceSubTab === "qif" ? rawQifText : scene.stepSource;
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.replace(/\.(qif|step|stp)$/i, "") + ext;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const targetUrl = buildEditorUrlForArtifact({
      artifactId: typeof artifactId === "number" ? artifactId : Number(viewConfig?.artifactId) || undefined,
      viewType: "qif",
      viewConfig,
      code: rawQifText,
      title,
      dialect: "qif",
    });
    navigate(targetUrl);
  };

  const activeSourceLines = useMemo(() => {
    const text = sourceSubTab === "qif" ? rawQifText : scene.stepSource;
    return text.split(/\r?\n/);
  }, [sourceSubTab, rawQifText, scene.stepSource]);

  return (
    <Box
      data-testid="qif-viewer"
      display="flex"
      flexDirection="column"
      width="100%"
      height={isFullScreen ? "100%" : "480px"}
      bg="var(--color-canvas-default, #0d1117)"
      overflow="hidden"
    >
      {/* Top Workbench Header */}
      <Box
        px={3}
        py={2}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={2}
        borderBottom="1px solid var(--color-border-default, #30363d)"
        bg="var(--color-canvas-subtle, #161b22)"
      >
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              padding: "2px 8px",
              borderRadius: "999px",
              background: "rgba(2, 132, 199, 0.16)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            ISO 23952 QIF 3.0 + STEP AP242
          </span>
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-fg-default, #e6edf3)",
            }}
          >
            {title}
          </Text>
          <span
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "1px 6px",
              borderRadius: "4px",
              background: "rgba(34, 197, 94, 0.14)",
              color: "#4ade80",
              border: "1px solid rgba(34, 197, 94, 0.3)",
            }}
          >
            STEP B-Rep: {scene.reconciliation.matchedFeatures.length}/{doc.features.length} Faces
          </span>
          <span
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "1px 6px",
              borderRadius: "4px",
              background: "rgba(56, 189, 248, 0.12)",
              color: "#7dd3fc",
              border: "1px solid rgba(56, 189, 248, 0.25)",
            }}
          >
            Min Cpk: {scene.spcSummary.minCpk.toFixed(2)}
          </span>
        </Box>

        <Box display="flex" alignItems="center" gap={2}>
          <div
            role="tablist"
            aria-label="QIF MBD Viewer Mode"
            style={{
              display: "inline-flex",
              background: "var(--color-canvas-default, rgba(15, 23, 42, 0.75))",
              border: "1px solid var(--color-border-default, #30363d)",
              borderRadius: "6px",
              padding: "2px",
              gap: "2px",
            }}
          >
            {[
              { id: "3d" as const, label: "3D CAD + GD&T" },
              { id: "boc" as const, label: `BoC (${doc.characteristics.length})` },
              { id: "spc" as const, label: "SPC & Heatmap" },
              { id: "code" as const, label: `Code (${activeSourceLines.length}L)` },
            ].map((tab) => {
              const active = viewTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setViewTab(tab.id)}
                  style={{
                    background: active ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: active ? "#38bdf8" : "var(--color-fg-muted, #8b949e)",
                    border: active ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                    borderRadius: "4px",
                    padding: "3px 9px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {Boolean(viewConfig?.standalone) && (
            <Button size="small" variant="primary" leadingVisual={CodeIcon} onClick={handleOpenInPlayground}>
              Open in Playground
            </Button>
          )}
        </Box>
      </Box>

      {/* Main Content Area */}
      <Box flex={1} position="relative" overflow="hidden" display="flex">
        {viewTab === "3d" && (
          <Box flex={1} position="relative" display="flex" width="100%" height="100%">
            {/* Left / Center 3D STEP AP242 + QIF Overlay Viewport */}
            <Box
              flex={1}
              position="relative"
              height="100%"
              style={{
                background: isDark
                  ? "radial-gradient(circle at 42% 48%, #1e293b 0%, #090d16 100%)"
                  : "radial-gradient(circle at 42% 48%, #f1f5f9 0%, #cbd5e1 100%)",
              }}
            >
              <ViewportCameraControls
                onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })}
                renderMode={renderMode}
                onRenderModeChange={setRenderMode}
                clipAxis={clipAxis}
                onClipAxisChange={setClipAxis}
                clipOffset={clipOffset}
                onClipOffsetChange={setClipOffset}
              />

              {/* Top-left MBD Layer Toggles */}
              <Box position="absolute" top={10} left={10} zIndex={10} display="flex" gap={1} flexWrap="wrap">
                {[
                  {
                    label: "Deviation Heatmap",
                    active: showHeatmap,
                    toggle: () => setShowHeatmap((v) => !v),
                  },
                  {
                    label: `CMM Hits (${scene.probeHits.length})`,
                    active: showProbes,
                    toggle: () => setShowProbes((v) => !v),
                  },
                  {
                    label: "3D Callout Pins",
                    active: show3dLabels,
                    toggle: () => setShow3dLabels((v) => !v),
                  },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={btn.toggle}
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      background: btn.active ? "rgba(15, 23, 42, 0.88)" : "rgba(15, 23, 42, 0.55)",
                      color: btn.active ? "#38bdf8" : "#94a3b8",
                      border: btn.active ? "1px solid rgba(56, 189, 248, 0.45)" : "1px solid rgba(148, 163, 184, 0.2)",
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </Box>

              <Canvas
                gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
                camera={{ position: [34, -36, 28], fov: 44 }}
                onPointerMissed={() => {
                  setSelectedFeatureId(null);
                  setSelectedCharId(null);
                }}
              >
                <AutoThumbnailCapture
                  artifactId={typeof artifactId === "number" ? artifactId : undefined}
                  hasThumbnail={Boolean(viewConfig?.thumbnailUrl || viewConfig?.thumbnail_url)}
                />
                <ambientLight intensity={0.55} />
                <directionalLight position={[30, -25, 40]} intensity={0.95} />
                <directionalLight position={[-25, 25, -15]} intensity={0.4} />
                <spotLight position={[10, 10, 35]} angle={0.3} penumbra={1} intensity={0.35} />

                <Suspense fallback={null}>
                  <Environment files="/hdri/studio.hdr" environmentIntensity={0.3} />
                </Suspense>

                <group
                  scale={[sceneScale, sceneScale, sceneScale]}
                  position={[-sceneCenter[0] * sceneScale, -sceneCenter[1] * sceneScale, -sceneCenter[2] * sceneScale]}
                >
                  {/* 1. 3D STEP AP242 B-Rep Solid & Individual Feature Topology Surfaces */}
                  {scene.meshes.map((meshPayload) => (
                    <QifFeatureMesh
                      key={meshPayload.id}
                      payload={meshPayload}
                      isSelected={Boolean(meshPayload.featureId) && meshPayload.featureId === selectedFeatureId}
                      showHeatmap={showHeatmap}
                      renderMode={renderMode}
                      clippingPlanes={activeClippingPlanes}
                      onSelectFeature={(fid) => setSelectedFeatureId(fid ?? null)}
                    />
                  ))}

                  {/* 2. Datum Reference Frame (DRF) Coordinate Axes at Origin */}
                  <Line
                    points={[
                      [0, 0, 0],
                      [36, 0, 0],
                    ]}
                    color="#ef4444"
                    lineWidth={2}
                  />
                  <Line
                    points={[
                      [0, 0, 0],
                      [0, 32, 0],
                    ]}
                    color="#22c55e"
                    lineWidth={2}
                  />
                  <Line
                    points={[
                      [0, 0, 0],
                      [0, 0, 34],
                    ]}
                    color="#3b82f6"
                    lineWidth={2}
                  />

                  {/* 3. 3D CMM Touch-Probe Hit Spheres & Amplified Deviation Vectors */}
                  {showProbes &&
                    scene.probeHits.map((hit) => {
                      const isHighlighted = !selectedFeatureId || hit.featureId === selectedFeatureId;
                      const devScale = 120; // Amplify micron deviations for 3D visual clarity
                      const tip: [number, number, number] = [
                        hit.position[0] + hit.deviationVector[0] * devScale,
                        hit.position[1] + hit.deviationVector[1] * devScale,
                        hit.position[2] + hit.deviationVector[2] * devScale,
                      ];
                      return (
                        <group key={hit.id}>
                          <mesh position={hit.position}>
                            <sphereGeometry args={[isHighlighted ? 0.95 : 0.6, 12, 12]} />
                            <meshStandardMaterial
                              color={isHighlighted ? "#38bdf8" : "#475569"}
                              emissive={isHighlighted ? "#0284c7" : "#000000"}
                              emissiveIntensity={0.4}
                            />
                          </mesh>
                          {isHighlighted && <Line points={[hit.position, tip]} color="#38bdf8" lineWidth={1.5} />}
                        </group>
                      );
                    })}

                  {/* 4. Spatially Separated 3D ASME Datum Reference Frames ([ -A- ], [ -B- ], [ -C- ]) */}
                  {show3dLabels &&
                    scene.datumBadges.map((datum) => (
                      <group key={datum.datumId}>
                        <Line
                          points={[datum.surfaceAnchor, datum.badgePosition]}
                          color="#94a3b8"
                          lineWidth={1.2}
                          dashed
                          dashSize={2}
                          gapSize={1.5}
                        />
                        <Html position={datum.badgePosition} center>
                          <div
                            onClick={() => {
                              if (datum.featureId) setSelectedFeatureId(datum.featureId);
                            }}
                            style={{
                              background: "rgba(15, 23, 42, 0.92)",
                              border: "1.5px solid #60a5fa",
                              borderRadius: "4px",
                              padding: "1px 6px",
                              color: "#f8fafc",
                              fontSize: "10px",
                              fontWeight: 700,
                              fontFamily: "var(--font-mono, monospace)",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
                            }}
                            title={`Datum ${datum.datumLabel} (${datum.featureName ?? ""})`}
                          >
                            [{datum.datumLabel}]{" "}
                            {datum.stepEntityId ? (
                              <span style={{ color: "#38bdf8", fontSize: "9px" }}>{datum.stepEntityId}</span>
                            ) : null}
                          </div>
                        </Html>
                      </group>
                    ))}

                  {/* 5. Spatially Separated 3D Balloon Callouts & Leader Lines */}
                  {show3dLabels &&
                    scene.callouts.map((callout) => {
                      const statusColor = getStatusHexColor(callout.status, callout.toleranceRatio);
                      const isActive =
                        selectedCharId === callout.characteristicId || selectedFeatureId === callout.featureId;
                      return (
                        <group key={callout.characteristicId}>
                          <Line
                            points={[callout.surfaceAnchor, callout.leaderElbow, callout.calloutPosition]}
                            color={isActive ? "#38bdf8" : statusColor}
                            lineWidth={isActive ? 2.2 : 1.3}
                          />
                          <mesh position={callout.surfaceAnchor}>
                            <sphereGeometry args={[1.15, 12, 12]} />
                            <meshBasicMaterial color={isActive ? "#38bdf8" : statusColor} />
                          </mesh>
                          <Html position={callout.calloutPosition} center>
                            <div
                              onClick={() => handleSelectCallout(callout)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "5px",
                                background: isActive ? "rgba(14, 116, 144, 0.95)" : "rgba(15, 23, 42, 0.92)",
                                border: `1.5px solid ${isActive ? "#38bdf8" : statusColor}`,
                                borderRadius: "6px",
                                padding: "2px 7px",
                                color: "#f8fafc",
                                fontSize: "10px",
                                fontWeight: 600,
                                fontFamily: "var(--font-mono, monospace)",
                                whiteSpace: "nowrap",
                                cursor: "pointer",
                                boxShadow: "0 3px 10px rgba(0,0,0,0.5)",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "15px",
                                  height: "15px",
                                  borderRadius: "50%",
                                  background: statusColor,
                                  color: "#0f172a",
                                  fontWeight: 800,
                                  fontSize: "9.5px",
                                }}
                              >
                                {callout.balloonNumber}
                              </span>
                              <span style={{ color: "#38bdf8", fontWeight: 700 }}>{callout.gdtSymbol}</span>
                              <span>
                                {callout.isDiametrical ? "⌀" : ""}
                                {callout.toleranceZone}
                                {formatMaterialModifier(callout.materialCondition)}
                              </span>
                              {callout.stepEntityId && (
                                <span
                                  style={{
                                    color: "#94a3b8",
                                    fontSize: "9px",
                                    borderLeft: "1px solid #334155",
                                    paddingLeft: "4px",
                                  }}
                                >
                                  {callout.stepEntityId}
                                </span>
                              )}
                            </div>
                          </Html>
                        </group>
                      );
                    })}
                </group>

                <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} />
                <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} />
              </Canvas>

              {/* Bottom-left Deviation Heatmap Legend */}
              <Box
                position="absolute"
                bottom={10}
                left={10}
                zIndex={10}
                px={2}
                py={1}
                borderRadius="6px"
                bg="rgba(15, 23, 42, 0.86)"
                border="1px solid rgba(51, 65, 85, 0.8)"
                display="flex"
                alignItems="center"
                gap={3}
                style={{ fontSize: "10.5px", color: "#cbd5e1" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#22c55e",
                    }}
                  />
                  In-Spec (&lt;75%)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#f59e0b",
                    }}
                  />
                  Marginal (75–100%)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#ef4444",
                    }}
                  />
                  Out-of-Tol (&gt;100%)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#38bdf8",
                    }}
                  />
                  CMM Probe Hits
                </span>
              </Box>
            </Box>

            {/* Right Docked ASME Y14.5 Feature Control Frame Stack */}
            <Box
              width="335px"
              minWidth="310px"
              height="100%"
              overflow="auto"
              p={2}
              borderLeft="1px solid var(--color-border-default, #30363d)"
              bg="var(--color-canvas-subtle, #0f172a)"
              display="flex"
              flexDirection="column"
              gap={2}
            >
              <Box
                px={1}
                py={1}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                borderBottom="1px solid rgba(51, 65, 85, 0.6)"
              >
                <Text
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#e2e8f0",
                    letterSpacing: "0.02em",
                  }}
                >
                  ASME Y14.5 Feature Control Frames
                </Text>
                <Text style={{ fontSize: "10px", color: "#94a3b8" }}>Click to isolate 3D face</Text>
              </Box>

              {scene.callouts.map((callout) => {
                const statusColor = getStatusHexColor(callout.status, callout.toleranceRatio);
                const isSelected =
                  selectedCharId === callout.characteristicId || selectedFeatureId === callout.featureId;
                const datumsText =
                  callout.datumReferences
                    .map((d) => `${d.datumLabel}${formatMaterialModifier(d.materialCondition)}`)
                    .join(" | ") || "Primary";

                return (
                  <div
                    key={callout.characteristicId}
                    onClick={() => handleSelectCallout(callout)}
                    style={{
                      borderRadius: "6px",
                      border: `1.5px solid ${isSelected ? "#38bdf8" : statusColor}`,
                      background: isSelected ? "rgba(14, 116, 144, 0.18)" : "rgba(30, 41, 59, 0.78)",
                      padding: "8px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* Top ASME Compartment Row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "6px",
                        borderBottom: "1px solid rgba(71, 85, 105, 0.5)",
                        paddingBottom: "6px",
                        marginBottom: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        <span
                          style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            border: `1.5px solid ${statusColor}`,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "10px",
                            fontWeight: 700,
                            color: "#f8fafc",
                          }}
                        >
                          {callout.balloonNumber}
                        </span>
                        <span
                          style={{
                            fontSize: "15px",
                            fontWeight: 700,
                            color: "#38bdf8",
                            padding: "0 4px",
                          }}
                          title={callout.gdtType}
                        >
                          {callout.gdtSymbol}
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#f8fafc",
                            borderLeft: "1px solid #475569",
                            paddingLeft: "6px",
                          }}
                        >
                          {callout.isDiametrical ? "⌀" : ""}
                          {callout.toleranceZone}
                          {formatMaterialModifier(callout.materialCondition)}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#cbd5e1",
                            borderLeft: "1px solid #475569",
                            paddingLeft: "6px",
                          }}
                        >
                          {datumsText}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: "9.5px",
                          fontWeight: 700,
                          padding: "1px 7px",
                          borderRadius: "999px",
                          background: `${statusColor}22`,
                          color: statusColor,
                          border: `1px solid ${statusColor}`,
                        }}
                      >
                        {callout.status}
                      </span>
                    </div>

                    {/* Feature Name & STEP Entity Row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "10.5px",
                        color: "#e2e8f0",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{callout.featureName}</span>
                      {callout.stepEntityId && (
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "9.5px",
                            color: "#38bdf8",
                            background: "rgba(56, 189, 248, 0.12)",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            border: "1px solid rgba(56, 189, 248, 0.3)",
                          }}
                        >
                          STEP {callout.stepEntityId}
                        </span>
                      )}
                    </div>

                    {/* Metrology Actuals & Bonus Tolerance Row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "10px",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "#94a3b8",
                      }}
                    >
                      <span>
                        Act:{" "}
                        <strong style={{ color: "#f8fafc" }}>
                          {callout.measuredValue !== undefined ? `${callout.measuredValue.toFixed(4)} mm` : "Pending"}
                        </strong>
                      </span>
                      {callout.bonusTolerance > 0 && (
                        <span style={{ color: "#38bdf8" }}>+Bonus: {callout.bonusTolerance.toFixed(3)}</span>
                      )}
                      {callout.cpk !== undefined && (
                        <span>
                          Cpk: <strong style={{ color: "#4ade80" }}>{callout.cpk.toFixed(2)}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Bill of Characteristics (BoC) & CMM Actuals Tab */}
        {viewTab === "boc" && (
          <Box flex={1} overflow="auto" p={3} bg="var(--color-canvas-default, #0d1117)">
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-fg-default, #e6edf3)",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border-default, #30363d)",
                    textAlign: "left",
                    color: "#94a3b8",
                  }}
                >
                  <th style={{ padding: "8px" }}>#</th>
                  <th style={{ padding: "8px" }}>Characteristic</th>
                  <th style={{ padding: "8px" }}>STEP B-Rep Face</th>
                  <th style={{ padding: "8px" }}>ASME Y14.5 Callout</th>
                  <th style={{ padding: "8px" }}>DRF</th>
                  <th style={{ padding: "8px" }}>Measured</th>
                  <th style={{ padding: "8px" }}>Eff. Tol (Bonus)</th>
                  <th style={{ padding: "8px" }}>Cpk</th>
                  <th style={{ padding: "8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {scene.callouts.map((c) => {
                  const statusColor = getStatusHexColor(c.status, c.toleranceRatio);
                  return (
                    <tr
                      key={c.characteristicId}
                      onClick={() => {
                        setSelectedFeatureId(c.featureId);
                        setSelectedCharId(c.characteristicId);
                        setViewTab("3d");
                      }}
                      style={{
                        borderBottom: "1px solid rgba(48, 54, 61, 0.6)",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "8px", fontWeight: 700 }}>{c.balloonNumber}</td>
                      <td style={{ padding: "8px" }}>{c.characteristicName}</td>
                      <td style={{ padding: "8px", color: "#38bdf8" }}>
                        {c.stepEntityId ?? "—"} ({c.featureName})
                      </td>
                      <td style={{ padding: "8px", fontWeight: 700 }}>
                        {c.gdtSymbol} {c.isDiametrical ? "⌀" : ""}
                        {c.toleranceZone} {formatMaterialModifier(c.materialCondition)}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.datumReferences
                          .map((d) => `${d.datumLabel}${formatMaterialModifier(d.materialCondition)}`)
                          .join(" | ") || "Primary"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.measuredValue !== undefined ? `${c.measuredValue.toFixed(4)} mm` : "—"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.effectiveTolerance.toFixed(4)} mm
                        {c.bonusTolerance > 0 ? ` (+${c.bonusTolerance.toFixed(3)})` : ""}
                      </td>
                      <td style={{ padding: "8px", color: "#4ade80" }}>{c.cpk?.toFixed(2) ?? "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background: `${statusColor}22`,
                            color: statusColor,
                            border: `1px solid ${statusColor}`,
                            fontSize: "10px",
                            fontWeight: 700,
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        )}

        {/* SPC Capability & 2D Schematic Export Tab */}
        {viewTab === "spc" && (
          <Box
            flex={1}
            overflow="auto"
            p={3}
            display="flex"
            flexDirection="column"
            gap={3}
            bg="var(--color-canvas-default, #0d1117)"
          >
            <Box
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              p={2}
              bg="#0f172a"
              dangerouslySetInnerHTML={{ __html: spcSvg }}
            />
            <Box
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              p={2}
              bg="#0f172a"
              dangerouslySetInnerHTML={{ __html: heatmapSvg }}
            />
          </Box>
        )}

        {/* QIF 3.0 XML & Paired STEP AP242 Source Tab */}
        {viewTab === "code" && (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            overflow="hidden"
            bg="var(--color-canvas-default, #0d1117)"
          >
            <Box
              px={3}
              py={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              borderBottom="1px solid var(--color-border-default, #30363d)"
              bg="var(--color-canvas-subtle, #161b22)"
            >
              <Box display="flex" alignItems="center" gap={2}>
                <button
                  type="button"
                  onClick={() => setSourceSubTab("qif")}
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: sourceSubTab === "qif" ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: sourceSubTab === "qif" ? "#38bdf8" : "#94a3b8",
                    border: sourceSubTab === "qif" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                  }}
                >
                  ISO 23952 QIF 3.0 XML
                </button>
                <button
                  type="button"
                  onClick={() => setSourceSubTab("step")}
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: sourceSubTab === "step" ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: sourceSubTab === "step" ? "#38bdf8" : "#94a3b8",
                    border: sourceSubTab === "step" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                  }}
                >
                  Paired STEP AP242 B-Rep (#101–#118)
                </button>
              </Box>
              <Box display="flex" alignItems="center" gap={2}>
                <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadQif}>
                  {sourceSubTab === "qif" ? ".qif" : ".step"}
                </Button>
                <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopySource}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </Box>
            </Box>

            <Box
              flex={1}
              py={2}
              overflow="auto"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                lineHeight: 1.55,
              }}
            >
              {activeSourceLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "40px",
                      minWidth: "40px",
                      textAlign: "right",
                      paddingRight: "14px",
                      color: "var(--color-fg-subtle, #6e7681)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>
                    {highlightPolyglotLine(line, sourceSubTab === "qif" ? "qif" : "step")}
                  </span>
                </div>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default QifViewer;
