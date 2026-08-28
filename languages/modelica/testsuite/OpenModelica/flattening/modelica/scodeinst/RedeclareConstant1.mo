// name: RedeclareConstant1
// keywords:
// status: incorrect
//
// Checks that constants aren't allowed to be redeclared.
// 

model A
  replaceable constant Real x = 1.0;
end A;

model RedeclareConstant1
  A a(redeclare Real x = 2.0);
end RedeclareConstant1;

// Result:
// class RedeclareConstant1
//   constant Real a.x = 2.0;
// end RedeclareConstant1;
// endResult
