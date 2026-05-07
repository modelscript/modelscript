// name:     modifyOuter
// keywords: modification inner outer innerouter
// status:   correct
//
//  It is illegal to modify on pure "outer" elements.
//  we only issue a warning now and ignore the modification.
//

connector Pin "Pin of an electrical component"
  flow Real i;
  Real v;
end Pin;

model last
 outer Pin ip(i=3);
 Real x;
 equation
  der(x) = ip.v;
end last;

model mid
 inner outer Pin ip(i=3);
 Real x;
 last la;
 Pin y;
equation
  x = der(x)+ip.v;
  connect(ip,y);
    y.v = 2.4;
end mid;

model inn
 inner Pin ip;
 mid io;
 equation
end inn;

// Result:
// Error processing file: modifyOuter.mo
// [<interactive>:15:2-15:19:writable] Error: Modifier '(i = 3)' found on outer element ip.
// Error: Error occurred while flattening model inn
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
