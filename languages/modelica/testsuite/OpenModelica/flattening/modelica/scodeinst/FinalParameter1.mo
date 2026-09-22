// name: FinalParameter1
// keywords:
// status: correct
// xfail:    true
//

model FinalParameter1
  final parameter Real x = 3.0;
  Real y = x;
end FinalParameter1;

// Result:
// class FinalParameter1
//   final parameter Real x = 3.0;
//   Real y = x;
// end FinalParameter1;
// endResult
