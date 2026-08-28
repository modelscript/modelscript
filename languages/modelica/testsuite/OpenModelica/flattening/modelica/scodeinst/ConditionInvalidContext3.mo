// name: ConditionInvalidContext3
// keywords:
// status: incorrect
//

model A
  Real x;
end A;

model ConditionInvalidContext3
  A a[3] if false;
algorithm
  a[1].x := 1;
end ConditionInvalidContext3;

// Result:
// class ConditionInvalidContext3
// algorithm
//   a[1].x := 1.0;
// end ConditionInvalidContext3;
// endResult
