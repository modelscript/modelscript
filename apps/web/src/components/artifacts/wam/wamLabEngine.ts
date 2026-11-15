// SPDX-License-Identifier: AGPL-3.0-or-later

import { McapReader, Mdf4Reader } from "@modelscript/exchange/telemetry";
import {
  createWamEvalScratch,
  evaluateWamResidual,
  type TrainedWamResidual,
  type WamTrainingDataset,
} from "@modelscript/simulate/wam";
import type { UrdfRobot, UrdfTrajectoryData } from "@modelscript/urdf";
import { computeForwardDynamicsAba } from "@modelscript/urdf/kinematics";
import { parseUrdf } from "@modelscript/urdf/parser";

export const DEFAULT_2DOF_ARM_URDF = `<?xml version="1.0"?>
<robot name="planar_2dof_arm">
  <link name="base_link">
    <inertial>
      <mass value="2.0"/>
      <inertia ixx="0.05" iyy="0.05" izz="0.05" ixy="0" ixz="0" iyz="0"/>
    </inertial>
    <visual>
      <geometry><cylinder radius="0.12" length="0.16"/></geometry>
    </visual>
  </link>
  <link name="upper_arm">
    <inertial>
      <origin xyz="0.25 0 0" rpy="0 0 0"/>
      <mass value="1.5"/>
      <inertia ixx="0.02" iyy="0.08" izz="0.08" ixy="0" ixz="0" iyz="0"/>
    </inertial>
    <visual>
      <origin xyz="0.25 0 0" rpy="0 1.5708 0"/>
      <geometry><cylinder radius="0.045" length="0.5"/></geometry>
    </visual>
  </link>
  <link name="forearm">
    <inertial>
      <origin xyz="0.22 0 0" rpy="0 0 0"/>
      <mass value="1.1"/>
      <inertia ixx="0.015" iyy="0.05" izz="0.05" ixy="0" ixz="0" iyz="0"/>
    </inertial>
    <visual>
      <origin xyz="0.22 0 0" rpy="0 1.5708 0"/>
      <geometry><cylinder radius="0.038" length="0.44"/></geometry>
    </visual>
  </link>
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link"/>
    <child link="upper_arm"/>
    <origin xyz="0 0 0.12" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="40" velocity="6"/>
  </joint>
  <joint name="elbow_joint" type="revolute">
    <parent link="upper_arm"/>
    <child link="forearm"/>
    <origin xyz="0.5 0 0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="30" velocity="6"/>
  </joint>
</robot>`;

export interface RobotSimOutput {
  trajectory: UrdfTrajectoryData;
  reference: Record<string, number[]>;
  trackingRmse: number;
}

function unmodeledTorque(q: number[], dq: number[], u: number[]): number[] {
  return q.map((qi, idx) => {
    const dqi = dq[idx] ?? 0;
    const ui = u[idx] ?? 0;
    // Unmodeled Stribeck friction + payload gravity mismatch + slight actuator nonlinearity
    return 1.35 * Math.tanh(5.0 * dqi) + 0.85 * Math.sin(qi + 0.3 * idx) + 0.08 * ui;
  });
}

function finiteDifferenceSeries(values: number[], times: number[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const dt = (times[i1] ?? 0) - (times[i0] ?? 0);
    out[i] = Math.abs(dt) > 1e-9 ? ((values[i1] ?? 0) - (values[i0] ?? 0)) / dt : 0;
  }
  return out;
}

/**
 * Generates a synthetic real-world trajectory dataset with unmodeled friction and payload mismatch
 * so the user can train the WAM residual immediately in the browser.
 */
export function generateDemoWamDataset(robot: UrdfRobot): WamTrainingDataset {
  const jointNames = Array.from(robot.joints.values())
    .filter((j) => j.type === "revolute" || j.type === "continuous" || j.type === "prismatic")
    .map((j) => j.name);

  const nJ = Math.max(1, jointNames.length);
  const nSamples = 120;
  const times: number[] = [];
  const q: number[][] = [];
  const dq: number[][] = [];
  const u: number[][] = [];
  const tauResidual: number[][] = [];

  for (let i = 0; i < nSamples; i++) {
    const t = (i / (nSamples - 1)) * 6.0;
    const qi: number[] = [];
    const dqi: number[] = [];
    const ui: number[] = [];
    for (let j = 0; j < nJ; j++) {
      const freq = 1.1 + 0.35 * j;
      const amp = 0.75 - 0.1 * j;
      const pos = amp * Math.sin(freq * t + 0.4 * j);
      const vel = amp * freq * Math.cos(freq * t + 0.4 * j);
      qi.push(pos);
      dqi.push(vel);
      ui.push(3.2 * Math.sin(0.9 * t + j));
    }
    times.push(t);
    q.push(qi);
    dq.push(dqi);
    u.push(ui);
    tauResidual.push(unmodeledTorque(qi, dqi, ui));
  }

  return { times, jointNames, q, dq, u, tauResidual };
}

function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Parses a CSV with header-aware column mapping (or positional fallback: t, q_*, dq_*, u_*, tau_res_*).
 */
export function parseWamCsvDataset(csvText: string, jointNames: string[]): WamTrainingDataset {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const nJ = Math.max(1, jointNames.length);
  const headers = splitCsvRow(lines[0]!).map((h) => h.toLowerCase());
  const headerIdx = new Map<string, number>();
  headers.forEach((h, i) => headerIdx.set(h, i));

  const findCol = (candidates: string[]): number | undefined => {
    for (const c of candidates) {
      const idx = headerIdx.get(c.toLowerCase());
      if (idx !== undefined) return idx;
    }
    return undefined;
  };

  const tCol = findCol(["t", "time", "timestamp"]);
  const qColsIdx = jointNames.map((jn, j) => findCol([`q_${jn}`, `${jn}.phi`, `${jn}.s`, `q_${j}`, `q${j}`]));
  const dqColsIdx = jointNames.map((jn, j) => findCol([`dq_${jn}`, `${jn}.w`, `${jn}.v`, `dq_${j}`, `dq${j}`]));
  const uColsIdx = jointNames.map((jn, j) => findCol([`u_${jn}`, `tau_ctrl_${jn}`, `u_${j}`, `u${j}`]));
  const resColsIdx = jointNames.map((jn, j) =>
    findCol([`tau_res_${jn}`, `tau_residual_${jn}`, `tau_res_${j}`, `res_${j}`]),
  );

  const hasNamedColumns = tCol !== undefined && qColsIdx.some((c) => c !== undefined);

  const times: number[] = [];
  const q: number[][] = [];
  const dq: number[][] = [];
  const u: number[][] = [];
  const tauResidual: number[][] = [];
  let missingDq = false;

  for (let r = 1; r < lines.length; r++) {
    const rawFields = splitCsvRow(lines[r]!);
    const cols = rawFields.map(Number);

    if (hasNamedColumns) {
      const tVal = cols[tCol!]!;
      if (!Number.isFinite(tVal)) continue;
      times.push(tVal);
      q.push(qColsIdx.map((ci) => (ci !== undefined && Number.isFinite(cols[ci]) ? cols[ci]! : 0)));
      if (dqColsIdx.some((ci) => ci !== undefined)) {
        dq.push(dqColsIdx.map((ci) => (ci !== undefined && Number.isFinite(cols[ci]) ? cols[ci]! : 0)));
      } else {
        missingDq = true;
        dq.push(new Array<number>(nJ).fill(0));
      }
      u.push(uColsIdx.map((ci) => (ci !== undefined && Number.isFinite(cols[ci]) ? cols[ci]! : 0)));
      tauResidual.push(resColsIdx.map((ci) => (ci !== undefined && Number.isFinite(cols[ci]) ? cols[ci]! : 0)));
    } else {
      if (cols.some((v) => Number.isNaN(v)) || cols.length < 1 + 4 * nJ) {
        continue;
      }
      times.push(cols[0]!);
      q.push(cols.slice(1, 1 + nJ));
      dq.push(cols.slice(1 + nJ, 1 + 2 * nJ));
      u.push(cols.slice(1 + 2 * nJ, 1 + 3 * nJ));
      tauResidual.push(cols.slice(1 + 3 * nJ, 1 + 4 * nJ));
    }
  }

  if (times.length === 0) {
    throw new Error(`No valid numeric rows found in CSV.`);
  }

  if (missingDq) {
    for (let j = 0; j < nJ; j++) {
      const qCol = q.map((row) => row[j]!);
      const dqCol = finiteDifferenceSeries(qCol, times);
      for (let i = 0; i < times.length; i++) {
        dq[i]![j] = dqCol[i]!;
      }
    }
  }

  return { times, jointNames, q, dq, u, tauResidual };
}

interface NamedSeries {
  name: string;
  timestamps: Float64Array;
  values: Float64Array;
}

function normalizeAndSortSeries(series: NamedSeries): NamedSeries {
  const n = series.timestamps.length;
  let sorted = true;
  for (let i = 1; i < n; i++) {
    if (series.timestamps[i]! < series.timestamps[i - 1]!) {
      sorted = false;
      break;
    }
  }
  if (sorted) return series;

  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => series.timestamps[a]! - series.timestamps[b]!);
  const tOut = new Float64Array(n);
  const vOut = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tOut[i] = series.timestamps[indices[i]!]!;
    vOut[i] = series.values[indices[i]!]!;
  }
  return { name: series.name, timestamps: tOut, values: vOut };
}

function interpolateSeriesAt(series: NamedSeries, targetTimes: number[]): number[] {
  const { timestamps, values } = normalizeAndSortSeries(series);
  const n = timestamps.length;
  if (n === 0) return targetTimes.map(() => 0);
  if (n === 1) return targetTimes.map(() => values[0]!);

  const out = new Array<number>(targetTimes.length);
  let idx = 0;
  for (let i = 0; i < targetTimes.length; i++) {
    const t = targetTimes[i]!;
    while (idx + 1 < n - 1 && timestamps[idx + 1]! < t) {
      idx++;
    }
    const t0 = timestamps[idx]!;
    const t1 = timestamps[idx + 1]!;
    const v0 = values[idx]!;
    const v1 = values[idx + 1]!;
    if (t <= t0) out[i] = v0;
    else if (t >= t1) out[i] = v1;
    else {
      const alpha = (t - t0) / Math.max(1e-12, t1 - t0);
      out[i] = v0 + alpha * (v1 - v0);
    }
  }
  return out;
}

function findMatchingSeries(seriesList: NamedSeries[], candidates: string[]): NamedSeries | undefined {
  const lowerMap = new Map<string, NamedSeries>();
  for (const s of seriesList) {
    lowerMap.set(s.name.toLowerCase(), s);
  }
  for (const cand of candidates) {
    const exact = lowerMap.get(cand.toLowerCase());
    if (exact) return exact;
  }
  // Delimiter-bounded suffix match (e.g. "/robot/q_j1" matches "q_j1", never "q_j10")
  for (const cand of candidates) {
    const lc = cand.toLowerCase();
    const match = seriesList.find((s) => {
      const sl = s.name.toLowerCase();
      if (sl === lc) return true;
      return sl.endsWith(`/${lc}`) || sl.endsWith(`.${lc}`) || sl.endsWith(`:${lc}`);
    });
    if (match) return match;
  }
  return undefined;
}

/**
 * Parses a ROS 2 MCAP (.mcap) or ASAM MDF4 (.mf4/.mdf4/.mdf) binary telemetry log
 * into a WamTrainingDataset by matching joint position, velocity, control, and residual channels.
 */
export function parseTelemetryLogToWamDataset(
  buffer: ArrayBuffer,
  fileName: string,
  jointNames: string[],
): WamTrainingDataset {
  const lower = fileName.toLowerCase();
  let seriesList: NamedSeries[] = [];

  if (lower.endsWith(".mcap")) {
    const reader = new McapReader(buffer);
    seriesList = reader.extractAllSeries().map((s) => ({
      name: s.topic,
      timestamps: s.timestamps,
      values: s.values,
    }));
  } else if (lower.endsWith(".mf4") || lower.endsWith(".mdf4") || lower.endsWith(".mdf")) {
    const reader = new Mdf4Reader(buffer);
    seriesList = reader
      .extractAllChannels()
      .filter((s) => !s.isMasterTime)
      .map((s) => ({
        name: s.name,
        timestamps: s.timestamps,
        values: s.values,
      }));
  } else {
    throw new Error(`Unsupported binary telemetry format: ${fileName}`);
  }

  if (seriesList.length === 0) {
    throw new Error(`No numeric telemetry channels found in ${fileName}.`);
  }

  const nJ = Math.max(1, jointNames.length);
  const qSeries: (NamedSeries | undefined)[] = [];
  const dqSeries: (NamedSeries | undefined)[] = [];
  const uSeries: (NamedSeries | undefined)[] = [];
  const resSeries: (NamedSeries | undefined)[] = [];
  const tauActualSeries: (NamedSeries | undefined)[] = [];
  const tauModelSeries: (NamedSeries | undefined)[] = [];

  for (let j = 0; j < nJ; j++) {
    const jn = jointNames[j]!;
    qSeries.push(
      findMatchingSeries(seriesList, [
        `q_${jn}`,
        `${jn}.phi`,
        `${jn}.s`,
        `${jn}/position`,
        `joint_states.${jn}.position`,
        `q_${j}`,
      ]),
    );
    dqSeries.push(
      findMatchingSeries(seriesList, [
        `dq_${jn}`,
        `${jn}.w`,
        `${jn}.v`,
        `${jn}/velocity`,
        `joint_states.${jn}.velocity`,
        `dq_${j}`,
      ]),
    );
    uSeries.push(findMatchingSeries(seriesList, [`u_${jn}`, `tau_ctrl_${jn}`, `${jn}/effort_cmd`, `u_${j}`]));
    resSeries.push(findMatchingSeries(seriesList, [`tau_res_${jn}`, `tau_residual_${jn}`, `tau_res_${j}`]));
    tauActualSeries.push(findMatchingSeries(seriesList, [`tau_actual_${jn}`, `${jn}/effort`, `tau_meas_${jn}`]));
    tauModelSeries.push(findMatchingSeries(seriesList, [`tau_modelica_${jn}`, `tau_nom_${jn}`]));
  }

  const primary = normalizeAndSortSeries(qSeries.find(Boolean) ?? seriesList[0]!);
  const times = Array.from(primary.timestamps);
  if (times.length === 0) {
    throw new Error(`Telemetry channel "${primary.name}" in ${fileName} has 0 samples.`);
  }

  const qCols = qSeries.map((s) => (s ? interpolateSeriesAt(s, times) : times.map(() => 0)));
  // Differentiate q(t) when dq channels are omitted
  const dqCols = dqSeries.map((s, j) =>
    s ? interpolateSeriesAt(s, times) : qSeries[j] ? finiteDifferenceSeries(qCols[j]!, times) : times.map(() => 0),
  );
  const uCols = uSeries.map((s) => (s ? interpolateSeriesAt(s, times) : times.map(() => 0)));
  const resCols = resSeries.map((s, j) => {
    if (s) return interpolateSeriesAt(s, times);
    const act = tauActualSeries[j];
    const mod = tauModelSeries[j];
    if (act && mod) {
      const aVals = interpolateSeriesAt(act, times);
      const mVals = interpolateSeriesAt(mod, times);
      return aVals.map((v, i) => v - mVals[i]!);
    }
    return times.map(() => 0);
  });

  if (!qSeries.some(Boolean) && !resSeries.some(Boolean)) {
    const found = seriesList
      .slice(0, 8)
      .map((s) => s.name)
      .join(", ");
    throw new Error(`Could not match joint channels (${jointNames.join(", ")}) in ${fileName}. Found: ${found}`);
  }

  const q: number[][] = times.map((_, i) => qCols.map((col) => col[i]!));
  const dq: number[][] = times.map((_, i) => dqCols.map((col) => col[i]!));
  const u: number[][] = times.map((_, i) => uCols.map((col) => col[i]!));
  const tauResidual: number[][] = times.map((_, i) => resCols.map((col) => col[i]!));

  return { times, jointNames, q, dq, u, tauResidual };
}

/**
 * Simulates closed-loop PD + optional WAM feedforward control using Featherstone's
 * Articulated Body Algorithm (computeForwardDynamicsAba) on the URDF multibody tree.
 */
export function simulateClosedLoopRobot(
  robotOrUrdf: UrdfRobot | string,
  trainedWam: TrainedWamResidual | null,
  duration = 6.0,
  dt = 0.02,
): RobotSimOutput {
  const robot = typeof robotOrUrdf === "string" ? parseUrdf(robotOrUrdf) : robotOrUrdf;
  const actuatedJoints = Array.from(robot.joints.values()).filter(
    (j) => j.type === "revolute" || j.type === "continuous" || j.type === "prismatic",
  );
  const jointNames = actuatedJoints.map((j) => j.name);
  const nJ = jointNames.length;
  const steps = Math.floor(duration / dt) + 1;
  const times: number[] = new Array(steps);
  const jointSeries: Record<string, number[]> = {};
  const reference: Record<string, number[]> = {};

  for (const name of jointNames) {
    jointSeries[name] = new Array(steps);
    reference[name] = new Array(steps);
  }
  if (nJ === 0) {
    for (let s = 0; s < steps; s++) times[s] = s * dt;
    return { trajectory: { times, jointPositions: jointSeries }, reference, trackingRmse: 0 };
  }

  const q = new Array<number>(nJ).fill(0);
  const dq = new Array<number>(nJ).fill(0);
  const qMap = new Map<string, number>();
  const dqMap = new Map<string, number>();
  const tauMap = new Map<string, number>();

  const kp = 22.0;
  const kd = 5.5;
  const wamCompatible = trainedWam !== null && trainedWam.jointNames.length === nJ && trainedWam.outputDim === nJ;
  const wamScratch = wamCompatible ? createWamEvalScratch(trainedWam!) : undefined;

  let sqErrSum = 0;
  const uCtrl = new Array<number>(nJ);

  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    times[s] = t;

    for (let j = 0; j < nJ; j++) {
      const joint = actuatedJoints[j]!;
      const lo = joint.limits?.lower;
      const hi = joint.limits?.upper;
      const maxAmp =
        lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi)
          ? Math.min(0.7, Math.max(0.1, Math.min(Math.abs(lo), Math.abs(hi)) * 0.8))
          : 0.7;
      const ref = maxAmp * Math.sin(1.4 * t + 0.6 * j);
      uCtrl[j] = kp * (ref - q[j]!) - kd * dq[j]!;
      jointSeries[joint.name]![s] = q[j]!;
      reference[joint.name]![s] = ref;
      const err = ref - q[j]!;
      sqErrSum += err * err;

      qMap.set(joint.name, q[j]!);
      dqMap.set(joint.name, dq[j]!);
    }

    const wamComp = wamCompatible && wamScratch ? evaluateWamResidual(trainedWam!, q, dq, uCtrl, wamScratch) : null;
    const disturbance = unmodeledTorque(q, dq, uCtrl);

    for (let j = 0; j < nJ; j++) {
      const joint = actuatedJoints[j]!;
      const effortLimit = joint.limits?.effort && joint.limits.effort > 0 ? joint.limits.effort : 50.0;
      const applied = Math.max(-effortLimit, Math.min(effortLimit, uCtrl[j]! + (wamComp ? (wamComp[j] ?? 0) : 0)));
      tauMap.set(joint.name, applied - disturbance[j]! - 0.15 * dq[j]!);
    }

    const { jointAccelerations } = computeForwardDynamicsAba(robot, qMap, dqMap, tauMap, 9.80665);

    for (let j = 0; j < nJ; j++) {
      const joint = actuatedJoints[j]!;
      const ddq = jointAccelerations.get(joint.name) ?? 0;
      dq[j]! += ddq * dt;
      q[j]! += dq[j]! * dt;

      if (joint.limits && joint.type !== "continuous") {
        if (joint.limits.lower !== undefined && q[j]! < joint.limits.lower) {
          q[j] = joint.limits.lower;
          if (dq[j]! < 0) dq[j] = 0;
        } else if (joint.limits.upper !== undefined && q[j]! > joint.limits.upper) {
          q[j] = joint.limits.upper;
          if (dq[j]! > 0) dq[j] = 0;
        }
      }
    }
  }

  const trackingRmse = Math.sqrt(sqErrSum / (steps * nJ));
  return {
    trajectory: { times, jointPositions: jointSeries },
    reference,
    trackingRmse,
  };
}
