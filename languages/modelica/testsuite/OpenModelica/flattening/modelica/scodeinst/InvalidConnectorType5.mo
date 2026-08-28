// name: InvalidConnectorType5
// keywords:
// status: incorrect
//

model InvalidConnectorType5
  connector C = flow Real;
  connector C2 = stream Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorType5;

// Result:
// Error processing file: InvalidConnectorType5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidConnectorType5.mo:11:3-11:8:writable] Error: Invalid stream connector c2: A stream connector must have exactly one flow variable, this connector has 0 flow variables.
//
// Execution failed!
// endResult
