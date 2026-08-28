// name: CevalFuncAssert1
// keywords:
// status: correct
//
//

function f
  input Integer n;
  output Integer res;
algorithm
  assert(n <= 2, "f got n larger than 2", AssertionLevel.warning);
  res := n;
end f;

model CevalFuncAssert1
  constant Real x = f(10);
end CevalFuncAssert1;

// Result:
// class CevalFuncAssert1
//   constant Real x = 10.0;
// end CevalFuncAssert1;
// endResult
