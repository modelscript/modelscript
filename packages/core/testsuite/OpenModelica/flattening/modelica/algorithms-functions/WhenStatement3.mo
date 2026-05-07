// name:     WhenStatement3
// keywords: when
// status:   correct
//
//
//

class WhenStat3
  Real x(start = 1);
  Real y1;
  Real y2;
  Real y3;

algorithm
  when x > 2 then
    y1 := sin(x);
  end when;

equation
  y2 = sin(y1);

algorithm
  when x > 2 then
    y3 := 2*x + pre(y1) + y2;
  end when;

equation
  der(x) = 2*x;
end WhenStat3;


// Result:
// Error processing file: WhenStatement3.mo
// Error: Failed to load package WhenStatement3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenStatement3 not found in scope <top>.
// Error: Error occurred while flattening model WhenStatement3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
