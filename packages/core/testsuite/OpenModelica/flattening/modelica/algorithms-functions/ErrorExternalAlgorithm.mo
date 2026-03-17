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
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ExternalAlgorithm;

// Result:
// [flattening/modelica/algorithms-functions/ErrorExternalAlgorithm.mo:8:12-8:13] Error: [M4006] Element is not allowed in function context: algorithm
// endResult
