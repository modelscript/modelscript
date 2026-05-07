// name:     DuplicateRedeclares1
// keywords: redeclare
// status:   incorrect
//
// Checks that the compiler issues an error on duplicate redeclares.
//

model M
  replaceable Real r;
end M;

model DuplicateRedeclares1
  extends M(redeclare replaceable Real r = 1.5);

  redeclare replaceable Real r = 2.5;
end DuplicateRedeclares1;

// Result:
// class DuplicateRedeclares1
//   Real r = 2.5;
// end DuplicateRedeclares1;
// endResult
