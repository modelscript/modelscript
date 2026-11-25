<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="SUB_138KV_BAY_SCD" version="2.0" revision="1.0" toolID="Ansatz"/>
  <Substation name="SUB_138KV" desc="138 kV Transmission Bay">
    <VoltageLevel name="VL_138" desc="138 kV Switchyard">
      <Voltage unit="V" multiplier="k">138.0</Voltage>
      <Bay name="BAY_LINE1" desc="Line 1 Feeder Bay">
        <ConductingEquipment name="QA1" type="CBR" desc="SF6 Circuit Breaker">
          <Terminal name="T1" connectivityNode="SUB_138KV/VL_138/BAY_LINE1/CN1"/>
          <Terminal name="T2" connectivityNode="SUB_138KV/VL_138/BAY_LINE1/CN2"/>
          <LNode iedName="BCU_BAY1" lnClass="XCBR" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="QB1" type="DIS" desc="Busbar Disconnector">
          <Terminal name="T1" connectivityNode="SUB_138KV/VL_138/BAY_LINE1/CN1"/>
          <Terminal name="T2" connectivityNode="SUB_138KV/VL_138/BAY_LINE1/BUS1"/>
        </ConductingEquipment>
        <ConnectivityNode name="CN1" pathName="SUB_138KV/VL_138/BAY_LINE1/CN1"/>
        <ConnectivityNode name="CN2" pathName="SUB_138KV/VL_138/BAY_LINE1/CN2"/>
      </Bay>
    </VoltageLevel>
  </Substation>
  <IED name="RELAY_BAY1" desc="Bay Protection Relay" type="REL670" manufacturer="Hitachi">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" lnType="LLN0_Type" inst=""/>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_Type">
            <Inputs>
              <ExtRef iedName="BCU_BAY1" ldInst="CTRL" lnClass="XCBR" doName="Pos"/>
            </Inputs>
          </LN>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>
