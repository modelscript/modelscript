// name:     WhenStatement1
// keywords: when
// status:   correct
//
//
//

class WhenStat
  Real x(start=1);
  Real y1;
  parameter Real y2 = 5;
  Real y3;
algorithm
  when x > 2 then
    y1 := sin(x);
    y3 := 2*x + pre(y1) + y2;
  end when;
equation
  der(x) = 2*x;
end WhenStat;


// Result:
// Error processing file: WhenStatement1.mo
// Error: Failed to load package WhenStatement1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenStatement1 not found in scope <top>.
// Error: Error occurred while flattening model WhenStatement1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
