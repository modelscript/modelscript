// name:     Non-expanded Array 2
// keywords: array
// status:   correct
//
// This is a simple test of non-expanded array handling
// with array expressions which cannot be ceval-ed because of indefinite dimensions.
//

model Array2
  parameter Integer p;
  Real x[p](start = fill(0.0,p));
  Real y[p] = fill(0.0,p);
  annotation(__OpenModelica_commandLineOptions="+a -d=-newInst");
end Array2;

// Result:
// Error processing file: NonExpArray2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Error occurred while flattening model Array2
//
// Execution failed!
// endResult
