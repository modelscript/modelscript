// name: ConditionInvalidContext4
// keywords:
// status: incorrect
//

model ConditionInvalidContext4
  Real x if false;
  Real y = x;
end ConditionInvalidContext4;

// Result:
// class ConditionInvalidContext4
//   Real y = x;
// end ConditionInvalidContext4;
// endResult
