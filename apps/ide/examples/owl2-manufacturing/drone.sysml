package DroneManufacturing {

  part def DroneAssembly {
    doc /* Complete drone assembly requiring specific materials
           and manufacturing processes. */

    part chassis : Chassis;
    part arm1 : RotorArm;
    part arm2 : RotorArm;
    part arm3 : RotorArm;
    part arm4 : RotorArm;
    part motor1 : BrushlessMotor;
    part motor2 : BrushlessMotor;
    part motor3 : BrushlessMotor;
    part motor4 : BrushlessMotor;
  }

  part def Chassis {
    doc /* Main chassis — requires carbon fiber composite */
    attribute material : String = "CarbonFiber";
    attribute weight : Real = 0.45;
  }

  part def RotorArm {
    doc /* Rotor arm — requires titanium alloy for strength-to-weight */
    attribute material : String = "TitaniumAlloy";
    attribute length : Real = 0.25;
  }

  part def BrushlessMotor {
    doc /* BLDC motor — standard component */
    attribute power : Real = 250.0;
    attribute kv : Real = 920.0;
  }
}
