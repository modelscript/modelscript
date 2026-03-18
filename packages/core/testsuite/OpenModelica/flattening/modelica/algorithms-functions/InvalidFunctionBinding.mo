// name: InvalidFunctionBinding
// keywords: function binding bug1773
// status: incorrect
//
// Checks that a component with an invalid binding causes the instantiation to
// fail.
//

function f
  input Real x;
  output Real y;
protected
  parameter Real z = true;
algorithm
  y := x * z;
end f;

model InvalidFunctionBinding
  Real x = f(4);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end InvalidFunctionBinding;

// Result:
// [flattening/modelica/algorithms-functions/InvalidFunctionBinding.mo:13:22-13:26] Error: [M3001] Type mismatch: 'z' of type 'Real' cannot be assigned from 'true' of type 'Boolean'.
// endResult
