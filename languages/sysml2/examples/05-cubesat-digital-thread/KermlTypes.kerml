package CubeSatKermlTypes {
  abstract attribute def Quantity;
  attribute def Real :> Quantity;
  attribute def MassKg :> Real;
  attribute def PowerW :> Real;
  attribute def AltitudeKm :> Real;
  attribute def DataRateMbps :> Real;
}
