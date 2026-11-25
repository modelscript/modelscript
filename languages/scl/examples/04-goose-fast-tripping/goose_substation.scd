<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="GOOSE_TRIP_SCD" version="2.1" revision="1.0" toolID="Ansatz"/>
  <Substation name="METRO_220" desc="220 kV GOOSE Substation">
    <VoltageLevel name="VL_220">
      <Voltage unit="V" multiplier="k">220.0</Voltage>
      <Bay name="BAY_F1">
        <ConductingEquipment name="CB1" type="CBR" desc="Main Breaker">
          <Terminal name="T1" connectivityNode="METRO_220/VL_220/BAY_F1/CN1"/>
          <Terminal name="T2" connectivityNode="METRO_220/VL_220/BAY_F1/CN2"/>
          <LNode iedName="BCU_01" lnClass="XCBR" lnInst="1"/>
        </ConductingEquipment>
        <ConnectivityNode name="CN1" pathName="METRO_220/VL_220/BAY_F1/CN1"/>
        <ConnectivityNode name="CN2" pathName="METRO_220/VL_220/BAY_F1/CN2"/>
      </Bay>
    </VoltageLevel>
  </Substation>
  <Communication>
    <SubNetwork name="STATION_BUS" type="8-MMS">
      <ConnectedAP iedName="PROT_MAIN" apName="AP1">
        <GSE ldInst="PROT" cbName="GC_MAIN_TRIP">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-21</P>
            <P type="APPID">0021</P>
            <P type="VLAN-ID">110</P>
            <P type="VLAN-PRIORITY">4</P>
          </Address>
        </GSE>
      </ConnectedAP>
      <ConnectedAP iedName="BCU_01" apName="AP1">
        <GSE ldInst="CTRL" cbName="GC_CB_POS">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-22</P>
            <P type="APPID">0022</P>
            <P type="VLAN-ID">110</P>
            <P type="VLAN-PRIORITY">4</P>
          </Address>
        </GSE>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="PROT_MAIN" desc="Main Line Distance Protection" type="SEL-421" manufacturer="SEL">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" lnType="LLN0_Type" inst="">
            <DataSet name="DS_TRIP">
              <FCDA ldInst="PROT" lnClass="PTRC" lnInst="1" doName="Tr" daName="general" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_MAIN_TRIP" appID="MAIN_TRIP_220" datSet="DS_TRIP" confRev="1" minTime="2.0" maxTime="1000.0"/>
          </LN0>
          <LN lnClass="PDIS" inst="1" lnType="PDIS_Type"/>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_Type">
            <Inputs>
              <ExtRef iedName="BCU_01" ldInst="CTRL" lnClass="XCBR" doName="Pos"/>
            </Inputs>
          </LN>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>
