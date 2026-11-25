package EVThermalVerification {
  attribute def Real;

  verification def FastChargeThermalTest {
    attribute chargeRateC : Real = 3.0;
    attribute ambientTempC : Real = 40.0;
    attribute measuredMaxCellTempC : Real = 51.2;
  }

  verification def PumpHeadLossTest {
    attribute measuredFlowLpm : Real = 15.4;
    attribute measuredDropKPa : Real = 54.0;
  }
}
