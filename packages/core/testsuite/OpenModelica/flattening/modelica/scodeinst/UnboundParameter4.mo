// name: UnboundParameter4
// keywords:
// status: correct
//

model A
  parameter Real x[3](start = {0, 0, 0});
end A;

model UnboundParameter4
  A a;
end UnboundParameter4;

// Result:
// class UnboundParameter4
//   parameter Real a.x[1](start = 0.0) = 0.0;
//   parameter Real a.x[2](start = 0.0) = 0.0;
//   parameter Real a.x[3](start = 0.0) = 0.0;
// end UnboundParameter4;
// endResult
