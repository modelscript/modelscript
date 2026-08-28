// name: UnboundParameter2
// keywords:
// status: correct
//

model UnboundParameter2
  parameter Real x(start = 1.0);
end UnboundParameter2;

// Result:
// class UnboundParameter2
//   parameter Real x(start = 1.0) = 1.0;
// end UnboundParameter2;
// endResult
