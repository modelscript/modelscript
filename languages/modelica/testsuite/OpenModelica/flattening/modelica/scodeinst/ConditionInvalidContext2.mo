// name: ConditionInvalidContext2
// keywords:
// status: incorrect
//

model A
  Real x;
end A;

model ConditionInvalidContext2
  A a if false;
equation
  a.x = 1;
end ConditionInvalidContext2;

// Result:
// class ConditionInvalidContext2
// equation
//   a.x = 1.0;
// end ConditionInvalidContext2;
// endResult
