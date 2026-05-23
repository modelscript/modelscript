package DroneArchitecture {
  import DroneCAD::*;

  part def DroneAssembly {
    part chassis : Chassis;
    part rotor1 : Rotor;
    part rotor2 : Rotor;
    part rotor3 : Rotor;
    part rotor4 : Rotor;

    // Reference CAD geometry directly from the STEP file!
    // Try selecting these references and see them highlight in the 3D Viewer!
    ref chassisGeometry = DroneCAD::ChassisShape;
  }

  part def Chassis {}
  part def Rotor {}
}
