// name: BuiltinAttribute9
// keywords:
// status: incorrect
//


model BuiltinAttribute9
  Real x;
  Real y(start = x);
end BuiltinAttribute9;

// Result:
// Error processing file: BuiltinAttribute9.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/BuiltinAttribute9.mo:9:10-9:19:writable] Error: Component start of variability parameter has binding 'x' of higher variability continuous.
//
// Execution failed!
// endResult
