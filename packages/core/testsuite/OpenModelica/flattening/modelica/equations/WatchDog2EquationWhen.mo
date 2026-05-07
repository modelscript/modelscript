// name:     WatchDog2EquationWhen
// keywords: watchdog equation-when
// status:   correct
//
// <insert description here>
//
// Drmodelica: 13.2 WatchDog System. (p. 435)
//
connector eventPort
  discrete Boolean signal;
end eventPort;

model EventGenerator
  parameter Real eventTime = 1;
  eventPort dOutput;
equation
  dOutput.signal = time > eventTime;
end EventGenerator;

model WatchDog2
   eventPort dOn;
   eventPort dOff;
   eventPort dDeadline;
   eventPort dAlarm;

   Real internalTime1, internalTime2;

equation
   when change(dOn.signal)then
     internalTime1 = time;
   end when;

   when change(dOff.signal)then
     internalTime2 = time;
   end when;

   when change(dDeadline.signal) and time>internalTime1 and internalTime1>internalTime2 then
     dAlarm.signal=true;
   end when;
end WatchDog2;

model WatchDogSystem2
  EventGenerator  turnOn(eventTime=1);
  EventGenerator  turnOff(eventTime=0.25);
  EventGenerator  deadlineEmitter(eventTime=1.5);
  WatchDog2       watchdog;
equation
    connect(turnOn.dOutput,watchdog.dOn);
    connect(turnOff.dOutput,watchdog.dOff);
    connect(deadlineEmitter.dOutput, watchdog.dDeadline);
end WatchDogSystem2;


// Result:
// Error processing file: WatchDog2EquationWhen.mo
// Error: Failed to load package WatchDog2EquationWhen (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WatchDog2EquationWhen not found in scope <top>.
// Error: Error occurred while flattening model WatchDog2EquationWhen
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
