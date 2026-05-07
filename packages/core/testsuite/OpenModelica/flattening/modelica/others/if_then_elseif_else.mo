// name:     if_then_elseif_else
// keywords: elseif
// status:   correct
//
//  Using elseif in if expressions
//
model ifThenElseIfElse
  Real out1,out2,out3,out4;
equation

  out1 = time;
  out2 = (if time < 1 then time else time^3);
  out3 = (if time < 1 then time else if time < 2 then time^2 else time^3);
  out4 = (if time < 1 then time elseif time < 2 then time^2 elseif time < 3 then time^3 elseif
             time < 4 then time^4 else time^5);
end ifThenElseIfElse;
// Result:
// Error processing file: if_then_elseif_else.mo
// Error: Failed to load package if_then_elseif_else (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class if_then_elseif_else not found in scope <top>.
// Error: Error occurred while flattening model if_then_elseif_else
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
