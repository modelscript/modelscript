// name: CyclicBindingConditional
// keywords: cyclic
// status: incorrect
//
// Tests cyclic binding of parameters
//

model CyclicBindingConditional
  parameter
  Boolean a = true if b;
  parameter
  Boolean b = true if a;
end CyclicBindingConditional;

// Result:
// class SampleError
//   Real r = 1.5;
//   Integer i;
// equation
//   when sample(r, 0.1) then
//     i = pre(i) + 1;
//   end when;
// end SampleError;
// endResult
