// status: correct
// bug #2529

model Vectorizable7
  function f
    input Integer m;
    output Real y;
  protected
    parameter Real phi[m] = linspace(0,1,m);
    parameter Real t[m] = cos(phi);
  algorithm
    y := sum(t);
  end f;

  Real r = f(integer(time));
end Vectorizable7;

// Result:
// Error processing file: Vectorizable7.mo
// Error: Failed to load package f (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class f not found in scope <top>.
// Error: Error occurred while flattening model f
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
