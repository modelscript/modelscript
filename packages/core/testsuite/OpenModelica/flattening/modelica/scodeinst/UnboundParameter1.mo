// name: UnboundParameter1
// keywords:
// status: incorrect
//

model UnboundParameter1
  parameter Real x;
end UnboundParameter1;

// Result:
// Error processing file: UnboundParameter1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/UnboundParameter1.mo:7:3-7:19:writable] Error: Parameter x has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
