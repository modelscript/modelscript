// name: type4.mo
// keywords:
// status: incorrect
//

type RealInput = input Real;
type RealOutput = output RealInput;

model A
  RealInput ri;
  RealOutput ro;
end A;

// Result:
// Error processing file: type4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/type4.mo:11:3-11:16:writable] Error: Invalid type prefix 'input' on component ro, due to existing type prefix 'output'.
//
// Execution failed!
// endResult
