// status: correct
// Enhancement #3096

model DotOperator

  function f
    input Real r;
    output Real x=1,y=2;
  end f;

  function y
    input Real i;
    output Real o = f(i).y;
  end y;

  function x
    input Real i;
    output Real o = f(i).x;
  end x;

  constant Real r1 = y(1.5);
  constant Real r2 = x(1.5);
end DotOperator;
// Result:
// Error processing file: DotOperator.mo
// Error: Failed to load package x (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class x not found in scope <top>.
// Error: Error occurred while flattening model x
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
