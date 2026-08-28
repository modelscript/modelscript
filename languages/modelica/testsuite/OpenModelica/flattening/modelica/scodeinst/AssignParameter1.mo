// name: AssignParameter1
// keywords:
// status: incorrect
//

model AssignParameter1
  parameter Real x = 2;
algorithm
  x := 3;
end AssignParameter1;

// Result:
// Error processing file: AssignParameter1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/AssignParameter1.mo:9:3-9:9:writable] Error: Trying to assign to parameter component in x := 3.0
//
// Execution failed!
// endResult
