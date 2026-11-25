package CubeSatPowerBudget {
  attribute def Real;

  constraint def PositivePowerMargin {
    attribute solarGenW : Real;
    attribute busLoadW : Real;
    attribute payloadLoadW : Real;
    solarGenW >= busLoadW + payloadLoadW;
  }

  part def ElectricalPowerSubsystem {
    attribute solarArrayPeakW : Real = 42.0;
    attribute batteryCapacityWh : Real = 84.0;
    attribute busVoltageV : Real = 12.0;
  }
}
