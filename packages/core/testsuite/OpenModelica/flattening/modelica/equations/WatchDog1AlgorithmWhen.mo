// name:     WatchDog1AlgorithmWhen
// keywords: watchdog, when
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

model WatchDog1
  eventPort dOn;
  eventPort dOff;
  eventPort dDeadline;
  eventPort dAlarm;
  discrete Boolean watchdogActive(start=false);  // Initially turned off
algorithm
  when change(dOn.signal) then                 // Event watchdog on
    watchdogActive := true;
  end when;

  when change(dOff.signal) then                // Event watchdog off
    watchdogActive := false;
    dAlarm.signal  := false;
  end when;

  when (change(dDeadline.signal) and watchdogActive) then   // Event Alarm!
    dAlarm.signal := true;
  end when;
end WatchDog1;

model WatchDogSystem1
  EventGenerator  turnOn(eventTime = 1);
  EventGenerator  turnOff(eventTime = 0.25);
  EventGenerator  deadlineEmitter(eventTime = 1.5);
  WatchDog1       watchdog;
equation
  connect(turnOn.dOutput,  watchdog.dOn);
  connect(turnOff.dOutput, watchdog.dOff);
  connect(deadlineEmitter.dOutput, watchdog.dDeadline);
end WatchDogSystem1;


// Result:
// Error processing file: WatchDog1AlgorithmWhen.mo
// Error: Failed to load package WatchDog1AlgorithmWhen (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WatchDog1AlgorithmWhen not found in scope <top>.
// Error: Error occurred while flattening model WatchDog1AlgorithmWhen
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
