// name: InvalidConnectorType6
// keywords:
// status: incorrect
//

model InvalidConnectorType6
  connector C = stream Real;
  connector C2 = flow Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorType6;

// Result:
// Error processing file: InvalidConnectorType6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidConnectorType6.mo:10:3-10:7:writable] Error: Invalid stream connector c1: A stream connector must have exactly one flow variable, this connector has 0 flow variables.
//
// Execution failed!
// endResult
