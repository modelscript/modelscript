// name: LookupLibrary1
// keywords:
// status: correct
//
// Tests that libraries can be looked up even when not explicitly loaded.
//

model LookupLibrary1
  Modelica.Units.SI.Angle angle;
end LookupLibrary1;

// Result:
// class LookupLibrary1
//   Real angle(quantity = "Angle", unit = "rad", displayUnit = "deg");
// end LookupLibrary1;
// endResult
