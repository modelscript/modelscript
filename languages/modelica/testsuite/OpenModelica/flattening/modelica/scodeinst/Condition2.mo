// name: Condition2
// keywords:
// status: correct
// xfail:    true
//

model Condition2
  Real x if false;
end Condition2;

// Result:
// class Condition2
// end Condition2;
// endResult
