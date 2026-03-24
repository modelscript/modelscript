// name: ExpandableBasic
// keywords: expandable connector
// status: correct

expandable connector Bus
end Bus;

model Source
  output Real speed;
equation
  speed = 1.0;
end Source;

model Sink
  input Real speed;
  Real y;
equation
  y = speed;
end Sink;

model ExpandableBasic
  Bus bus;
  Source source;
  Sink sink;
equation
  connect(source.speed, bus.speed);
  connect(bus.speed, sink.speed);
end ExpandableBasic;

// Result:
// class ExpandableBasic
//   Real bus.speed;
//   Real source.speed;
//   Real sink.speed;
//   Real sink.y;
// equation
//   source.speed = 1.0;
//   sink.y = sink.speed;
//   source.speed = bus.speed;
//   bus.speed = sink.speed;
// end ExpandableBasic;
// endResult
