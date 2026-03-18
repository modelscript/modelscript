// status: incorrect

model M

function f
  input Integer i;
  input FuncT func;

  partial function FuncT
    input String s;
  end FuncT;
algorithm
  func(String(i));
end f;

function wrongType
  input Integer i;
  input Integer i2 = 1;
algorithm
  print(String(i) + "\n");
  print(String(i2) + "\n");
end wrongType;

algorithm
  f(1, function wrongType());
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end M;

// Result:
// [flattening/modelica/algorithms-functions/Ticket4786.mo:25:8-25:28] Error: [M3006] In call to 'f': argument 'func' expects type 'FuncT' but got 'wrongType'.
// endResult
