<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="Substation_Alpha_SCD" version="1" revision="0" toolID="DIgSILENT PowerFactory"/>
  <Substation name="Alpha_Substation" desc="400/110 kV Digital Substation">
    <VoltageLevel name="400kV" nomFreq="50">
      <Voltage unit="V" multiplier="k">400</Voltage>
      <Bay name="Bay_Line1" desc="Overhead Line 1 Bay">
        <ConductingEquipment name="Q0_Breaker" type="CBR">
          <LNode iedName="IED_Prot1" lnClass="XCBR" lnInst="1"/>
          <LNode iedName="IED_Prot1" lnClass="CSWI" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="Q1_Disconnector" type="DIS"/>
        <ConnectivityNode name="CN_Line1"/>
      </Bay>
      <Bay name="Bay_Trafo1" desc="400/110 kV Autotransformer Bay">
        <ConductingEquipment name="T1_AutoTrafo" type="PTR">
          <LNode iedName="IED_Trafo" lnClass="PDIF" lnInst="1"/>
        </ConductingEquipment>
        <ConductingEquipment name="Q0_Trafo_Breaker" type="CBR">
          <LNode iedName="IED_Trafo" lnClass="XCBR" lnInst="1"/>
        </ConductingEquipment>
      </Bay>
    </VoltageLevel>
  </Substation>
  <Communication>
    <SubNetwork name="ProcessBus_Alpha" type="8-MMS">
      <ConnectedAP iedName="IED_Prot1" apName="P1">
        <Address>
          <P type="IP">192.168.1.10</P>
          <P type="IP-SUBNET">255.255.255.0</P>
        </Address>
      </ConnectedAP>
      <ConnectedAP iedName="IED_BreakerCtrl" apName="P1">
        <Address>
          <P type="IP">192.168.1.20</P>
        </Address>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="IED_Prot1" type="LineProtection" manufacturer="Siemens" configVersion="V8.4">
    <AccessPoint name="P1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" inst="">
            <DataSet name="ds_Trip">
              <FCDA ldInst="PROT" lnClass="PTOC" lnInst="1" doName="Op" daName="general" fc="ST"/>
              <FCDA ldInst="PROT" lnClass="PDIS" lnInst="1" doName="Op" daName="general" fc="ST"/>
            </DataSet>
            <GSEControl name="gse_Trip" appID="ALPHA_LINE1_TRIP" datSet="ds_Trip" confRev="1" type="GOOSE"/>
          </LN0>
          <LN lnClass="PTOC" inst="1" prefix="OvrCur"/>
          <LN lnClass="PDIS" inst="1" prefix="Dist"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
  <IED name="IED_BreakerCtrl" type="BayController" manufacturer="ABB" configVersion="V2.1">
    <AccessPoint name="P1">
      <Server>
        <LDevice inst="CTRL">
          <LN lnClass="XCBR" inst="1">
            <Inputs>
              <ExtRef iedName="IED_Prot1" ldInst="PROT" lnClass="PTOC" lnInst="1" doName="Op" daName="general" serviceType="GOOSE"/>
            </Inputs>
          </LN>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>
