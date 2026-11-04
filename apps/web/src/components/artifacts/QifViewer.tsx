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
  viewConfig?: Record<string, unknown> | null | undefined;
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
    camera.up.set(0, 0, 1);
  }, [camera]);

  useEffect(() => {
    if (!presetTrigger) return;
    const dist = 48;
    camera.up.set(0, 0, 1);
    switch (presetTrigger.preset) {
      case "front":
        camera.position.set(0, -dist, 8);
        break;
      case "top":
        camera.position.set(0, -0.01, dist);
        break;
      case "right":
        camera.position.set(dist, 0, 8);
        break;
      case "iso":
      case "reset":
      default:
        camera.position.set(36, -38, 28);
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
  const [showProbes, setShowProbes] = useState<boolean>(false);
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

  const baseParsedData = useMemo((): {
    doc: QifDocument;
    scene: Qif3dMbdScene;
    rawSpcSvg: string;
    rawHeatmapSvg: string;
  } => {
    let doc: QifDocument;
    try {
      doc = parseQif(rawQifText);
    } catch {
      doc = parseQif(DEFAULT_QIF_XML);
    }
    const scene = buildQif3dMbdScene(doc, externalStepText);
    const rawSpcSvg = DOMPurify.sanitize(renderQifSpcChartSvg(scene.spcSummary));
    const rawHeatmapSvg = DOMPurify.sanitize(renderQifMbdHeatmapSvg(doc, scene.spcSummary));
    return {
      doc,
      scene,
      rawSpcSvg,
      rawHeatmapSvg,
    };
  }, [rawQifText, externalStepText]);

  const spcSvg = useMemo(
    () => adaptSvgMarkupForTheme(baseParsedData.rawSpcSvg, isDark),
    [baseParsedData.rawSpcSvg, isDark],
  );
  const heatmapSvg = useMemo(
    () => adaptSvgMarkupForTheme(baseParsedData.rawHeatmapSvg, isDark),
    [baseParsedData.rawHeatmapSvg, isDark],
  );

  const { doc, scene } = baseParsedData;

  const activeClippingPlanes = useMemo(() => {
    if (clipAxis === "none") return [];
    const span = 24;
    const d = clipOffset * span;
    if (clipAxis === "x") return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), d)];
    if (clipAxis === "y") return [new THREE.Plane(new THREE.Vector3(0, -1, 0), d)];
    return [new THREE.Plane(new THREE.Vector3(0, 0, -1), d)];
  }, [clipAxis, clipOffset]);

  const sceneScale = useMemo(() => {
    return scene.boundingBox.radius > 0 ? 17 / scene.boundingBox.radius : 0.42;
  }, [scene.boundingBox.radius]);

  const sceneCenter = scene.boundingBox.center;

  const title: string =
    viewConfig?.title || viewConfig?.filename || doc.header.partName || "TurbineBladeRoot_MBD_Inspection.qif";

  const activeCallout = useMemo(() => {
    if (selectedCharId) {
      return scene.callouts.find((c) => c.characteristicId === selectedCharId) ?? null;
    }
    if (selectedFeatureId) {
      return scene.callouts.find((c) => c.featureId === selectedFeatureId) ?? null;
    }
    return null;
  }, [scene.callouts, selectedCharId, selectedFeatureId]);

  const handleSelectCallout = (callout: Qif3dCalloutAnchor) => {
    setSelectedCharId((prev) => (prev === callout.characteristicId ? null : callout.characteristicId));
    setSelectedFeatureId((prev) =>
      selectedCharId === callout.characteristicId && prev === callout.featureId ? null : callout.featureId,
    );
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
      {/* Compact Single-Row Top Toolbar */}
      <Box
        height="44px"
        minHeight="44px"
        px={3}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        borderBottom="1px solid var(--color-border-default, #30363d)"
        bg="var(--surface-hud, var(--color-canvas-subtle, #161b22))"
        zIndex={20}
      >
        <Box display="flex" alignItems="center" gap={2} minWidth={0}>
          {!isFullScreen && (
            <Text
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-fg-default, #e6edf3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </Text>
          )}
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: "999px",
              background: "rgba(56, 189, 248, 0.15)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            QIF 3.0 · STEP AP242
          </span>
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexShrink={0}>
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
              { id: "code" as const, label: "Code" },
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
                    whiteSpace: "nowrap",
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
          <Box
            flex={1}
            position="relative"
            width="100%"
            height="100%"
            style={{
              background: isDark
                ? "radial-gradient(circle at 50% 48%, #1e293b 0%, #090d16 100%)"
                : "radial-gradient(circle at 50% 48%, #f8fafc 0%, #cbd5e1 100%)",
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

            {/* Floating Selected ASME Y14.5 Callout / Feature Inspector Pill (only visible when a feature/pin is clicked) */}
            {activeCallout && (
              <Box
                position="absolute"
                top={12}
                right={12}
                zIndex={10}
                px={2}
                py={1}
                borderRadius="10px"
                bg="rgba(15, 23, 42, 0.88)"
                border={`1px solid ${getStatusHexColor(activeCallout.status, activeCallout.toleranceRatio)}`}
                display="flex"
                alignItems="center"
                gap={2}
                style={{
                  backdropFilter: "blur(10px)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "11px",
                  color: "#f8fafc",
                }}
              >
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: getStatusHexColor(activeCallout.status, activeCallout.toleranceRatio),
                    color: "#0f172a",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9.5px",
                    fontWeight: 800,
                  }}
                >
                  {activeCallout.balloonNumber}
                </span>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>{activeCallout.gdtSymbol}</span>
                <span style={{ fontWeight: 700 }}>
                  {activeCallout.isDiametrical ? "⌀" : ""}
                  {activeCallout.toleranceZone}
                  {formatMaterialModifier(activeCallout.materialCondition)}
                </span>
                <span style={{ color: "#cbd5e1", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                  {activeCallout.datumReferences
                    .map((d) => `${d.datumLabel}${formatMaterialModifier(d.materialCondition)}`)
                    .join(" | ") || "Primary"}
                </span>
                {activeCallout.stepEntityId && (
                  <span style={{ color: "#38bdf8", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                    STEP {activeCallout.stepEntityId}
                  </span>
                )}
                {activeCallout.measuredValue !== undefined && (
                  <span style={{ color: "#94a3b8", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                    Act: <strong style={{ color: "#f8fafc" }}>{activeCallout.measuredValue.toFixed(3)}mm</strong>
                  </span>
                )}
                {activeCallout.cpk !== undefined && (
                  <span style={{ color: "#4ade80" }}>Cpk {activeCallout.cpk.toFixed(2)}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCharId(null);
                    setSelectedFeatureId(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "11px",
                  }}
                  aria-label="Clear selected GD&T callout"
                >
                  ✕
                </button>
              </Box>
            )}

            <Canvas
              gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
              camera={{ position: [36, -38, 28], up: [0, 0, 1], fov: 42 }}
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
                    onSelectFeature={(fid) => {
                      setSelectedFeatureId(fid ?? null);
                      setSelectedCharId(null);
                    }}
                  />
                ))}

                {/* 2. Compact Datum Reference Frame (DRF) Coordinate Axes at Origin */}
                <Line
                  points={[
                    [0, 0, 0],
                    [10, 0, 0],
                  ]}
                  color="#ef4444"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 10, 0],
                  ]}
                  color="#22c55e"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 0, 10],
                  ]}
                  color="#3b82f6"
                  lineWidth={1.6}
                />

                {/* 3. 3D CMM Touch-Probe Hit Spheres & Amplified Deviation Vectors */}
                {(showProbes || Boolean(selectedFeatureId)) &&
                  scene.probeHits.map((hit) => {
                    if (!showProbes && hit.featureId !== selectedFeatureId) return null;
                    const isHighlighted = !selectedFeatureId || hit.featureId === selectedFeatureId;
                    const devScale = 45;
                    const tip: [number, number, number] = [
                      hit.position[0] + hit.deviationVector[0] * devScale,
                      hit.position[1] + hit.deviationVector[1] * devScale,
                      hit.position[2] + hit.deviationVector[2] * devScale,
                    ];
                    return (
                      <group key={hit.id}>
                        <mesh position={hit.position}>
                          <sphereGeometry args={[isHighlighted ? 0.55 : 0.35, 10, 10]} />
                          <meshStandardMaterial
                            color={isHighlighted ? "#38bdf8" : "#475569"}
                            emissive={isHighlighted ? "#0284c7" : "#000000"}
                            emissiveIntensity={0.4}
                          />
                        </mesh>
                        {isHighlighted && <Line points={[hit.position, tip]} color="#38bdf8" lineWidth={1.2} />}
                      </group>
                    );
                  })}

                {/* 4. Compact 3D ASME Datum Reference Badges ([A], [B], [C]) */}
                {show3dLabels &&
                  scene.datumBadges.map((datum) => (
                    <group key={datum.datumId}>
                      <Line
                        points={[datum.surfaceAnchor, datum.badgePosition]}
                        color="#94a3b8"
                        lineWidth={1}
                        dashed
                        dashSize={1.5}
                        gapSize={1.5}
                      />
                      <Html position={datum.badgePosition} center zIndexRange={[1, 4]}>
                        <div
                          onClick={() => {
                            if (datum.featureId) {
                              setSelectedFeatureId((prev) => (prev === datum.featureId ? null : datum.featureId!));
                              setSelectedCharId(null);
                            }
                          }}
                          style={{
                            background: "rgba(15, 23, 42, 0.88)",
                            border: "1px solid #60a5fa",
                            borderRadius: "4px",
                            padding: "1px 5px",
                            color: "#f8fafc",
                            fontSize: "9.5px",
                            fontWeight: 700,
                            fontFamily: "var(--font-mono, monospace)",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                          }}
                          title={`Datum ${datum.datumLabel} (${datum.featureName ?? ""} ${datum.stepEntityId ?? ""})`}
                        >
                          [{datum.datumLabel}]
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
                          lineWidth={isActive ? 2 : 1.1}
                        />
                        <mesh position={callout.surfaceAnchor}>
                          <sphereGeometry args={[0.7, 10, 10]} />
                          <meshBasicMaterial color={isActive ? "#38bdf8" : statusColor} />
                        </mesh>
                        <Html position={callout.calloutPosition} center zIndexRange={[1, 5]}>
                          <div
                            onClick={() => handleSelectCallout(callout)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              background: isActive ? "rgba(14, 116, 144, 0.95)" : "rgba(15, 23, 42, 0.88)",
                              border: `1.2px solid ${isActive ? "#38bdf8" : statusColor}`,
                              borderRadius: "999px",
                              padding: "1.5px 6px 1.5px 3px",
                              color: "#f8fafc",
                              fontSize: "9.5px",
                              fontWeight: 600,
                              fontFamily: "var(--font-mono, monospace)",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                            }}
                            title={`${callout.characteristicName} (${callout.featureName} ${callout.stepEntityId ?? ""}) — Click to inspect`}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "14px",
                                height: "14px",
                                borderRadius: "50%",
                                background: statusColor,
                                color: "#0f172a",
                                fontWeight: 800,
                                fontSize: "9px",
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
                          </div>
                        </Html>
                      </group>
                    );
                  })}
              </group>

              <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} />
              <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} />
            </Canvas>

            {/* Bottom-Left Unified MBD Overlay Pill Bar (non-overlapping with top-left camera controls) */}
            <Box
              position="absolute"
              bottom={12}
              left={12}
              zIndex={10}
              px={2}
              py={1}
              borderRadius="20px"
              bg="rgba(15, 23, 42, 0.78)"
              border="1px solid rgba(255, 255, 255, 0.12)"
              display="flex"
              alignItems="center"
              gap={1}
              style={{
                backdropFilter: "blur(10px)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
                userSelect: "none",
              }}
            >
              {[
                {
                  label: "Heatmap",
                  active: showHeatmap,
                  toggle: () => setShowHeatmap((v) => !v),
                  dotColor: "#22c55e",
                },
                {
                  label: `CMM Hits (${scene.probeHits.length})`,
                  active: showProbes,
                  toggle: () => setShowProbes((v) => !v),
                  dotColor: "#38bdf8",
                },
                {
                  label: `GD&T Pins (${scene.callouts.length})`,
                  active: show3dLabels,
                  toggle: () => setShow3dLabels((v) => !v),
                  dotColor: "#f59e0b",
                },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={btn.toggle}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    cursor: "pointer",
                    background: btn.active ? "rgba(6, 182, 212, 0.25)" : "transparent",
                    color: btn.active ? "#38bdf8" : "#cbd5e1",
                    border: btn.active ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: btn.active ? btn.dotColor : "#64748b",
                    }}
                  />
                  {btn.label}
                </button>
              ))}
            </Box>

            {/* Bottom-Right Compact Metrology Status Pill */}
            <Box
              position="absolute"
              bottom={12}
              right={12}
              zIndex={10}
              px={2}
              py={1}
              borderRadius="20px"
              bg="rgba(15, 23, 42, 0.78)"
              border="1px solid rgba(255, 255, 255, 0.12)"
              display="flex"
              alignItems="center"
              gap={2}
              style={{
                backdropFilter: "blur(10px)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "10px",
                color: "#cbd5e1",
                userSelect: "none",
              }}
            >
              <span style={{ color: "#4ade80", fontWeight: 700 }}>
                B-Rep {scene.reconciliation.matchedFeatures.length}/{doc.features.length} Faces
              </span>
              <span style={{ color: "#64748b" }}>·</span>
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>Min Cpk {scene.spcSummary.minCpk.toFixed(2)}</span>
            </Box>
          </Box>
        )}

        {/* Bill of Characteristics (BoC) & ASME Y14.5 Feature Control Frames Tab */}
        {viewTab === "boc" && (
          <Box flex={1} overflow="auto" p={3} bg="var(--color-canvas-default, #0d1117)">
            <Box
              mb={2}
              pb={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              borderBottom="1px solid var(--color-border-default, #30363d)"
            >
              <Text
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: "var(--color-fg-default, #e6edf3)",
                }}
              >
                ASME Y14.5 Feature Control Frames &amp; CMM Actuals
              </Text>
              <Text style={{ fontSize: "10.5px", color: "var(--color-fg-muted, #8b949e)" }}>
                Click any row to isolate its 3D STEP B-Rep surface
              </Text>
            </Box>
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
                    color: "var(--color-fg-muted, #8b949e)",
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
                        borderBottom: "1px solid var(--color-border-muted, rgba(48, 54, 61, 0.6))",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "8px", fontWeight: 700 }}>{c.balloonNumber}</td>
                      <td style={{ padding: "8px" }}>{c.characteristicName}</td>
                      <td style={{ padding: "8px", color: "#0284c7" }}>
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
                      <td style={{ padding: "8px", color: "#16a34a", fontWeight: 600 }}>{c.cpk?.toFixed(2) ?? "—"}</td>
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
              bg={isDark ? "#0f172a" : "#ffffff"}
              dangerouslySetInnerHTML={{ __html: spcSvg }}
            />
            <Box
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              p={2}
              bg={isDark ? "#0f172a" : "#ffffff"}
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
