// name:     ConnectFlowEffort
// keywords: connect,modification
// status:   incorrect
//
// Flow and effort variables may not be connected.
//

connector Connector1
  Real e;
end Connector1;

connector Connector2
  flow Real e;
end Connector2;

class ConnectFlowEffort
  Connector1 c1;
  Connector2 c2;
equation
  connect(c1, c2);
end ConnectFlowEffort;

// Result:
// class ConnectFlowEffort
//   Real c1.e;
//   Real c2.e;
// equation
//   c1.e = c2.e;
//   c2.e = 0.0;
// end ConnectFlowEffort;
// [OpenModelica/flattening/modelica/connectors/ConnectFlowEffort.mo:17:3-17:16:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/connectors/ConnectFlowEffort.mo:18:3-18:16:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/connectors/ConnectFlowEffort.mo:20:3-20:18:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/connectors/ConnectFlowEffort.mo:17:3-17:16:writable] Warning: Connector c1 is not balanced: The number of potential variables (1) is not equal to the number of flow variables (0).
// [OpenModelica/flattening/modelica/connectors/ConnectFlowEffort.mo:18:3-18:16:writable] Warning: Connector c2 is not balanced: The number of potential variables (0) is not equal to the number of flow variables (1).
// endResult
