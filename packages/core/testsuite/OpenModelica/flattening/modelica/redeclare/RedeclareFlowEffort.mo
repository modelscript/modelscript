// name:     RedeclareFlowEffort
// keywords: modification
// status:   incorrect
//
// Redeclaration that changes flow/non-flow is not allowed.
//

connector Connector
  flow Real f;
  replaceable Real e;
end Connector;

class RedeclareFlowEffort
  Connector c1, c2(redeclare flow Real e);
equation
  connect(c1, c2);
end RedeclareFlowEffort;
// Result:
// class RedeclareFlowEffort
//   Real c1.f;
//   Real c1.e;
//   Real c2.f;
//   Real c2.e;
// equation
//   c1.e = c2.e;
//   -(c1.f + c2.f) = 0.0;
//   c1.f = 0.0;
//   c2.f = 0.0;
//   c2.e = 0.0;
// end RedeclareFlowEffort;
// [OpenModelica/flattening/modelica/redeclare/RedeclareFlowEffort.mo:14:3-14:42:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/redeclare/RedeclareFlowEffort.mo:16:3-16:18:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/redeclare/RedeclareFlowEffort.mo:14:3-14:42:writable] Warning: Connector c2 is not balanced: The number of potential variables (0) is not equal to the number of flow variables (2).
// endResult
