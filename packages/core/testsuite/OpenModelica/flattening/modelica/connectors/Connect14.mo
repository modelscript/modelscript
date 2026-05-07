// name: Connect14
// keywords:  connector, primitive types
// status: correct
//
// Test that all primitive types can be used in connectors.
//
connector BooleanSignal = Boolean;


connector StrangeConnector
  String s;
  Boolean b;
  Integer n;
  Real x;
end StrangeConnector;

model Connect14
  StrangeConnector c1,c2;
  BooleanSignal b2;
equation
  connect(c1,c2);
  connect(c1.b,b2);
end Connect14;
// Result:
// Error processing file: Connect14.mo
// [OpenModelica/flattening/modelica/connectors/Connect14.mo:18:3-18:25:writable] Warning: Connector c1 is not balanced: The number of potential variables (4) is not equal to the number of flow variables (0).
// [OpenModelica/flattening/modelica/connectors/Connect14.mo:18:3-18:25:writable] Warning: Connector c2 is not balanced: The number of potential variables (4) is not equal to the number of flow variables (0).
// [OpenModelica/flattening/modelica/connectors/Connect14.mo:19:3-19:19:writable] Warning: Connector b2 is not balanced: The number of potential variables (1) is not equal to the number of flow variables (0).
// [OpenModelica/flattening/modelica/connectors/Connect14.mo:22:3-22:19:writable] Error: c1.b is not a valid connector.
// Error: Error occurred while flattening model Connect14
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
