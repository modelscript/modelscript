// name: FuncBuiltinPre
// keywords: pre
// status: correct
// xfail:    true
//
// Tests the builtin pre operator.
//

model FuncBuiltinPre
  Integer i = 1;
  Real z = pre(i);
end FuncBuiltinPre;

// Result:
// class FuncBuiltinPre
//   Integer i = 1;
//   Real z = /*Real*/(pre(i));
// end FuncBuiltinPre;
// endResult
