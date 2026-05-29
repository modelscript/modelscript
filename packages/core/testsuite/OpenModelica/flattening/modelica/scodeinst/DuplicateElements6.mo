// name: DuplicateElements6
// keywords:
// status: incorrect
//
// Checks that duplicate elements are detected and reported.
//

model A
  model B
    Real x;
  end B;
end A;

model C
  model B
    Real y;
  end B;
end C;

model DuplicateElements6
  extends A;
  extends C;
  B b;
end DuplicateElements6;

// Result:
// class DuplicateElements6
//   Real b.x;
// end DuplicateElements6;
// endResult
