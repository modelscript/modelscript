// name: StreamUnbalancedConnector
// keywords: stream connector unbalanced
// status: incorrect
//
// Checks that unbalanced stream connectors generate an error message.
//

connector S
  Real r;
  stream Real s;
end S;

// Result:
// class S
//   Real r;
//   Real s;
// end S;
// endResult
