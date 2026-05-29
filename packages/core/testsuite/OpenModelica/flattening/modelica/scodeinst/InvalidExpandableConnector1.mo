// name: InvalidExpandableConnector1
// keywords:
// status: incorrect
//


expandable connector EC
end EC;

connector C
  Real x;
end C;

model InvalidExpandableConnector1
  EC ec;
  C c;
equation
  connect(ec, c);
end InvalidExpandableConnector1;

// Result:
// Error processing file: InvalidExpandableConnector1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidExpandableConnector1.mo:18:3-18:17:writable] Error: Cannot connect expandable connector ec with non-expandable connector c.
//
// Execution failed!
// endResult
