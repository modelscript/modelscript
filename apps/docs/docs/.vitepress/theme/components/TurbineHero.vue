<script setup lang="ts">
// SPDX-License-Identifier: AGPL-3.0-or-later

import { onMounted, onUnmounted, ref, watch } from "vue";
import { useData } from "vitepress";
import * as THREE from "three";

const { isDark } = useData();

const containerRef = ref<HTMLDivElement | null>(null);
const viewMode = ref<"split" | "wireframe" | "solid">("split");
const isPaused = ref(false);
const speedFactor = ref(1.0);
const rpmDisplay = ref("9,600");
const isDragging = ref(false);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let animFrameId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;
let isVisible = true;

// 3D Engine Subgroups
let engineAssembly: THREE.Group | null = null;
let rotorGroup: THREE.Group | null = null;
let solidGroup: THREE.Group | null = null;
let wireframeGroup: THREE.Group | null = null;
let particlesSystem: THREE.Points | null = null;
let ambientLight: THREE.AmbientLight | null = null;

// Materials references for dark/light mode switching
const wireLineMaterials: THREE.LineBasicMaterial[] = [];
const wireMeshMaterials: THREE.MeshBasicMaterial[] = [];
let laserSeamMat: THREE.LineBasicMaterial | null = null;

// Clipping planes for the half blue wireframe cutaway
const clipPlaneSolid = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const clipPlaneWire = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

// Interaction state
let isPointerDown = false;
let previousPointerPos = { x: 0, y: 0 };
let targetRotationX = 0.22;
let targetRotationY = -0.58;
let currentRotationX = 0.22;
let currentRotationY = -0.58;
let autoSpinTimer: ReturnType<typeof setTimeout> | null = null;
let isAutoSpinning = true;

const RPM_BASE = 9600;

function updateRPM() {
  if (isPaused.value) {
    rpmDisplay.value = "0";
  } else {
    const jitter = Math.floor(Math.random() * 80 - 40);
    const rpm = Math.round(RPM_BASE * speedFactor.value + jitter);
    rpmDisplay.value = rpm.toLocaleString();
  }
}

function setViewMode(mode: "split" | "wireframe" | "solid") {
  viewMode.value = mode;
  updateMaterialsClipping();
}

function togglePause() {
  isPaused.value = !isPaused.value;
  updateRPM();
}

function setSpeed(mult: number) {
  speedFactor.value = mult;
  isPaused.value = false;
  updateRPM();
}

function resetView() {
  targetRotationX = 0.22;
  targetRotationY = -0.55;
  currentRotationX = 0.22;
  currentRotationY = -0.55;
  isAutoSpinning = true;
  if (camera) {
    camera.position.set(0, 0.15, 8.8);
    camera.lookAt(0, 0, 0);
  }
}

function updateMaterialsClipping() {
  if (!renderer) return;

  const mode = viewMode.value;
  if (mode === "split") {
    renderer.localClippingEnabled = true;
    if (solidGroup) solidGroup.visible = true;
    if (wireframeGroup) wireframeGroup.visible = true;
  } else if (mode === "wireframe") {
    renderer.localClippingEnabled = false;
    if (solidGroup) solidGroup.visible = false;
    if (wireframeGroup) wireframeGroup.visible = true;
  } else if (mode === "solid") {
    renderer.localClippingEnabled = false;
    if (solidGroup) solidGroup.visible = true;
    if (wireframeGroup) wireframeGroup.visible = false;
  }
}

function applyThemeColors(dark: boolean) {
  const lineColor = dark ? 0x00f0ff : 0x0284c7;
  const meshColor = dark ? 0x0ea5e9 : 0x0369a1;

  for (const mat of wireLineMaterials) {
    mat.color.setHex(lineColor);
  }
  for (const mat of wireMeshMaterials) {
    mat.color.setHex(meshColor);
  }
  if (laserSeamMat) {
    laserSeamMat.color.setHex(dark ? 0x00ffff : 0x0284c7);
  }
  if (ambientLight) {
    ambientLight.color.setHex(dark ? 0x1e293b : 0xe2e8f0);
    ambientLight.intensity = dark ? 0.9 : 1.4;
  }
}

watch(isDark, (val) => {
  applyThemeColors(val);
});

/**
 * Procedural Construction of High-Fidelity Turbofan Jet Engine
 */
function createTurbineEngine() {
  const assembly = new THREE.Group();
  const solid = new THREE.Group();
  const wire = new THREE.Group();
  const rotor = new THREE.Group();

  wireLineMaterials.length = 0;
  wireMeshMaterials.length = 0;

  const dark = isDark.value ?? true;
  const lineColor = dark ? 0x00f0ff : 0x0284c7;
  const meshColor = dark ? 0x0ea5e9 : 0x0369a1;

  // Solid Materials (Lighter Aerospace Brushed Titanium / Light Aluminum / Polished Chrome)
  const solidNacelleMat = new THREE.MeshStandardMaterial({
    color: 0x8fa3bf, // Lighter, elegant brushed aerospace titanium
    roughness: 0.24,
    metalness: 0.88,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  const solidFanBladeMat = new THREE.MeshStandardMaterial({
    color: 0xdee6ed, // Bright polished titanium fan blades
    roughness: 0.15,
    metalness: 0.95,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  const solidSpinnerMat = new THREE.MeshStandardMaterial({
    color: 0x273548, // Clean metallic graphite bullet
    roughness: 0.18,
    metalness: 0.84,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  const solidShaftMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0, // Polished high-grade steel/chrome
    roughness: 0.12,
    metalness: 0.96,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  const solidCoreMat = new THREE.MeshStandardMaterial({
    color: 0x5a6d85, // Light titanium core stator casing
    roughness: 0.3,
    metalness: 0.85,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  const solidCombustorMat = new THREE.MeshStandardMaterial({
    color: 0x64748b, // High-temperature alloy
    roughness: 0.35,
    metalness: 0.8,
    clippingPlanes: [clipPlaneSolid],
    clipShadows: true,
  });

  // Wireframe Materials (Crisp Vector Edges + Translucent Volume)
  const wireLineMat = new THREE.LineBasicMaterial({
    color: lineColor,
    transparent: true,
    opacity: 0.9,
    clippingPlanes: [clipPlaneWire],
  });
  wireLineMaterials.push(wireLineMat);

  const wireMeshMat = new THREE.MeshBasicMaterial({
    color: meshColor,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    clippingPlanes: [clipPlaneWire],
  });
  wireMeshMaterials.push(wireMeshMat);

  // Helper to add geometry to both solid and clean wireframe branches
  function addPart(
    geom: THREE.BufferGeometry,
    solidMat: THREE.Material,
    parentRotor = false,
    edgeThreshold = 22
  ) {
    // Solid mesh
    const solidMesh = new THREE.Mesh(geom, solidMat);
    if (parentRotor) {
      solidRotorGroup.add(solidMesh);
    } else {
      solid.add(solidMesh);
    }

    // Clean wireframe: EdgesGeometry extracts genuine topological contours
    const wireMesh = new THREE.Mesh(geom, wireMeshMat);
    const edges = new THREE.EdgesGeometry(geom, edgeThreshold);
    const wireLines = new THREE.LineSegments(edges, wireLineMat);

    const wireCompound = new THREE.Group();
    wireCompound.add(wireMesh);
    wireCompound.add(wireLines);

    if (parentRotor) {
      wireRotorGroup.add(wireCompound);
    } else {
      wire.add(wireCompound);
    }
  }

  const solidRotorGroup = new THREE.Group();
  const wireRotorGroup = new THREE.Group();
  rotor.add(solidRotorGroup);
  rotor.add(wireRotorGroup);

  // ==========================================
  // 1. NACELLE / CASING (Stationary)
  // ==========================================
  // Intake Cowl Lip (aerodynamic rounded leading edge in X-Y plane at Z = 2.3)
  const lipGeom = new THREE.TorusGeometry(2.32, 0.14, 16, 40);
  lipGeom.translate(0, 0, 2.3);
  addPart(lipGeom, solidNacelleMat, false, 28);

  // Outer Nacelle Barrel (aligned along Z axis)
  const nacelleGeom = new THREE.CylinderGeometry(2.36, 2.44, 3.4, 40, 5, true);
  nacelleGeom.rotateX(Math.PI / 2);
  nacelleGeom.translate(0, 0, 0.6);
  addPart(nacelleGeom, solidNacelleMat, false, 24);

  // Inner Bypass Casing Duct
  const bypassInnerGeom = new THREE.CylinderGeometry(2.18, 2.22, 3.3, 40, 4, true);
  bypassInnerGeom.rotateX(Math.PI / 2);
  bypassInnerGeom.translate(0, 0, 0.6);
  addPart(bypassInnerGeom, solidCoreMat, false, 24);

  // Outer Structural Flange Stiffener Rings (encircling Z axis)
  const flangeZ = [2.1, 1.3, 0.4, -0.4, -1.0];
  for (const z of flangeZ) {
    const flangeGeom = new THREE.TorusGeometry(2.44, 0.045, 8, 40);
    flangeGeom.translate(0, 0, z);
    addPart(flangeGeom, solidNacelleMat, false, 28);
  }

  // Aft Bypass Exhaust Nozzle Ring
  const bypassNozzleGeom = new THREE.CylinderGeometry(2.26, 2.36, 0.6, 40, 2, true);
  bypassNozzleGeom.rotateX(Math.PI / 2);
  bypassNozzleGeom.translate(0, 0, -1.3);
  addPart(bypassNozzleGeom, solidNacelleMat, false, 24);

  // ==========================================
  // NACELLE & CASING WIREFRAME GRID / FABRIC (Horizontal Stringer Lines)
  // Connects the circumferential rings along the engine axis into a CAD grid
  // ==========================================
  const gridPositions: number[] = [];

  // 1. Outer Nacelle Longitudinal Stringers (connecting the rings into a structural grid fabric)
  const numOuterStringers = 40; // 40 longitudinal lines around circumference (matching 40-seg rings)
  const outerGridStations = [
    { z: 2.32, r: 2.42 }, // Intake cowl lip rim
    { z: 2.10, r: 2.44 }, // Flange 1
    { z: 1.70, r: 2.44 }, // Intermediate hoop
    { z: 1.30, r: 2.44 }, // Flange 2
    { z: 0.85, r: 2.44 }, // Intermediate hoop
    { z: 0.40, r: 2.44 }, // Flange 3
    { z: 0.00, r: 2.44 }, // Intermediate hoop
    { z: -0.40, r: 2.44 }, // Flange 4
    { z: -0.70, r: 2.44 }, // Intermediate hoop
    { z: -1.00, r: 2.44 }, // Flange 5
    { z: -1.30, r: 2.36 }, // Aft bypass nozzle start
    { z: -1.60, r: 2.26 }, // Aft bypass nozzle trailing edge
  ];

  for (let i = 0; i < numOuterStringers; i++) {
    const angle = (i * Math.PI * 2) / numOuterStringers;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let s = 0; s < outerGridStations.length - 1; s++) {
      const s0 = outerGridStations[s];
      const s1 = outerGridStations[s + 1];
      gridPositions.push(
        s0.r * cosA, s0.r * sinA, s0.z,
        s1.r * cosA, s1.r * sinA, s1.z,
      );
    }
  }

  // Intermediate circumferential hoop rings on outer nacelle for complete grid fabric
  const intermediateOuterHoops = [1.70, 0.85, 0.00, -0.70];
  for (const z of intermediateOuterHoops) {
    const segs = 40;
    const r = 2.44;
    for (let j = 0; j < segs; j++) {
      const a0 = (j * Math.PI * 2) / segs;
      const a1 = ((j + 1) * Math.PI * 2) / segs;
      gridPositions.push(
        r * Math.cos(a0), r * Math.sin(a0), z,
        r * Math.cos(a1), r * Math.sin(a1), z,
      );
    }
  }

  // 2. Inner Bypass Duct Longitudinal Stringers
  const numInnerStringers = 24;
  const innerStations = [
    { z: 2.25, r: 2.18 },
    { z: 1.30, r: 2.19 },
    { z: 0.40, r: 2.20 },
    { z: -0.40, r: 2.21 },
    { z: -1.05, r: 2.22 },
  ];
  for (let i = 0; i < numInnerStringers; i++) {
    const angle = (i * Math.PI * 2) / numInnerStringers;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let s = 0; s < innerStations.length - 1; s++) {
      const s0 = innerStations[s];
      const s1 = innerStations[s + 1];
      gridPositions.push(
        s0.r * cosA, s0.r * sinA, s0.z,
        s1.r * cosA, s1.r * sinA, s1.z,
      );
    }
  }

  // 3. Core Stator Casing Longitudinal Stringers (connecting stator rings)
  const numCoreStringers = 16;
  const coreStations = [
    { z: 1.20, r: 0.96 },
    { z: 0.85, r: 0.96 },
    { z: 0.52, r: 0.96 },
    { z: 0.24, r: 0.96 },
    { z: -0.04, r: 0.96 },
    { z: -0.65, r: 0.86 },
  ];
  for (let i = 0; i < numCoreStringers; i++) {
    const angle = (i * Math.PI * 2) / numCoreStringers;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let s = 0; s < coreStations.length - 1; s++) {
      const s0 = coreStations[s];
      const s1 = coreStations[s + 1];
      gridPositions.push(
        s0.r * cosA, s0.r * sinA, s0.z,
        s1.r * cosA, s1.r * sinA, s1.z,
      );
    }
  }

  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
  const gridLines = new THREE.LineSegments(gridGeom, wireLineMat);
  wire.add(gridLines);

  // ==========================================
  // 2. OUTLET GUIDE VANES (OGV) & STRUTS (Stationary)
  // ==========================================
  // 24 Stator Vanes behind the fan
  const numOGV = 24;
  for (let i = 0; i < numOGV; i++) {
    const angle = (i * Math.PI * 2) / numOGV;
    const ogvGeom = new THREE.BoxGeometry(0.04, 1.25, 0.22);
    ogvGeom.translate(0, 1.55, 1.5);
    ogvGeom.rotateZ(angle);
    ogvGeom.rotateY(0.18);
    addPart(ogvGeom, solidCoreMat, false, 20);
  }

  // 4 Structural Pylons
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const pylonGeom = new THREE.BoxGeometry(0.12, 1.35, 0.45);
    pylonGeom.translate(0, 1.58, 0.3);
    pylonGeom.rotateZ(angle);
    addPart(pylonGeom, solidCoreMat, false, 20);
  }

  // ==========================================
  // 3. SPINNER & ROTOR HUB (Spinning, Coaxial with Z axis)
  // ==========================================
  // Aerodynamic Nose Spinner Cone
  const spinnerGeom = new THREE.ConeGeometry(0.70, 1.15, 32);
  spinnerGeom.rotateX(Math.PI / 2); // Rotates apex from +Y to +Z
  spinnerGeom.translate(0, 0, 2.22); // Base at Z = 1.65, apex at Z = 2.80
  addPart(spinnerGeom, solidSpinnerMat, true, 28);

  // Spinner Base Hub Ring
  const spinnerHubGeom = new THREE.CylinderGeometry(0.72, 0.72, 0.25, 32);
  spinnerHubGeom.rotateX(Math.PI / 2);
  spinnerHubGeom.translate(0, 0, 1.55);
  addPart(spinnerHubGeom, solidShaftMat, true, 28);

  // Chrome Tip on Spinner
  const tipGeom = new THREE.SphereGeometry(0.06, 16, 16);
  tipGeom.translate(0, 0, 2.80);
  addPart(tipGeom, solidShaftMat, true, 28);

  // ==========================================
  // 4. MAIN INTAKE FAN BLADES (22 Blades, Spinning)
  // ==========================================
  const numFanBlades = 22;
  const bladeHeight = 1.48;
  for (let i = 0; i < numFanBlades; i++) {
    const angle = (i * Math.PI * 2) / numFanBlades;

    const bladeGeom = new THREE.BoxGeometry(0.045, bladeHeight, 0.46);
    bladeGeom.translate(0, 0.7 + bladeHeight / 2, 0);
    bladeGeom.rotateX(0.52);
    bladeGeom.rotateY(-0.15);
    bladeGeom.rotateZ(angle);
    bladeGeom.translate(0, 0, 1.82);

    addPart(bladeGeom, solidFanBladeMat, true, 18);
  }

  // ==========================================
  // 5. COMPRESSOR SPOOL (LPC + HPC, Spinning)
  // ==========================================
  // Central Rotor Shaft
  const shaftGeom = new THREE.CylinderGeometry(0.18, 0.18, 5.2, 20);
  shaftGeom.rotateX(Math.PI / 2);
  shaftGeom.translate(0, 0, -0.4);
  addPart(shaftGeom, solidShaftMat, true, 25);

  // Tapered HPC Rotor Drum
  const hpcDrumGeom = new THREE.CylinderGeometry(0.42, 0.52, 1.4, 28);
  hpcDrumGeom.rotateX(Math.PI / 2);
  hpcDrumGeom.translate(0, 0, 0.1);
  addPart(hpcDrumGeom, solidShaftMat, true, 25);

  // LPC Booster Stages (2 stages)
  const lpcStages = [
    { z: 1.35, r: 1.15, blades: 18, chord: 0.28 },
    { z: 1.05, r: 1.05, blades: 20, chord: 0.24 },
  ];
  for (const stage of lpcStages) {
    const diskGeom = new THREE.CylinderGeometry(stage.r * 0.5, stage.r * 0.5, 0.08, 20);
    diskGeom.rotateX(Math.PI / 2);
    diskGeom.translate(0, 0, stage.z);
    addPart(diskGeom, solidShaftMat, true, 25);

    const bHeight = stage.r * 0.52;
    for (let i = 0; i < stage.blades; i++) {
      const bAngle = (i * Math.PI * 2) / stage.blades;
      const bGeom = new THREE.BoxGeometry(0.035, bHeight, stage.chord);
      bGeom.translate(0, stage.r * 0.5 + bHeight / 2, 0);
      bGeom.rotateX(0.42);
      bGeom.rotateZ(bAngle);
      bGeom.translate(0, 0, stage.z);
      addPart(bGeom, solidFanBladeMat, true, 18);
    }
  }

  // HPC Stages (4 stepped stages)
  const hpcStages = [
    { z: 0.65, r: 0.94, blades: 24, chord: 0.18 },
    { z: 0.38, r: 0.88, blades: 26, chord: 0.16 },
    { z: 0.10, r: 0.82, blades: 28, chord: 0.14 },
    { z: -0.18, r: 0.76, blades: 30, chord: 0.12 },
  ];
  for (const stage of hpcStages) {
    const diskGeom = new THREE.CylinderGeometry(stage.r * 0.55, stage.r * 0.55, 0.06, 20);
    diskGeom.rotateX(Math.PI / 2);
    diskGeom.translate(0, 0, stage.z);
    addPart(diskGeom, solidShaftMat, true, 25);

    const bHeight = stage.r * 0.46;
    for (let i = 0; i < stage.blades; i++) {
      const bAngle = (i * Math.PI * 2) / stage.blades;
      const bGeom = new THREE.BoxGeometry(0.025, bHeight, stage.chord);
      bGeom.translate(0, stage.r * 0.55 + bHeight / 2, 0);
      bGeom.rotateX(0.36);
      bGeom.rotateZ(bAngle);
      bGeom.translate(0, 0, stage.z);
      addPart(bGeom, solidFanBladeMat, true, 18);
    }
  }

  // ==========================================
  // 6. ENGINE CORE STATOR CASING & VANES (Stationary)
  // ==========================================
  const statorZ = [1.2, 0.85, 0.52, 0.24, -0.04];
  for (const z of statorZ) {
    const ringGeom = new THREE.TorusGeometry(0.96, 0.025, 6, 32);
    ringGeom.translate(0, 0, z);
    addPart(ringGeom, solidCoreMat, false, 28);

    for (let i = 0; i < 14; i++) {
      const angle = (i * Math.PI * 2) / 14;
      const vGeom = new THREE.BoxGeometry(0.02, 0.35, 0.12);
      vGeom.translate(0, 0.78, 0);
      vGeom.rotateX(-0.35);
      vGeom.rotateZ(angle);
      vGeom.translate(0, 0, z);
      addPart(vGeom, solidCoreMat, false, 18);
    }
  }

  // Core Casing Shell
  const coreShellGeom = new THREE.CylinderGeometry(0.85, 1.05, 3.2, 32, 4, true);
  coreShellGeom.rotateX(Math.PI / 2);
  coreShellGeom.translate(0, 0, -0.4);
  addPart(coreShellGeom, solidCoreMat, false, 24);

  // ==========================================
  // 7. COMBUSTION SECTION (Stationary)
  // ==========================================
  const combustorGeom = new THREE.CylinderGeometry(0.78, 0.82, 0.7, 28, 2, true);
  combustorGeom.rotateX(Math.PI / 2);
  combustorGeom.translate(0, 0, -0.65);
  addPart(combustorGeom, solidCombustorMat, false, 24);

  const manifoldRingGeom = new THREE.TorusGeometry(0.86, 0.035, 8, 32);
  manifoldRingGeom.translate(0, 0, -0.65);
  addPart(manifoldRingGeom, solidShaftMat, false, 28);

  const numInjectors = 16;
  for (let i = 0; i < numInjectors; i++) {
    const angle = (i * Math.PI * 2) / numInjectors;
    const nozzleGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10);
    nozzleGeom.translate(0, 0.82, -0.65);
    nozzleGeom.rotateZ(angle);
    addPart(nozzleGeom, solidShaftMat, false, 20);
  }

  // ==========================================
  // 8. TURBINE SECTION (HPT & LPT, Spinning)
  // ==========================================
  const hptDiskGeom = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 20);
  hptDiskGeom.rotateX(Math.PI / 2);
  hptDiskGeom.translate(0, 0, -1.22);
  addPart(hptDiskGeom, solidShaftMat, true, 25);

  const numHptBlades = 28;
  for (let i = 0; i < numHptBlades; i++) {
    const angle = (i * Math.PI * 2) / numHptBlades;
    const bGeom = new THREE.BoxGeometry(0.028, 0.42, 0.16);
    bGeom.translate(0, 0.48 + 0.21, 0);
    bGeom.rotateX(-0.48);
    bGeom.rotateZ(angle);
    bGeom.translate(0, 0, -1.22);
    addPart(bGeom, solidFanBladeMat, true, 18);
  }

  const lptStages = [
    { z: -1.62, r: 0.86, blades: 26, chord: 0.18 },
    { z: -1.98, r: 0.82, blades: 24, chord: 0.20 },
  ];
  for (const stage of lptStages) {
    const diskGeom = new THREE.CylinderGeometry(0.44, 0.44, 0.08, 20);
    diskGeom.rotateX(Math.PI / 2);
    diskGeom.translate(0, 0, stage.z);
    addPart(diskGeom, solidShaftMat, true, 25);

    const bHeight = stage.r - 0.44;
    for (let i = 0; i < stage.blades; i++) {
      const angle = (i * Math.PI * 2) / stage.blades;
      const bGeom = new THREE.BoxGeometry(0.03, bHeight, stage.chord);
      bGeom.translate(0, 0.44 + bHeight / 2, 0);
      bGeom.rotateX(-0.42);
      bGeom.rotateZ(angle);
      bGeom.translate(0, 0, stage.z);
      addPart(bGeom, solidFanBladeMat, true, 18);
    }
  }

  // Aerodynamic Tail Cone / Exhaust Plug (Coaxial with Z axis)
  const tailConeGeom = new THREE.ConeGeometry(0.50, 1.25, 28);
  tailConeGeom.rotateX(-Math.PI / 2); // Rotates apex from +Y to -Z
  tailConeGeom.translate(0, 0, -2.65); // Base at Z = -2.02, apex at Z = -3.27
  addPart(tailConeGeom, solidSpinnerMat, true, 25);

  // Core Primary Exhaust Nozzle Shroud (Stationary)
  const coreExhaustGeom = new THREE.CylinderGeometry(0.92, 0.84, 0.9, 32, 2, true);
  coreExhaustGeom.rotateX(Math.PI / 2);
  coreExhaustGeom.translate(0, 0, -2.25);
  addPart(coreExhaustGeom, solidCoreMat, false, 24);

  // ==========================================
  // 9. LASER CUTAWAY SEAM ACCENT (Traces nacelle cut edges along X = 0)
  // ==========================================
  const topSeamPoints = [
    new THREE.Vector3(0, 2.18, 2.3),
    new THREE.Vector3(0, 2.44, 2.3),
    new THREE.Vector3(0, 2.44, -1.3),
    new THREE.Vector3(0, 2.22, -1.3),
  ];
  const bottomSeamPoints = [
    new THREE.Vector3(0, -2.18, 2.3),
    new THREE.Vector3(0, -2.44, 2.3),
    new THREE.Vector3(0, -2.44, -1.3),
    new THREE.Vector3(0, -2.22, -1.3),
  ];
  const seamGeom1 = new THREE.BufferGeometry().setFromPoints(topSeamPoints);
  const seamGeom2 = new THREE.BufferGeometry().setFromPoints(bottomSeamPoints);
  laserSeamMat = new THREE.LineBasicMaterial({
    color: dark ? 0x00ffff : 0x0284c7,
    transparent: true,
    opacity: 0.95,
  });
  assembly.add(new THREE.Line(seamGeom1, laserSeamMat));
  assembly.add(new THREE.Line(seamGeom2, laserSeamMat));

  assembly.add(solid);
  assembly.add(wire);
  assembly.add(rotor);

  return { assembly, solid, wire, rotor };
}

/**
 * Aerodynamic Streamline Particles (CFD Flow Simulation Effect)
 */
function createAirflowParticles(): THREE.Points {
  const count = 120;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.45 + Math.random() * 1.7;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = 3.6 - Math.random() * 7.2;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i] = 0.05 + Math.random() * 0.08;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x38bdf8,
    size: 0.05,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geom, mat);
  (particles as any)._velocities = velocities;
  return particles;
}

function updateParticles(particles: THREE.Points, speedMult: number) {
  const geom = particles.geometry;
  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
  const positions = posAttr.array as Float32Array;
  const velocities = (particles as any)._velocities as Float32Array;
  const count = velocities.length;

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 2] -= velocities[i] * speedMult;
    if (positions[i * 3 + 2] < -3.6) {
      positions[i * 3 + 2] = 3.6;
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.45 + Math.random() * 1.7;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
    }
  }
  posAttr.needsUpdate = true;
}

function initScene() {
  if (!containerRef.value) return;

  const width = containerRef.value.clientWidth || 480;
  const height = containerRef.value.clientHeight || 450;

  // Scene
  scene = new THREE.Scene();

  // Camera: 3/4 Perspective showcasing intake and cutaway
  camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 0.15, 8.8);
  camera.lookAt(0, 0, 0);

  // WebGL Renderer with High-DPI & Anti-aliasing
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  containerRef.value.innerHTML = "";
  containerRef.value.appendChild(renderer.domElement);

  // Lighting Setup (High-End Aerospace CAD Studio)
  const dark = isDark.value ?? true;
  ambientLight = new THREE.AmbientLight(dark ? 0x1e293b : 0xe2e8f0, dark ? 0.9 : 1.4);
  scene.add(ambientLight);

  // Key Light (top-front-right cool white)
  const keyLight = new THREE.DirectionalLight(0xe0f2fe, 2.4);
  keyLight.position.set(5, 6, 7);
  scene.add(keyLight);

  // Fill Light (bottom-left purple/blue reflection)
  const fillLight = new THREE.DirectionalLight(0x818cf8, 1.4);
  fillLight.position.set(-6, -3, 3);
  scene.add(fillLight);

  // Rim Light (sharp cyan highlight from rear-top)
  const rimLight = new THREE.DirectionalLight(0x00f0ff, 3.2);
  rimLight.position.set(0, 5, -6);
  scene.add(rimLight);

  // Internal Core Glow (simulating high-energy combustor core)
  const coreLight = new THREE.PointLight(0x00d2ff, 1.8, 4);
  coreLight.position.set(0, 0, -0.6);
  scene.add(coreLight);

  // Build Engine Assembly
  const engine = createTurbineEngine();
  engineAssembly = engine.assembly;
  solidGroup = engine.solid;
  wireframeGroup = engine.wire;
  rotorGroup = engine.rotor;

  // Set initial orientation: Yaw -33°, Pitch 13°
  engineAssembly.rotation.x = currentRotationX;
  engineAssembly.rotation.y = currentRotationY;
  scene.add(engineAssembly);

  // Add Airflow Streamline Particles
  particlesSystem = createAirflowParticles();
  engineAssembly.add(particlesSystem);

  // Setup Resize Observer
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0 && camera && renderer) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    }
  });
  resizeObserver.observe(containerRef.value);

  // Setup Intersection Observer to pause rendering when offscreen
  intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      isVisible = entry.isIntersecting;
    }
  });
  intersectionObserver.observe(containerRef.value);

  // Start Animation Loop
  let lastTime = performance.now();
  let rpmTimer = 0;

  const animate = (currentTime: number) => {
    animFrameId = requestAnimationFrame(animate);

    if (!isVisible) return;

    const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    rpmTimer += delta;
    if (rpmTimer > 0.4) {
      rpmTimer = 0;
      updateRPM();
    }

    const speed = isPaused.value ? 0 : speedFactor.value;

    // 1. High-speed turbine rotor rotation around engine axis (Z)
    if (rotorGroup && speed > 0) {
      rotorGroup.rotation.z += 14.0 * delta * speed;
    }

    // 2. Airflow streamline particles animation
    if (particlesSystem && speed > 0) {
      updateParticles(particlesSystem, speed);
    }

    // 3. Smooth Ambient Sway & User Drag Interpolation
    if (isAutoSpinning && !isPointerDown && speed > 0) {
      // Gentle floating sway around optimal 3/4 perspective
      const swayTime = currentTime * 0.0008;
      targetRotationY = -0.55 + Math.sin(swayTime) * 0.2;
      targetRotationX = 0.22 + Math.cos(swayTime * 0.7) * 0.06;
    }

    // Smooth damping towards target angles
    currentRotationX += (targetRotationX - currentRotationX) * 0.08;
    currentRotationY += (targetRotationY - currentRotationY) * 0.08;

    if (engineAssembly) {
      engineAssembly.rotation.x = currentRotationX;
      engineAssembly.rotation.y = currentRotationY;

      // Update clipping planes to remain locked to the engine's local cut plane (X = 0)
      if (renderer && renderer.localClippingEnabled) {
        const localNormalSolid = new THREE.Vector3(-1, 0, 0);
        const localNormalWire = new THREE.Vector3(1, 0, 0);
        const worldNormalSolid = new THREE.Vector3();
        const worldNormalWire = new THREE.Vector3();
        const worldPos = new THREE.Vector3();

        engineAssembly.getWorldPosition(worldPos);

        worldNormalSolid.copy(localNormalSolid).applyQuaternion(engineAssembly.quaternion);
        clipPlaneSolid.setFromNormalAndCoplanarPoint(worldNormalSolid, worldPos);

        worldNormalWire.copy(localNormalWire).applyQuaternion(engineAssembly.quaternion);
        clipPlaneWire.setFromNormalAndCoplanarPoint(worldNormalWire, worldPos);
      }
    }

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  };

  animFrameId = requestAnimationFrame(animate);
}

// Pointer & Touch Interaction Handlers
function onPointerDown(e: MouseEvent | TouchEvent) {
  isPointerDown = true;
  isDragging.value = true;
  isAutoSpinning = false;
  if (autoSpinTimer) clearTimeout(autoSpinTimer);

  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
  previousPointerPos = { x: clientX, y: clientY };
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  if (!isPointerDown) return;

  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

  const deltaX = clientX - previousPointerPos.x;
  const deltaY = clientY - previousPointerPos.y;

  targetRotationY += deltaX * 0.0075;
  targetRotationX = Math.max(-1.1, Math.min(1.1, targetRotationX + deltaY * 0.0075));

  previousPointerPos = { x: clientX, y: clientY };
}

function onPointerUp() {
  isPointerDown = false;
  isDragging.value = false;

  // Resume auto-spin after 3 seconds of user inactivity
  if (autoSpinTimer) clearTimeout(autoSpinTimer);
  autoSpinTimer = setTimeout(() => {
    isAutoSpinning = true;
  }, 3200);
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (!camera) return;

  const newZ = camera.position.z + e.deltaY * 0.005;
  camera.position.z = Math.max(4.5, Math.min(12.0, newZ));
}

onMounted(() => {
  if (typeof window !== "undefined") {
    initScene();
    updateRPM();
  }
});

onUnmounted(() => {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }
  if (autoSpinTimer) {
    clearTimeout(autoSpinTimer);
  }

  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }
  scene = null;
  camera = null;
  renderer = null;
});
</script>

<template>
  <div
    class="turbine-hero-wrapper"
    :class="{ dragging: isDragging }"
    @mousedown="onPointerDown"
    @mousemove="onPointerMove"
    @mouseup="onPointerUp"
    @mouseleave="onPointerUp"
    @touchstart.passive="onPointerDown"
    @touchmove.passive="onPointerMove"
    @touchend="onPointerUp"
    @wheel="onWheel"
  >
    <!-- Background atmospheric glowing aura -->
    <div class="turbine-aura"></div>

    <!-- 3D WebGL Canvas Container -->
    <div ref="containerRef" class="turbine-canvas-container"></div>

    <!-- Interactive Engineering Telemetry & Controls HUD -->
    <div class="turbine-hud">
      <div class="hud-panel" @mousedown.stop @touchstart.stop>
        <!-- Mode Selector Pills -->
        <div class="hud-modes">
          <button
            type="button"
            class="hud-btn"
            :class="{ active: viewMode === 'split' }"
            title="Half Blue Wireframe / Half Solid Titanium"
            @click="setViewMode('split')"
          >
            <span class="mode-icon">⚡</span>
            <span class="mode-label">Split Cutaway</span>
          </button>
          <button
            type="button"
            class="hud-btn"
            :class="{ active: viewMode === 'wireframe' }"
            title="Full Holographic Cyan Wireframe"
            @click="setViewMode('wireframe')"
          >
            <span class="mode-icon">🌐</span>
            <span class="mode-label">Wireframe</span>
          </button>
          <button
            type="button"
            class="hud-btn"
            :class="{ active: viewMode === 'solid' }"
            title="Full Aerospace Solid Finish"
            @click="setViewMode('solid')"
          >
            <span class="mode-icon">🛡️</span>
            <span class="mode-label">Solid</span>
          </button>
        </div>

        <div class="hud-divider"></div>

        <!-- Telemetry Info & Speed Controls -->
        <div class="hud-telemetry">
          <div class="telemetry-badge" :title="'Turbine Core Speed: ' + rpmDisplay + ' RPM'">
            <span class="pulse-dot" :class="{ paused: isPaused }"></span>
            <span class="rpm-value">{{ rpmDisplay }}</span>
            <span class="rpm-unit">RPM</span>
          </div>

          <div class="hud-actions">
            <button
              type="button"
              class="telemetry-icon-btn"
              :class="{ paused: isPaused }"
              :title="isPaused ? 'Resume Rotation' : 'Pause Rotation'"
              @click="togglePause"
            >
              {{ isPaused ? "▶" : "⏸" }}
            </button>
            <button
              type="button"
              class="telemetry-icon-btn"
              :class="{ active: speedFactor === 1.8 && !isPaused }"
              title="Turbo Speed (1.8x)"
              @click="setSpeed(speedFactor === 1.8 ? 1.0 : 1.8)"
            >
              ⚡
            </button>
            <button
              type="button"
              class="telemetry-icon-btn reset-btn"
              title="Reset 3D Perspective"
              @click="resetView"
            >
              ↺
            </button>
          </div>
        </div>
      </div>

      <!-- Drag & Zoom Hint Overlay -->
      <div class="hud-hint">
        <span>Drag to rotate • Scroll to zoom</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turbine-hero-wrapper {
  position: relative;
  width: 100%;
  height: 560px;
  min-height: 460px;
  margin: 0 auto;
  user-select: none;
  touch-action: none;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.turbine-hero-wrapper.dragging {
  cursor: grabbing;
}

/* Atmospheric Glow behind the 3D turbine */
.turbine-aura {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    rgba(14, 165, 233, 0.32) 0%,
    rgba(124, 58, 237, 0.24) 45%,
    rgba(0, 0, 0, 0) 70%
  );
  filter: blur(64px);
  pointer-events: none;
  z-index: 0;
  animation: pulse-aura 6s ease-in-out infinite alternate;
}

@keyframes pulse-aura {
  0% {
    transform: translate(-50%, -50%) scale(0.95);
    opacity: 0.75;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.08);
    opacity: 1;
  }
}

.turbine-canvas-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 900px;
  height: 720px;
  max-width: 95vw;
  z-index: 1;
  pointer-events: auto;
  overflow: visible;
}

.turbine-canvas-container :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  outline: none;
}

/* Engineering Telemetry HUD */
.turbine-hud {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 24px);
  max-width: 450px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 2;
  pointer-events: none;
}

.hud-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 6px;
  background: rgba(15, 23, 42, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 24px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.hud-modes {
  display: flex;
  align-items: center;
  gap: 3px;
}

.hud-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.hud-btn:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.hud-btn.active {
  color: #38bdf8;
  background: rgba(14, 165, 233, 0.18);
  border-color: rgba(56, 189, 248, 0.38);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
}

.mode-icon {
  font-size: 10.5px;
}

.hud-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 3px;
}

.hud-telemetry {
  display: flex;
  align-items: center;
  gap: 6px;
}

.telemetry-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  background: rgba(2, 6, 23, 0.65);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-radius: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00f0ff;
  box-shadow: 0 0 8px #00f0ff;
  animation: pulse-cyan 1.5s infinite;
}

.pulse-dot.paused {
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
  animation: none;
}

@keyframes pulse-cyan {
  0% {
    opacity: 0.4;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }
}

.rpm-value {
  font-size: 11px;
  font-weight: 600;
  color: #f1f5f9;
}

.rpm-unit {
  font-size: 9px;
  color: #38bdf8;
  letter-spacing: 0.05em;
}

.hud-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}

.telemetry-icon-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #94a3b8;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.telemetry-icon-btn:hover {
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(14, 165, 233, 0.15);
}

.telemetry-icon-btn.active {
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(14, 165, 233, 0.25);
}

.reset-btn {
  font-size: 13px;
}

.hud-hint {
  font-size: 10px;
  color: #64748b;
  letter-spacing: 0.02em;
  opacity: 0.85;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  transition: opacity 0.2s ease;
}

.turbine-hero-wrapper:hover .hud-hint {
  opacity: 1;
  color: #94a3b8;
}

@media (max-width: 959px) {
  .turbine-hero-wrapper {
    height: 460px;
  }
  .turbine-canvas-container {
    width: 720px;
    height: 560px;
    max-width: 100vw;
  }
  .turbine-aura {
    width: 380px;
    height: 380px;
  }
}

@media (max-width: 640px) {
  .turbine-hero-wrapper {
    height: 380px;
  }
  .turbine-canvas-container {
    width: 520px;
    height: 440px;
    max-width: 100vw;
  }
  .turbine-aura {
    width: 300px;
    height: 300px;
  }
  .hud-btn .mode-label {
    display: none;
  }
  .hud-btn {
    padding: 4px 7px;
  }
  .hud-panel {
    border-radius: 18px;
  }
}
</style>
