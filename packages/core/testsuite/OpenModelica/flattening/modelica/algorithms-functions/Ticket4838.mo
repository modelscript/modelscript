// status: correct

model Sum
function s
  input Integer a;
  input Integer i;
  output Integer b;
  algorithm
  if i == 0 then
    b := a;
  else
    b := s(a+1,i-1);
  end if;
end s;
  constant Integer x = s(0,4);
end Sum;

// Result:
// Error processing file: Ticket4838.mo
// Error: Failed to load package s (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class s not found in scope <top>.
// Error: Error occurred while flattening model s
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
