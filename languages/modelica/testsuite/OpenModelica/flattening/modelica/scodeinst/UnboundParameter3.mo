// name: UnboundParameter3
// keywords:
// status: correct
//

model UnboundParameter3
  type T = Real(start = 1.0);
  parameter T x[3];
end UnboundParameter3;

// Result:
// class UnboundParameter3
//   parameter Real x[1](start = 1.0);
//   parameter Real x[2](start = 1.0);
//   parameter Real x[3](start = 1.0);
// end UnboundParameter3;
// endResult
