// name: SampleError
// status: incorrect

model SampleError
  Real r = 1.5;
  Integer i;
equation
  when sample(r,0.1) then
    i = pre(i)+1;
  end when;
end SampleError;

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
