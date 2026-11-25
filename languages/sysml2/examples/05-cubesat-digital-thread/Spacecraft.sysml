package CubeSatSpacecraft {
  attribute def Real;

  port def PowerRail {
    attribute voltageV : Real;
    attribute powerW : Real;
  }

  port def DataBus {
    attribute throughputMbps : Real;
  }

  part def SolarEPS {
    attribute massKg : Real = 1.45;
    port railOut : PowerRail;
  }

  part def OnBoardComputer {
    attribute massKg : Real = 0.35;
    port railIn : PowerRail;
    port payloadBus : DataBus;
  }

  part def OpticalPayload {
    attribute massKg : Real = 2.8;
    attribute peakPowerW : Real = 18.0;
    port railIn : PowerRail;
    port dataOut : DataBus;
  }

  part def SixUCubeSat {
    attribute dryMassKg : Real = 8.9;
    part eps : SolarEPS;
    part obc : OnBoardComputer;
    part payload : OpticalPayload;
    connection pwrObc connect eps.railOut to obc.railIn;
    connection pwrPayload connect eps.railOut to payload.railIn;
    connection imgLink connect payload.dataOut to obc.payloadBus;
  }
}
