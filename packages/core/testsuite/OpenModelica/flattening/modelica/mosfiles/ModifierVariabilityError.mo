model ModifierVariabilityErrorParam
  Real x;
  parameter Real y = x;
end ModifierVariabilityErrorParam;

model ModifierVariabilityErrorVar
  Real x;
  Real y(start = x);
end ModifierVariabilityErrorVar;

// Result:
// Error processing file: ModifierVariabilityError.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/ModifierVariabilityError.mo:8:10-8:19:writable] Error: Component start of variability parameter has binding 'x' of higher variability continuous.
//
// Execution failed!
// endResult
