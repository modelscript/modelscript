// name:     Type6
// keywords: type,declaration
// status:   correct
//
// Simple variable declarations, take two.
//

model Type6
  parameter Integer i             "an integer";
  parameter Real r                "a real value";
  parameter String s              "a string";
  parameter Boolean b             "a boolean";
end Type6;

// Result:
// Error processing file: Type6.mo
// [OpenModelica/flattening/modelica/types/Type6.mo:9:3-9:47:writable] Error: Parameter i has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Type6
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
