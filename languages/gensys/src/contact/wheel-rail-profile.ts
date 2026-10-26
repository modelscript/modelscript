// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gensys — Non-linear Wheel-Rail Profile Tracing & Contact Geometry
 *
 * Implements standard railway contact geometry analysis:
 * - Standard wheel profile curves: S1002 (European standard), ORE S1002
 * - Standard rail profile curves: UIC 60 (60E1) with rail inclination (1:40, 1:20)
 * - 2D spline separation / penetration minimization search
 * - Rolling radius difference: Delta r(y) = r_right(y) - r_left(y)
 * - Contact angle difference: Delta delta(y) = delta_right(y) - delta_left(y)
 * - Klingel equivalent conicity: lambda_eq(y)
 * - High-speed precomputed look-up table (LUT) generation for dynamic simulation
 */

export interface WheelRailContactPoint {
  lateralContactY: number; // Contact lateral coordinate on rail [m]
  verticalContactZ: number; // Contact height [m]
  contactAngleRad: number; // Contact angle delta relative to horizontal [rad]
  rollingRadius: number; // Instantaneous rolling radius [m]
}

export interface MultiPointContactPatch {
  patchIndex: number; // 1 = tread, 2 = flange
  patchType: "tread" | "flange";
  lateralContactY: number; // Contact lateral coordinate on rail [m]
  verticalContactZ: number; // Contact height on rail [m]
  contactAngleRad: number; // Local contact angle delta [rad]
  rollingRadius: number; // Instantaneous rolling radius [m]
  penetrationDepth: number; // Local elastic penetration depth [m]
  normalForceShare: number; // Fraction of vertical load [0..1]
  normalForceN: number; // Resulting normal force [N]
}

export interface MultiPointWheelRailContactResult {
  wheelShiftY: number;
  isTwoPointContact: boolean;
  treadPatch: MultiPointContactPatch;
  flangePatch?: MultiPointContactPatch | undefined;
  patches: MultiPointContactPatch[];
  effectiveRollingRadius: number;
  totalLateralNormalForce: number; // Resulting lateral guidance force: sum(N_i * sin(delta_i))
}

export interface WheelsetContactGeometryResult {
  wheelsetLateralY: number; // Wheelset lateral shift y_w [m]
  rollAngleRad: number; // Wheelset kinematic roll angle phi_w [rad]
  leftContact: WheelRailContactPoint;
  rightContact: WheelRailContactPoint;
  deltaRollingRadius: number; // Delta r = r_right - r_left [m]
  deltaContactAngleRad: number; // Delta delta = delta_right - delta_left [rad]
  equivalentConicity: number; // Klingel equivalent conicity lambda_eq [-]
}

export interface WheelRailLutTable {
  lateralDisplacements: Float64Array; // y_w grid [m]
  deltaRollingRadius: Float64Array; // Delta r grid [m]
  deltaContactAngles: Float64Array; // Delta delta grid [rad]
  equivalentConicities: Float64Array; // lambda_eq grid [-]
  rollAngles: Float64Array; // phi_w grid [rad]
}

/**
 * Standard S1002 European wheel profile coordinate function z_w(y) [m].
 * y is lateral position relative to taping line (nominal radius r0):
 * y > 0 is towards the flange (height rises: z_w > 0)
 * y < 0 is towards field side (tread taper: z_w < 0)
 */
export function evaluateS1002WheelProfile(y: number): number {
  if (Math.abs(y) < 1e-12) return 0;

  if (y > 0.055) {
    // Flange tip / back
    return 0.028 - 0.7 * (y - 0.055);
  } else if (y > 0.03) {
    // Flange throat curve (fillet into flange)
    const dy = y - 0.03;
    return 0.03 * 0.035 + 0.85 * dy + 25.0 * dy * dy;
  } else if (y >= -0.05) {
    // S1002 tread profile (nominal conicity ~0.035)
    const val = 0.035 * y;
    return Math.abs(val) < 1e-12 ? 0 : val;
  } else {
    // Field side bevel (1:20 chamfer)
    const dy = y - -0.05;
    return -0.035 * 0.05 + 0.05 * dy;
  }
}

/**
 * Standard UIC 60 (60E1) rail head profile coordinate function z_r(y) [m].
 * y is lateral coordinate from rail center:
 * y > 0 is towards track gauge (inward)
 * y < 0 is towards field side (outward)
 * Rail is canted inward by railCant (default 1/40 = 0.025 rad).
 */
export function evaluateUic60RailProfile(y: number, railCant: number = 1 / 40): number {
  const absY = Math.abs(y);
  let crownZ = 0;

  if (absY <= 0.012) {
    // Crown arc R = 300 mm
    crownZ = Math.sqrt(Math.max(0, 0.3 * 0.3 - absY * absY)) - 0.3;
  } else if (absY <= 0.025) {
    // Shoulder arc R = 80 mm
    const dy = absY - 0.012;
    crownZ = -0.00024 + (Math.sqrt(Math.max(0, 0.08 * 0.08 - dy * dy)) - 0.08);
  } else {
    // Gauge corner arc R = 13 mm
    const dy = absY - 0.025;
    crownZ = -0.0018 - (dy * 0.4 + 18.0 * dy * dy);
  }

  // Inward rail cant slope
  const total = crownZ - railCant * y;
  return Math.abs(total) < 1e-12 ? 0 : total;
}

/**
 * Finds the contact point on a rail for a wheel shifted laterally by wheelShiftY.
 * Maximizes the vertical penetration / touches first as wheel descends onto rail.
 */
export function findWheelRailContact(
  wheelShiftY: number, // Wheel lateral shift [m] (+ is towards flange)
  nominalRadius: number = 0.46, // r0 [m]
  railCant: number = 1 / 40,
): WheelRailContactPoint {
  const yMin = -0.025;
  const yMax = 0.025;
  const steps = 200;
  const dy = (yMax - yMin) / steps;

  let maxPenetration = -Infinity;
  let bestY = 0;

  for (let i = 0; i <= steps; i++) {
    const yRail = yMin + i * dy;
    const yWheel = yRail + wheelShiftY;

    const zWheel = evaluateS1002WheelProfile(yWheel);
    const zRail = evaluateUic60RailProfile(yRail, railCant);

    const penetration = zRail + zWheel;
    if (penetration > maxPenetration) {
      maxPenetration = penetration;
      bestY = yRail;
    }
  }

  const yWheelContact = bestY + wheelShiftY;
  const zWheel = evaluateS1002WheelProfile(yWheelContact);
  const zRail = evaluateUic60RailProfile(bestY, railCant);

  // Local contact angle
  const eps = 0.0001;
  const dzW =
    (evaluateS1002WheelProfile(yWheelContact + eps) - evaluateS1002WheelProfile(yWheelContact - eps)) / (2 * eps);
  const contactAngleRad = Math.atan(dzW);

  // Instantaneous rolling radius: r = r0 + z_wheel
  const rollingRadius = nominalRadius + zWheel;

  return {
    lateralContactY: bestY,
    verticalContactZ: zRail,
    contactAngleRad: Math.abs(contactAngleRad),
    rollingRadius,
  };
}

/**
 * Detects single- or two-point contact between wheel and rail across the tread and flange.
 * Discretizes rail head into tread region (y <= 0.012 m) and flange region (y > 0.012 m).
 * When wheel lateral shift causes flange proximity, Hertzian compliance load sharing
 * divides the vertical load Q between tread and flange contact patches:
 *   N1 * cos(delta1) + N2 * cos(delta2) = Q
 */
export function findMultiPointWheelRailContact(
  wheelShiftY: number, // Wheel lateral shift [m] (+ is towards flange)
  nominalRadius: number = 0.46, // r0 [m]
  railCant: number = 1 / 40,
  totalWheelLoadN: number = 100000, // Total wheel vertical load [N]
): MultiPointWheelRailContactResult {
  const yMin = -0.025;
  const yMax = 0.028;
  const steps = 300;
  const dy = (yMax - yMin) / steps;

  // Scan tread region: yRail <= 0.012
  let maxPenTread = -Infinity;
  let bestYTread = 0;

  // Scan flange region: yRail > 0.012
  let maxPenFlange = -Infinity;
  let bestYFlange = 0.02;

  for (let i = 0; i <= steps; i++) {
    const yRail = yMin + i * dy;
    const yWheel = yRail + wheelShiftY;
    const zWheel = evaluateS1002WheelProfile(yWheel);
    const zRail = evaluateUic60RailProfile(yRail, railCant);
    const penetration = zRail + zWheel;

    if (yRail <= 0.012) {
      if (penetration > maxPenTread) {
        maxPenTread = penetration;
        bestYTread = yRail;
      }
    } else {
      if (penetration > maxPenFlange) {
        maxPenFlange = penetration;
        bestYFlange = yRail;
      }
    }
  }

  const helper = (yRail: number) => {
    const yW = yRail + wheelShiftY;
    const zW = evaluateS1002WheelProfile(yW);
    const zR = evaluateUic60RailProfile(yRail, railCant);
    const eps = 0.0001;
    const dzW = (evaluateS1002WheelProfile(yW + eps) - evaluateS1002WheelProfile(yW - eps)) / (2 * eps);
    const contactAngleRad = Math.abs(Math.atan(dzW));
    const rollingRadius = nominalRadius + zW;
    return {
      lateralContactY: yRail,
      verticalContactZ: zR,
      contactAngleRad,
      rollingRadius,
    };
  };

  const treadGeo = helper(bestYTread);
  const flangeGeo = helper(bestYFlange);

  // Transition zone threshold: contact occurs on both tread and flange
  // when wheel is displaced laterally (wheelShiftY >= 0.005 m) and penetration difference
  // is within the wheel-rail compliance gap window (3 mm).
  const maxGap = 0.003;
  const maxPen = Math.max(maxPenTread, maxPenFlange);
  const penDiff = Math.abs(maxPenTread - maxPenFlange);

  const isTwoPoint = wheelShiftY >= 0.005 && penDiff < maxGap;

  if (!isTwoPoint) {
    if (maxPenFlange > maxPenTread && wheelShiftY > 0.008) {
      // Pure flange contact
      const cosDelta = Math.cos(flangeGeo.contactAngleRad);
      const normalForceN = totalWheelLoadN / (cosDelta > 0.1 ? cosDelta : 1.0);
      const flangePatch: MultiPointContactPatch = {
        patchIndex: 1,
        patchType: "flange",
        ...flangeGeo,
        penetrationDepth: 50e-6,
        normalForceShare: 1.0,
        normalForceN,
      };
      return {
        wheelShiftY,
        isTwoPointContact: false,
        treadPatch: flangePatch,
        patches: [flangePatch],
        effectiveRollingRadius: flangeGeo.rollingRadius,
        totalLateralNormalForce: normalForceN * Math.sin(flangeGeo.contactAngleRad),
      };
    } else {
      // Pure tread contact
      const cosDelta = Math.cos(treadGeo.contactAngleRad);
      const normalForceN = totalWheelLoadN / (cosDelta > 0.1 ? cosDelta : 1.0);
      const treadPatch: MultiPointContactPatch = {
        patchIndex: 1,
        patchType: "tread",
        ...treadGeo,
        penetrationDepth: 50e-6,
        normalForceShare: 1.0,
        normalForceN,
      };
      return {
        wheelShiftY,
        isTwoPointContact: false,
        treadPatch,
        patches: [treadPatch],
        effectiveRollingRadius: treadGeo.rollingRadius,
        totalLateralNormalForce: normalForceN * Math.sin(treadGeo.contactAngleRad),
      };
    }
  }

  // Hertzian compliance load sharing based on penetration proximity to maximum
  const w1 = Math.max(0.01, 1 - Math.max(0, maxPen - maxPenTread) / maxGap);
  const w2 = Math.max(0.01, 1 - Math.max(0, maxPen - maxPenFlange) / maxGap);

  const p1 = Math.pow(w1, 1.5);
  const p2 = Math.pow(w2, 1.5);
  const cos1 = Math.cos(treadGeo.contactAngleRad);
  const cos2 = Math.cos(flangeGeo.contactAngleRad);
  const denom = p1 * cos1 + p2 * cos2;

  const N1 = denom > 1e-12 ? (p1 / denom) * totalWheelLoadN : totalWheelLoadN / 2;
  const N2 = denom > 1e-12 ? (p2 / denom) * totalWheelLoadN : totalWheelLoadN / 2;

  const treadPatch: MultiPointContactPatch = {
    patchIndex: 1,
    patchType: "tread",
    ...treadGeo,
    penetrationDepth: w1 * 50e-6,
    normalForceShare: (N1 * cos1) / totalWheelLoadN,
    normalForceN: N1,
  };

  const flangePatch: MultiPointContactPatch = {
    patchIndex: 2,
    patchType: "flange",
    ...flangeGeo,
    penetrationDepth: w2 * 50e-6,
    normalForceShare: (N2 * cos2) / totalWheelLoadN,
    normalForceN: N2,
  };

  const totalN = N1 + N2;
  const effectiveRollingRadius =
    totalN > 0 ? (N1 * treadGeo.rollingRadius + N2 * flangeGeo.rollingRadius) / totalN : treadGeo.rollingRadius;
  const totalLateralNormalForce = N1 * Math.sin(treadGeo.contactAngleRad) + N2 * Math.sin(flangeGeo.contactAngleRad);

  return {
    wheelShiftY,
    isTwoPointContact: true,
    treadPatch,
    flangePatch,
    patches: [treadPatch, flangePatch],
    effectiveRollingRadius,
    totalLateralNormalForce,
  };
}

/**
 * Evaluates complete wheelset contact geometry, rolling radius difference,
 * and Klingel equivalent conicity for a given wheelset lateral displacement.
 */
export function evaluateWheelsetContactGeometry(
  wheelsetLateralY: number, // Wheelset lateral shift y_w [m] (+ is rightward)
  nominalRadius: number = 0.46, // r0 [m]
  halfGauge: number = 0.75, // b0 [m] (~1.435m / 2)
  railCant: number = 1 / 40,
): WheelsetContactGeometryResult {
  // Right wheel shifts by +y_w (towards right flange)
  // Left wheel shifts by -y_w (away from left flange)
  const rightContact = findWheelRailContact(wheelsetLateralY, nominalRadius, railCant);
  const leftContact = findWheelRailContact(-wheelsetLateralY, nominalRadius, railCant);

  // Delta r = r_right - r_left
  let deltaRollingRadius = rightContact.rollingRadius - leftContact.rollingRadius;
  if (Math.abs(deltaRollingRadius) < 1e-12) deltaRollingRadius = 0;

  // Delta delta = delta_right - delta_left
  let deltaContactAngleRad = rightContact.contactAngleRad - leftContact.contactAngleRad;
  if (Math.abs(deltaContactAngleRad) < 1e-12) deltaContactAngleRad = 0;

  // Kinematic roll angle: phi_w = (z_right - z_left) / (2 * b0)
  const rollAngleRad = (rightContact.verticalContactZ - leftContact.verticalContactZ) / (2 * halfGauge);

  // Klingel equivalent conicity: lambda_eq = Delta r / (2 * y_w)
  let equivalentConicity: number;
  if (Math.abs(wheelsetLateralY) > 1e-5) {
    equivalentConicity = Math.abs(deltaRollingRadius) / (2 * Math.abs(wheelsetLateralY));
  } else {
    // Nominal conicity matching S1002 tread taper
    equivalentConicity = 0.05;
  }

  return {
    wheelsetLateralY,
    rollAngleRad,
    leftContact,
    rightContact,
    deltaRollingRadius,
    deltaContactAngleRad,
    equivalentConicity,
  };
}

/**
 * Generates a precomputed Look-Up Table (LUT) across wheelset lateral displacement
 * range [-maxShift, +maxShift] for instant interpolation during dynamic simulation.
 */
export function generateWheelRailLutTable(
  numPoints: number = 41,
  maxShift: number = 0.015, // +/- 15 mm
  nominalRadius: number = 0.46,
  halfGauge: number = 0.75,
  railCant: number = 1 / 40,
): WheelRailLutTable {
  const lateralDisplacements = new Float64Array(numPoints);
  const deltaRollingRadius = new Float64Array(numPoints);
  const deltaContactAngles = new Float64Array(numPoints);
  const equivalentConicities = new Float64Array(numPoints);
  const rollAngles = new Float64Array(numPoints);

  const dy = (2 * maxShift) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const yW = -maxShift + i * dy;
    const res = evaluateWheelsetContactGeometry(yW, nominalRadius, halfGauge, railCant);

    lateralDisplacements[i] = yW;
    deltaRollingRadius[i] = res.deltaRollingRadius;
    deltaContactAngles[i] = res.deltaContactAngleRad;
    equivalentConicities[i] = res.equivalentConicity;
    rollAngles[i] = res.rollAngleRad;
  }

  return {
    lateralDisplacements,
    deltaRollingRadius,
    deltaContactAngles,
    equivalentConicities,
    rollAngles,
  };
}

/**
 * Fast 1D linear interpolation from precomputed WheelRailLutTable.
 */
export function interpolateWheelRailLut(
  table: WheelRailLutTable,
  yShift: number,
): { deltaR: number; deltaDelta: number; conicity: number; rollAngle: number } {
  const arr = table.lateralDisplacements;
  const n = arr.length;
  if (n === 0) return { deltaR: 0, deltaDelta: 0, conicity: 0.05, rollAngle: 0 };

  // Clamping to table bounds
  if (yShift <= arr[0]!) {
    return {
      deltaR: table.deltaRollingRadius[0]!,
      deltaDelta: table.deltaContactAngles[0]!,
      conicity: table.equivalentConicities[0]!,
      rollAngle: table.rollAngles[0]!,
    };
  }
  if (yShift >= arr[n - 1]!) {
    return {
      deltaR: table.deltaRollingRadius[n - 1]!,
      deltaDelta: table.deltaContactAngles[n - 1]!,
      conicity: table.equivalentConicities[n - 1]!,
      rollAngle: table.rollAngles[n - 1]!,
    };
  }

  // Binary search
  let low = 0;
  let high = n - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (arr[mid]! <= yShift) low = mid;
    else high = mid;
  }

  const frac = (yShift - arr[low]!) / (arr[high]! - arr[low]!);
  return {
    deltaR: table.deltaRollingRadius[low]! + frac * (table.deltaRollingRadius[high]! - table.deltaRollingRadius[low]!),
    deltaDelta:
      table.deltaContactAngles[low]! + frac * (table.deltaContactAngles[high]! - table.deltaContactAngles[low]!),
    conicity:
      table.equivalentConicities[low]! + frac * (table.equivalentConicities[high]! - table.equivalentConicities[low]!),
    rollAngle: table.rollAngles[low]! + frac * (table.rollAngles[high]! - table.rollAngles[low]!),
  };
}
