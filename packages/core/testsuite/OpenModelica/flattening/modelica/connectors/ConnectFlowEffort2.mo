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

class ConnectFlowEffort2
  Connector1 c1;
  Connector2 c2;
equation
  connect(c2, c1);
end ConnectFlowEffort2;

// Result:
// class ConnectFlowEffort2
//   Real c1.e;
//   Real c2.e;
// equation
//   -(c2.e + c1.e) = 0.0;
//   c2.e = 0.0;
// end ConnectFlowEffort2;
// [<interactive>:17:3-17:16:writable] Warning: Components are deprecated in class.
// [<interactive>:18:3-18:16:writable] Warning: Components are deprecated in class.
// [<interactive>:20:3-20:18:writable] Warning: Equation sections are deprecated in class.
// [<interactive>:17:3-17:16:writable] Warning: Connector c1 is not balanced: The number of potential variables (1) is not equal to the number of flow variables (0).
// [<interactive>:18:3-18:16:writable] Warning: Connector c2 is not balanced: The number of potential variables (0) is not equal to the number of flow variables (1).
// endResult
