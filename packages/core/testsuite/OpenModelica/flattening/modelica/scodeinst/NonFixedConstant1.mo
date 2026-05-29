// name: NonFixedConstant1
// keywords:
// status: incorrect
//

model NonFixedConstant1
  constant Real x(fixed = false) = 1.0;
end NonFixedConstant1;

// Result:
// Error processing file: NonFixedConstant1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/NonFixedConstant1.mo:7:3-7:39:writable] Error: Constant 'x' must be fixed but has 'fixed = false'
//
// Execution failed!
// endResult
