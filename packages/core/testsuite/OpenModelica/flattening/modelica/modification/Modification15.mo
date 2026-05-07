// name:     Modification15
// keywords: modification
// status:   incorrect
//
// This tests if a warning or an error is
// displayed when the same attribute is
// modified twice by distict and different modifications.
// This partially works, it ignores x(unit = "K") entirely.
//


class C3
  class C4
    Real x;
  end C4;

  // Ok, different attributes designated (unit, displayUnit and value)
  C4 a(x.unit = "V", x.displayUnit="mV", x=5.0);
  // identical to:
  C4 b(x(unit = "V", displayUnit="mV") = 5.0);
  // Not OK, modifying the same attribute unit
  C4 c(x(unit = "V", displayUnit="mV", unit="J") = 5.0, x(unit = "K"));
end C3;

// Result:
// Error processing file: Modification15.mo
// Error: Failed to load package Modification15 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Modification15 not found in scope <top>.
// Error: Error occurred while flattening model Modification15
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
