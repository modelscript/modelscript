// name: FuncBuiltinChange
// keywords: change
// status: correct
// xfail:    true
//
// Tests the builtin change operator.
//

model FuncBuiltinChange
  Integer x = 1;
  Boolean y = change(x);
  Boolean b = true;
  Boolean z = change(b);
end FuncBuiltinChange;

// Result:
// class FuncBuiltinChange
//   Integer x = 1;
//   Boolean y = change(x);
//   Boolean b = true;
//   Boolean z = change(b);
// end FuncBuiltinChange;
// endResult
