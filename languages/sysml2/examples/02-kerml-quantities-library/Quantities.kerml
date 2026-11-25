package CoreQuantities {
  abstract attribute def ScalarValue;
  attribute def Real :> ScalarValue;
  attribute def Length :> Real;
  attribute def Mass :> Real;
  attribute def Time :> Real;
  attribute def Temperature :> Real;
  attribute def Velocity :> Real;
  attribute def Force :> Real;
  attribute def Power :> Real;
  attribute def Voltage :> Real;
  attribute def Current :> Real;

  part def PhysicalElement {
    attribute mass : Mass;
    attribute ambientTemp : Temperature;
  }

  part def ElectromechanicalDevice :> PhysicalElement {
    attribute ratedVoltage : Voltage;
    attribute ratedCurrent : Current;
    attribute ratedPower : Power;
  }
}
