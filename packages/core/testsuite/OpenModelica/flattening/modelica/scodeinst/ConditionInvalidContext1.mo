// name: ConditionInvalidContext1
// keywords:
// status: incorrect
//

model ConditionInvalidContext1
  Real x if false;
equation
  x = 1;
end ConditionInvalidContext1;

// Result:
// class ConditionInvalidContext1
// equation
//   x = 1.0;
// end ConditionInvalidContext1;
// endResult
