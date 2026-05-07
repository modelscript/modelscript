// name:     RedeclareModifierInvalid2
// keywords: redeclare, modification, replaceable
// status:   incorrect
//
// Checks that the redeclared class needs to be replaceable.
//

model m
  model m2 end m2;
end m;

model RedeclareModifierInvalid2
  model m3 end m3;
  extends m(redeclare model m2 = m3);
end RedeclareModifierInvalid2;

// Result:
// class RedeclareModifierInvalid2
// end RedeclareModifierInvalid2;
// endResult
