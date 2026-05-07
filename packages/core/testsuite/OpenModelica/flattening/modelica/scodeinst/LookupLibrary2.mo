// name: LookupLibrary2
// keywords:
// status: incorrect
//
// Tests that missing libraries are not loaded when --loadMissingLibraries=false
//

model LookupLibrary2
  Modelica.Units.SI.Angle angle;
end LookupLibrary2;

// Result:
// class LookupLibrary2
//   Real angle(quantity = "Angle", unit = "rad", displayUnit = "deg");
// end LookupLibrary2;
// Notification: Automatically loaded package Complex 4.1.0 due to uses annotation from Modelica.
// Notification: Automatically loaded package ModelicaServices 4.1.0 due to uses annotation from Modelica.
// Notification: Automatically loaded package Modelica 4.1.0 due to usage.
// endResult
