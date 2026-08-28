// name:     Non-expanded Array 4
// keywords: array
// status:   correct
//
// This is a simple test of non-expanded array handling.
// It tests using expressions of non-constant dimension as attribute values.
//

model Array4
  parameter Integer p;
  Real y[p](start = fill(0.0,p));
  annotation(__OpenModelica_commandLineOptions="+a -d=-newInst");
end Array4;

// Result:
// Error processing file: NonExpArray4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Error occurred while flattening model Array4
//
// Execution failed!
// endResult
