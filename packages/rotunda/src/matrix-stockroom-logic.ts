// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GalleryComponentItem } from "./componentGalleryCatalog.js";

/** Number of visible interactive columns along each flanking Matrix corridor wall. */
export const STOCKROOM_VISIBLE_COLS = 5;
/** Number of visible vertical shelf tiers per wall (lower, eye/chest, upper). */
export const STOCKROOM_VISIBLE_ROWS = 3;
/** Total interactive component bays visible simultaneously across both flanking walls. */
export const STOCKROOM_TOTAL_VISIBLE_SLOTS = STOCKROOM_VISIBLE_COLS * STOCKROOM_VISIBLE_ROWS * 2;

/** Lateral offset (m) of the left (-X) and right (+X) shelf corridors from standing center. */
export const STOCKROOM_WALL_X = 1.12;
/** Center Y elevation (m) of the middle shelf tier (eye/chest ergonomic height). */
export const STOCKROOM_CENTER_Y = 1.34;
/** Center Z depth (m) of the interactive shelf corridor. */
export const STOCKROOM_CENTER_Z = -1.08;
/** Spacing (m) between adjacent shelf columns along the corridor aisle. */
export const STOCKROOM_COL_SPACING = 0.62;
/** Spacing (m) between adjacent vertical shelf tiers. */
export const STOCKROOM_ROW_SPACING = 0.44;
/** Physical card plaque width & height (m) — large & crisp for Quest 2 legibility. */
export const STOCKROOM_CARD_W = 0.52;
export const STOCKROOM_CARD_H = 0.34;
/** Subtle inward angle (rad) so the corridor walls face the user comfortably. */
export const STOCKROOM_WALL_TOE_IN_RAD = (8 * Math.PI) / 180;

/** Duration (seconds) of the Matrix Construct whiz-in arrival animation. */
export const STOCKROOM_ENTRANCE_DURATION_SEC = 0.68;
/** Starting Z setback (m) from which racks blast forward into place on load. */
export const STOCKROOM_ENTRANCE_START_Z_OFFSET = -17.5;
/** Per-column stagger delay (seconds) for the cascading Matrix shelf arrival. */
export const STOCKROOM_ENTRANCE_COL_STAGGER_SEC = 0.045;

/** Thumbstick horizontal scroll speed (columns per second at full deflection). */
export const STOCKROOM_STICK_SPEED_X = 5.6;
/** Thumbstick vertical scroll speed (rows per second at full deflection). */
export const STOCKROOM_STICK_SPEED_Y = 4.2;
/** Inertial damping decay rate (1/s) after drag-fling or thumbstick release. */
export const STOCKROOM_INERTIA_DAMPING = 6.4;

export type StockroomSide = "left" | "right";

export interface StockroomScrollState {
  scrollCol: number;
  scrollRow: number;
  velCol: number;
  velRow: number;
}

export interface StockroomScrollInput {
  /** Normalized horizontal thumbstick deflection in `[-1, 1]` (+ = pan shelves right/deeper). */
  stickX: number;
  /** Normalized vertical thumbstick deflection in `[-1, 1]` (+ = pan shelves up). */
  stickY: number;
  /** Optional direct impulse added to horizontal velocity (from drag-fling or wheel). */
  impulseCol?: number | undefined;
  /** Optional direct impulse added to vertical velocity (from drag-fling or wheel). */
  impulseRow?: number | undefined;
}

export interface StockroomScrollStepResult {
  next: StockroomScrollState;
  /** True when the integer shelf bay index crossed a column or row boundary (for detent haptics/audio). */
  crossedBay: boolean;
  /** Current integer base column (`Math.floor(scrollCol)`). */
  baseCol: number;
  /** Current integer base row (`Math.floor(scrollRow)`). */
  baseRow: number;
}

export interface StockroomEntranceState {
  /** Additional Z offset (m, negative = deep in corridor distance) approaching 0 as rack locks in. */
  zOffsetMeters: number;
  /** Intensity `[0..1]` of Construct arrival speed-streak highlights. */
  streakIntensity: number;
  /** True once the rack has fully settled into its resting bay. */
  settled: boolean;
}

export interface StockroomSlotPose {
  position: [number, number, number];
  yawRad: number;
  /** Smooth boundary fade scale `[0.001..1]` as slots glide cleanly in and out of the visible corridor. */
  edgeScale: number;
}

/** True mathematical positive modulo (`wrapPositiveMod(-1, 5) === 4`). */
export function wrapPositiveMod(value: number, modulus: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulus) || modulus <= 0) return 0;
  const r = value % modulus;
  return r < 0 ? r + modulus : r;
}

/**
 * Deterministically maps an infinite 2D `(worldCol, worldRow)` shelf coordinate on either
 * the `"left"` or `"right"` corridor wall to a component in `items`.
 *
 * Right wall offsets by `+STOCKROOM_VISIBLE_COLS` so both walls display 30 distinct components
 * immediately and wrap seamlessly forever in all 4 scroll directions.
 */
export function resolveStockroomSlotItem(
  items: readonly GalleryComponentItem[],
  side: StockroomSide,
  worldCol: number,
  worldRow: number,
): GalleryComponentItem | null {
  const count = items.length;
  if (count === 0) return null;
  const rowStride = Math.max(STOCKROOM_VISIBLE_COLS * 2, Math.ceil(count / 4));
  const sideOffset = side === "right" ? STOCKROOM_VISIBLE_COLS : 0;
  const idx = wrapPositiveMod(worldCol + worldRow * rowStride + sideOffset, count);
  return items[idx] ?? items[0] ?? null;
}

/**
 * Evaluates the iconic "Matrix Stockroom" whiz-by arrival curve for a shelf column.
 * Racks stream forward rapidly from deep in the corridor (`-17.5 m`) with staggered per-column
 * timing and quintic ease-out deceleration into a crisp lock-in stop.
 */
export function computeMatrixEntranceState(
  elapsedSec: number,
  colIndex: number,
  durationSec = STOCKROOM_ENTRANCE_DURATION_SEC,
): StockroomEntranceState {
  const safeDuration = Math.max(0.15, durationSec);
  const stagger = Math.max(0, colIndex) * STOCKROOM_ENTRANCE_COL_STAGGER_SEC;
  const localT = (elapsedSec - stagger) / Math.max(0.1, safeDuration - stagger * 0.4);
  if (localT <= 0) {
    return {
      zOffsetMeters: STOCKROOM_ENTRANCE_START_Z_OFFSET,
      streakIntensity: 1,
      settled: false,
    };
  }
  if (localT >= 1) {
    return {
      zOffsetMeters: 0,
      streakIntensity: 0,
      settled: true,
    };
  }
  const inv = 1 - localT;
  // Crisp quintic deceleration: blindingly fast through the corridor, sudden dramatic lock-in
  const easeOut = 1 - inv * inv * inv * inv * inv;
  const zOffsetMeters = STOCKROOM_ENTRANCE_START_Z_OFFSET * (1 - easeOut);
  const streakIntensity = Math.min(1, inv * inv * 1.4);
  return {
    zOffsetMeters,
    streakIntensity,
    settled: false,
  };
}

/**
 * Advances infinite 2D Matrix Stockroom scrolling with responsive thumbstick acceleration,
 * fling impulses, exponential inertial coast, and bay-crossing detent detection.
 */
export function stepStockroomScroll(
  state: StockroomScrollState,
  input: StockroomScrollInput,
  deltaSec: number,
): StockroomScrollStepResult {
  const dt = Math.min(Math.max(deltaSec, 0), 0.1);
  const sx = Number.isFinite(input.stickX) ? Math.max(-1, Math.min(1, input.stickX)) : 0;
  const sy = Number.isFinite(input.stickY) ? Math.max(-1, Math.min(1, input.stickY)) : 0;

  let velCol = state.velCol + (input.impulseCol ?? 0);
  let velRow = state.velRow + (input.impulseRow ?? 0);

  if (Math.abs(sx) > 0.001) {
    const targetVelCol = sx * STOCKROOM_STICK_SPEED_X;
    const blend = 1 - Math.exp(-dt * 14);
    velCol += (targetVelCol - velCol) * blend;
  } else {
    velCol *= Math.exp(-dt * STOCKROOM_INERTIA_DAMPING);
    if (Math.abs(velCol) < 0.015) velCol = 0;
  }

  if (Math.abs(sy) > 0.001) {
    const targetVelRow = sy * STOCKROOM_STICK_SPEED_Y;
    const blend = 1 - Math.exp(-dt * 14);
    velRow += (targetVelRow - velRow) * blend;
  } else {
    velRow *= Math.exp(-dt * STOCKROOM_INERTIA_DAMPING);
    if (Math.abs(velRow) < 0.015) velRow = 0;
  }

  // Clamp peak velocity to keep visual motion legible & comfortable in VR
  velCol = Math.max(-14, Math.min(14, velCol));
  velRow = Math.max(-10, Math.min(10, velRow));

  const nextScrollCol = state.scrollCol + velCol * dt;
  const nextScrollRow = state.scrollRow + velRow * dt;

  const prevBaseCol = Math.floor(state.scrollCol);
  const prevBaseRow = Math.floor(state.scrollRow);
  const baseCol = Math.floor(nextScrollCol);
  const baseRow = Math.floor(nextScrollRow);
  const crossedBay = baseCol !== prevBaseCol || baseRow !== prevBaseRow;

  return {
    next: {
      scrollCol: nextScrollCol,
      scrollRow: nextScrollRow,
      velCol,
      velRow,
    },
    crossedBay,
    baseCol,
    baseRow,
  };
}

/**
 * Computes the local position, inward-facing yaw, and smooth boundary fade scale
 * for one of the 30 visible component bays along the left (`-X`) or right (`+X`)
 * Matrix Stockroom corridors flanking both sides of the engineer.
 */
export function computeStockroomSlotPose(
  side: StockroomSide,
  visibleCol: number,
  visibleRow: number,
  fracCol: number,
  fracRow: number,
  entranceZOffset: number,
): StockroomSlotPose {
  const halfCols = (STOCKROOM_VISIBLE_COLS - 1) * 0.5;
  const halfRows = (STOCKROOM_VISIBLE_ROWS - 1) * 0.5;
  const colPos = visibleCol - halfCols - fracCol;
  const rowPos = visibleRow - halfRows - fracRow;

  const sideSign = side === "left" ? -1 : 1;
  // Slightly toe-in the aisle so far bays curve gently toward the engineer's sightline
  const zLocal = -colPos * STOCKROOM_COL_SPACING;
  const toeInX = -sideSign * Math.sin(STOCKROOM_WALL_TOE_IN_RAD) * zLocal * 0.45;
  const x = sideSign * STOCKROOM_WALL_X + toeInX;
  const y = STOCKROOM_CENTER_Y + rowPos * STOCKROOM_ROW_SPACING;
  const z = STOCKROOM_CENTER_Z + zLocal + entranceZOffset;

  // Face inward across the corridor toward the user (+X for left wall, -X for right wall)
  const yawRad = side === "left" ? Math.PI / 2 - STOCKROOM_WALL_TOE_IN_RAD : -Math.PI / 2 + STOCKROOM_WALL_TOE_IN_RAD;

  // Smooth scale fade at outer aisle edges so infinitely wrapping slots never abruptly pop
  const colMargin = halfCols + 0.55 - Math.abs(colPos);
  const rowMargin = halfRows + 0.55 - Math.abs(rowPos);
  const colFade = Math.max(0.001, Math.min(1, colMargin / 0.52));
  const rowFade = Math.max(0.001, Math.min(1, rowMargin / 0.48));
  const edgeScale = Math.min(colFade, rowFade);

  return {
    position: [x, y, z],
    yawRad,
    edgeScale,
  };
}

/** Sticky magnetic hold duration (seconds) after the pointer leaves a bay so VR trigger jitter never misses. */
export const STOCKROOM_MAGNET_HOLD_SEC = 0.24;
/** Brief dwell time (seconds) before switching magnetic lock directly to an adjacent bay. */
export const STOCKROOM_MAGNET_SWITCH_DWELL_SEC = 0.075;

export interface StockroomMagnetState {
  /** Currently magnetized slot index (`0..29`, or `null` when unlocked). */
  readonly lockedSlotIndex: number | null;
  /** Remaining sticky-hold grace time (seconds) when pointer slips off into a gap. */
  readonly holdRemainingSec: number;
  /** Candidate slot index trying to steal magnetic lock during dwell. */
  readonly pendingSlotIndex: number | null;
  /** Accumulated dwell time on `pendingSlotIndex`. */
  readonly pendingDwellSec: number;
}

export const INITIAL_STOCKROOM_MAGNET_STATE: StockroomMagnetState = {
  lockedSlotIndex: null,
  holdRemainingSec: 0,
  pendingSlotIndex: null,
  pendingDwellSec: 0,
};

/**
 * Magnetic target-lock filter for Matrix Stockroom shelves:
 *  - Latches immediately onto the first hovered bay.
 *  - Holds the magnetic lock for `STOCKROOM_MAGNET_HOLD_SEC` if the ray drifts into
 *    the gap between bays during a trigger pull.
 *  - Requires a short `STOCKROOM_MAGNET_SWITCH_DWELL_SEC` dwell to switch between
 *    adjacent bays, eliminating edge-flutter in VR.
 *  - Returns a `scrollBrake` multiplier (`0.25` for subtle stick tremors while locked,
 *    `1.0` for intentional flicks) so shelves stay rock-steady during grab.
 */
export function stepStockroomMagnetLock(
  state: StockroomMagnetState,
  rawHoveredSlotIndex: number | null,
  dtSec: number,
  stickMagnitude = 0,
): { readonly next: StockroomMagnetState; readonly scrollBrake: number; readonly justLocked: boolean } {
  const dt = Math.max(0, Math.min(0.1, dtSec));

  // Strong intentional thumbstick flick immediately releases magnetic lock so fast scrolling stays snappy
  if (stickMagnitude > 0.52) {
    return {
      next: INITIAL_STOCKROOM_MAGNET_STATE,
      scrollBrake: 1,
      justLocked: false,
    };
  }

  let locked = state.lockedSlotIndex;
  let hold = state.holdRemainingSec;
  let pending = state.pendingSlotIndex;
  let dwell = state.pendingDwellSec;
  let justLocked = false;

  if (rawHoveredSlotIndex !== null) {
    if (locked === null) {
      locked = rawHoveredSlotIndex;
      hold = STOCKROOM_MAGNET_HOLD_SEC;
      pending = null;
      dwell = 0;
      justLocked = true;
    } else if (rawHoveredSlotIndex === locked) {
      hold = STOCKROOM_MAGNET_HOLD_SEC;
      pending = null;
      dwell = 0;
    } else {
      if (pending === rawHoveredSlotIndex) {
        dwell += dt;
      } else {
        pending = rawHoveredSlotIndex;
        dwell = dt;
      }
      if (dwell >= STOCKROOM_MAGNET_SWITCH_DWELL_SEC) {
        locked = rawHoveredSlotIndex;
        hold = STOCKROOM_MAGNET_HOLD_SEC;
        pending = null;
        dwell = 0;
        justLocked = true;
      }
    }
  } else if (locked !== null) {
    pending = null;
    dwell = 0;
    hold = Math.max(0, hold - dt);
    if (hold <= 0) {
      locked = null;
    }
  }

  const scrollBrake = locked !== null && stickMagnitude < 0.42 ? 0.22 : 1;

  return {
    next: {
      lockedSlotIndex: locked,
      holdRemainingSec: hold,
      pendingSlotIndex: pending,
      pendingDwellSec: dwell,
    },
    scrollBrake,
    justLocked,
  };
}
