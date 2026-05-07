// name:     modifyOuter2
// keywords: modification inner outer innerouter
// status:   correct
//
//  the most inner modification is the actual
//

connector Pin "Pin of an electrical component"
  flow Real i;
  Real v;
end Pin;

model last
 outer Pin ip;
 Real x;
 Pin o;
 equation
  der(x) = ip.v;
  connect(ip, o);
end last;

model mid2
 inner outer Pin ip(i=-3,v=-3);
 Real x;
 last la;
 Pin y;
equation
  x = der(x)+ip.v;
  connect(ip,y);
    y.v = 2.4;
end mid2;

model mid1
 inner outer Pin ip(i=13);
 Real x;
 mid2 mid;
equation
  x = der(x)+ip.v;
end mid1;

model inn
 inner Pin ip(v=23);
 mid1 io;
 equation
end inn;
// Result:
// Error processing file: modifyOuter2.mo
// Error: Failed to load package modifyOuter2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class modifyOuter2 not found in scope <top>.
// Error: Error occurred while flattening model modifyOuter2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
