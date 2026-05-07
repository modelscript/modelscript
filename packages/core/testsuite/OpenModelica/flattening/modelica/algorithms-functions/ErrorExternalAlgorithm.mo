// name: ExternalAlgorithm
// status: incorrect

model ExternalAlgorithm
  function a
  algorithm
  end a;
  function b
    extends a;
  external sin();
  end b;
algorithm
   b();
end ExternalAlgorithm;

// Result:
// impure function ExternalAlgorithm.b
//
//
//   external "C" sin();
// end ExternalAlgorithm.b;
//
// class ExternalAlgorithm
// algorithm
//   ExternalAlgorithm.b();
// end ExternalAlgorithm;
// endResult
