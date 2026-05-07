// name:     FinalRedeclareModifier
// keywords: redeclare, modification, final
// status:   incorrect
//
// Checks that it's not allowed to redeclare a component declared as final.
//

model m
  final replaceable Real x;
end m;

model FinalRedeclareModifier
  extends m(replaceable Real x = 2.0);
end FinalRedeclareModifier;

// Result:
// class FinalRedeclareModifier
//   Real x = 2.0;
// end FinalRedeclareModifier;
// endResult
