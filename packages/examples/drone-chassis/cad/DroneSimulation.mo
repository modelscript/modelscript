model DroneSimulation "Flight dynamics linked to procedural CAD geometry"
  import DroneCAD.*;

  // ── Geometry (compiles to STEP for FEA/CFD) ─────────────────────────
  DroneChassis chassis(
    bodySize = 10,
    bodyHeight = 3,
    armLength = 12
  ) annotation(Shape(export = "drone.step"));

  // ── Derived physical properties from geometry ───────────────────────
  // These parameters are computed FROM the shape dimensions,
  // so when the shape changes, the physics update automatically.

  parameter Real bodyVolume = chassis.body.width
                            * chassis.body.height
                            * chassis.body.depth "Body volume [mm³]";

  parameter Real bodyMass = bodyVolume * 1e-9 * 1600 "Body mass [kg] (carbon fiber)";

  parameter Real armMass = 4 * chassis.armFR.beam.width
                         * chassis.armFR.beam.height
                         * chassis.armFR.beam.depth
                         * 1e-9 * 1600 "4× arm mass [kg]";

  parameter Real totalMass = bodyMass + armMass + 0.5 "Total mass [kg] (+ motors, battery)";

  parameter Real frontalArea = chassis.body.width
                             * chassis.body.height * 1e-6 "Frontal area [m²]";

  // ── Simulation state ────────────────────────────────────────────────
  Real altitude(start = 0) "Altitude [m]";
  Real velocity(start = 0) "Vertical velocity [m/s]";
  parameter Real motorThrust = 5 "Single motor thrust [N]";
  parameter Real Cd = 0.8 "Drag coefficient";
  parameter Real rho = 1.225 "Air density [kg/m³]";

equation
  der(altitude) = velocity;
  der(velocity) = (4 * motorThrust - totalMass * 9.81
                   - 0.5 * Cd * rho * frontalArea * velocity * abs(velocity))
                  / totalMass;

end DroneSimulation;
