// name:     Annotations
// keywords: declaration annotations comments
// status:   correct
//
// Checks that annotations are output correctly on the flat code when
// +showAnnotations is used.
//

function f "Some comment"
  input Real x "comment";
  output Real y annotation(key = value);
algorithm
  y := x;
  annotation(key = value);
end f;

class c
  Real x "x" annotation(key = value);
equation
  x = f(time);
  annotation(key = value);
end c;

// Result:
// function f "Some comment"
//   input Real x "comment";
//   output Real y;
// algorithm
//   y := x;
// end f;
//
// class c
//   Real x "x";
// equation
//   x = f(time);
// end c;
// [<interactive>:18:3-18:37:writable] Warning: Components are deprecated in class.
// [<interactive>:20:3-20:14:writable] Warning: Equation sections are deprecated in class.
// endResult
