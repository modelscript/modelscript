// name:     ConstantRedeclareModifier
// keywords: redeclare, modification, constant
// status:   incorrect
//
// Checks that it's not allowed to redeclare a component declared as constant.
//

model m
  replaceable constant Real x;
end m;

model ConstantRedeclareModifier
  extends m(replaceable Real x = 2.0);
end ConstantRedeclareModifier;

// Result:
// class ConstantRedeclareModifier
//   constant Real x = 2.0;
// end ConstantRedeclareModifier;
// endResult
