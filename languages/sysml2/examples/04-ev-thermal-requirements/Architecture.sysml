package EVThermalArchitecture {
  attribute def Real;

  port def CoolantPort {
    attribute flowRateLpm : Real;
    attribute tempC : Real;
  }

  part def CoolantPump {
    attribute ratedFlowLpm : Real = 16.0;
    attribute powerW : Real = 140.0;
    port inlet : CoolantPort;
    port outlet : CoolantPort;
  }

  part def ColdPlate {
    attribute thermalResistanceKW : Real = 0.015;
    attribute peakCellTempC : Real = 48.5;
    port inlet : CoolantPort;
    port outlet : CoolantPort;
  }

  part def Chiller {
    attribute heatRejectionW : Real = 6500.0;
    port inlet : CoolantPort;
    port outlet : CoolantPort;
  }

  part def ThermalLoop {
    part pump : CoolantPump;
    part plate : ColdPlate;
    part chiller : Chiller;
    connection c1 connect pump.outlet to plate.inlet;
    connection c2 connect plate.outlet to chiller.inlet;
    connection c3 connect chiller.outlet to pump.inlet;
  }
}
