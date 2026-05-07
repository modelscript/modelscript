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
end M;

// Result:
// Error processing file: Ticket4786.mo
// Error: Failed to load package wrongType (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class wrongType not found in scope <top>.
// Error: Error occurred while flattening model wrongType
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
