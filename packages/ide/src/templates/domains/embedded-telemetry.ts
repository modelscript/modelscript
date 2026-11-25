// SPDX-License-Identifier: AGPL-3.0-or-later

import { STANDARD_CAPABILITIES, type ExampleWorkspaceDescriptor } from "./types.js";

export const EMBEDDED_TELEMETRY_TEMPLATES: ExampleWorkspaceDescriptor[] = [
  // 11. CSV (.csv)
  {
    id: "csv-telemetry",
    languageId: "csv",
    title: "Flight Test Climb Telemetry Dataset",
    summary:
      "Time-series altitude, climb velocity, and motor thrust telemetry for parameter calibration and CombiTimeTable replay.",
    badge: "CSV",
    tone: "emerald",
    ext: ".csv",
    primaryFile: "flight_telemetry.csv",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "flight_telemetry.csv": [
        "time,altitude,velocity,thrust",
        "0.0,0.00,0.00,18.4",
        "0.5,0.62,2.15,17.8",
        "1.0,1.95,3.10,16.2",
        "1.5,3.58,3.41,14.9",
        "2.0,5.24,3.22,13.5",
        "2.5,6.75,2.78,12.4",
        "3.0,7.98,2.14,11.9",
        "3.5,8.89,1.48,11.8",
        "4.0,9.48,0.92,11.7",
        "",
      ].join("\n"),
    },
  },

  // 12. Embedded C (.c)
  {
    id: "c-pid-controller",
    languageId: "c",
    title: "Embedded Flight Autopilot PID Controller",
    summary:
      "MISRA-clean C99 altitude hold controller with anti-windup clamping, symbolic verification, and Modelica external C binding.",
    badge: "C99",
    tone: "sky",
    ext: ".c",
    primaryFile: "pid_controller.c",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "pid_controller.c": [
        "// Embedded Flight Autopilot Altitude Controller",
        "double clamp_cmd(double u, double u_min, double u_max) {",
        "  if (u > u_max) {",
        "    return u_max;",
        "  }",
        "  if (u < u_min) {",
        "    return u_min;",
        "  }",
        "  return u;",
        "}",
        "",
        "double compute_altitude_pid(double z_ref, double z_meas, double v_meas) {",
        "  double kp = 24.0;",
        "  double kv = 44.0;",
        "  double err = z_ref - z_meas;",
        "  double thrust_cmd = kp * err - kv * v_meas;",
        "  return clamp_cmd(thrust_cmd, -120.0, 120.0);",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 13. Modern Fortran (.f90)
  {
    id: "fortran-nozzle",
    languageId: "fortran",
    title: "Supersonic Isentropic Nozzle Flow Kernel",
    summary:
      "Fortran 90 scientific subroutine computing thrust and exit velocity for a converging-diverging rocket nozzle.",
    badge: "F90",
    tone: "indigo",
    ext: ".f90",
    primaryFile: "nozzle_flow.f90",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "nozzle_flow.f90": [
        "subroutine nozzle_thrust(pc, at, cf, p_amb, ae, thrust)",
        "  implicit none",
        "  real(8), intent(in) :: pc, at, cf, p_amb, ae",
        "  real(8), intent(out) :: thrust",
        "  real(8) :: momentum_term, pressure_term",
        "  momentum_term = cf * pc * at",
        "  pressure_term = p_amb * ae",
        "  thrust = momentum_term - pressure_term",
        "end subroutine nozzle_thrust",
        "",
      ].join("\n"),
    },
  },
];
