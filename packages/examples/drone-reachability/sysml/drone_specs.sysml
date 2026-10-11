// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SysML v2 Architecture & Safety Requirement Specification
 *
 * Formal verification contract defining the maximum allowable climb velocity
 * threshold during autopilot ceiling acquisition under turbulent wind disturbances.
 */

package DroneReachabilitySystem {
  import ScalarValues::*;

  // ── Physical Architecture Definition ─────────────────────────────────────
  port def MechanicalFlange;

  part def AvionicsHub {
    attribute mass : Real = 0.45; // [kg]
    port hubMount : MechanicalFlange;
  }

  part def QuadArm {
    attribute length : Real = 180.0; // [mm]
    attribute thickness : Real = 4.2; // [mm]
    attribute mass : Real = 0.1875; // [kg]
    port baseFlange : MechanicalFlange;
    port motorMount : MechanicalFlange;
  }

  part def RotorDuctWinglet {
    attribute chord : Real = 25.0; // [mm]
    attribute frontalArea : Real = 0.0075; // [m²]
  }

  part def DroneAssembly {
    attribute totalMass : Real = 1.20; // [kg]
    attribute totalFrontalArea : Real = 0.030; // [m²]
    attribute aeroDragCoeff : Real = 0.80;

    part hub : AvionicsHub;
    part arms : QuadArm[4];
    part winglets : RotorDuctWinglet[4];
  }

  // ── Formal Verification Requirements ──────────────────────────────────────
  requirement def FlightCeilingRequirement {
    doc /* Drone climb velocity must not exceed structural stability threshold of 12.0 m/s under maximum gust disturbance forces w in [-120, 120] N during climb to 11.0 m. */

    attribute v_climb : Real;
    attribute v_climb_max : Real = 12.0; // [m/s]
    attribute z_target : Real = 11.0; // [m]

    subject drone : DroneAssembly;

    require constraint {
      v_climb <= v_climb_max
    }
  }

  verification def FlightReachabilityVerification {
    doc /* Reachability verification ensuring ceiling climb velocity constraints hold. */
    verify FlightCeilingRequirement;
  }
}
