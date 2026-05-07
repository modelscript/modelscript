// name: ConnectInitial
// keywords:
// status: incorrect
//
// Checks that connect isn't allowed in an initial equation.
//

model ConnectInitial
  connector C
    Real e;
    flow Real f;
  end C;

  C c1, c2;
initial equation
  connect(c1, c2);
end ConnectInitial;

// Result:
// Error processing file: ConnectInitial.mo
// [OpenModelica/flattening/modelica/scodeinst/ConnectInitial.mo:16:3-16:18:writable] Error: Connect equations are not allowed in initial equation sections.
// Error: Failed to load package ConnectInitial (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectInitial not found in scope <top>.
// Error: Error occurred while flattening model ConnectInitial
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
