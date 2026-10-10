// name: type5.mo
// keywords:
// status: incorrect
//

type RealInput = input Real;
type RealOutput = output Real;

model A
  RealInput ri;
  input RealOutput ro;
end A;

// Result:
// Error processing file: type5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/type5.mo:11:3-11:22:writable] Error: Invalid type prefix 'output' on component ro, due to existing type prefix 'input'.
//
// Execution failed!
// endResult
