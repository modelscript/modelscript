// name:     Ticket4276b.mo
// keywords: declaration
// status:   correct
//
// Check that you can assign to parameter(fixed=false)
//


model Ticket4276b
  parameter Real a(fixed=false);
  Real x;
  
  impure function f
    input Real t;
    output Real a;
    output Real b;
  algorithm
    a := t;
    b := t;
  end f;
initial algorithm
  (a, x) := f(2);
equation
  x = 1;
end Ticket4276b;


// Result:
// Error processing file: Ticket4276b.mo
// Error: Class Ticket4276b.mo not found in scope <top>.
// Error: Error occurred while flattening model Ticket4276b.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
