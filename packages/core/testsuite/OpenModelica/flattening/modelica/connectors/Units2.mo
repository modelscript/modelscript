// name:     Units2
// keywords: connect
// status:   incorrect
//
// Connections of flow variables with non-flow variables are not
// possible.
//

type Voltage = Real(unit = "V");
type Current = Real(unit = "A");


connector Pin1
  Voltage x;
end Pin1;
connector Pin2
  flow Current x;
end Pin2;
model Units2
  Pin1 v;
  Pin2 i;
equation
  connect(v, i);
end Units2;
// Result:
// class Units2
//   Real v.x(unit = "V");
//   Real i.x(unit = "A");
// equation
//   v.x = i.x;
//   i.x = 0.0;
// end Units2;
// [OpenModelica/flattening/modelica/connectors/Units2.mo:20:3-20:9:writable] Warning: Connector v is not balanced: The number of potential variables (1) is not equal to the number of flow variables (0).
// [OpenModelica/flattening/modelica/connectors/Units2.mo:21:3-21:9:writable] Warning: Connector i is not balanced: The number of potential variables (0) is not equal to the number of flow variables (1).
// endResult
