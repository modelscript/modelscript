<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="DIGITAL_SUB_400KV_SCD" version="3.0" revision="1.0" toolID="Ansatz"/>
  <Substation name="DIGI_SUB_400" desc="400 kV Process Bus Digital Substation">
    <VoltageLevel name="VL_400">
      <Voltage unit="V" multiplier="k">400.0</Voltage>
      <Bay name="BAY_T1">
        <ConductingEquipment name="QA1" type="CBR" desc="400 kV Breaker">
          <Terminal name="T1" connectivityNode="DIGI_SUB_400/VL_400/BAY_T1/CN1"/>
          <Terminal name="T2" connectivityNode="DIGI_SUB_400/VL_400/BAY_T1/CN2"/>
          <LNode iedName="PROT_400" lnClass="PTRC" lnInst="1"/>
        </ConductingEquipment>
        <ConnectivityNode name="CN1" pathName="DIGI_SUB_400/VL_400/BAY_T1/CN1"/>
        <ConnectivityNode name="CN2" pathName="DIGI_SUB_400/VL_400/BAY_T1/CN2"/>
      </Bay>
    </VoltageLevel>
  </Substation>
  <Communication>
    <SubNetwork name="PROCESS_BUS" type="8-MMS">
      <ConnectedAP iedName="PROT_400" apName="AP1">
        <GSE ldInst="PROT" cbName="GC_400_TRIP">
          <Address>
            <P type="MAC-Address">01-0C-CD-01-00-41</P>
            <P type="APPID">0041</P>
            <P type="VLAN-ID">200</P>
            <P type="VLAN-PRIORITY">4</P>
          </Address>
        </GSE>
      </ConnectedAP>
    </SubNetwork>
  </Communication>
  <IED name="PROT_400" desc="400 kV Process Bus Protection IED" type="SIPROTEC-5" manufacturer="Siemens">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="PROT">
          <LN0 lnClass="LLN0" lnType="LLN0_Type" inst="">
            <DataSet name="DS_TRIP_400">
              <FCDA ldInst="PROT" lnClass="PTRC" lnInst="1" doName="Tr" daName="general" fc="ST"/>
            </DataSet>
            <GSEControl name="GC_400_TRIP" appID="DIGI_TRIP_400" datSet="DS_TRIP_400" confRev="1" minTime="2.0" maxTime="1000.0"/>
          </LN0>
          <LN lnClass="PDIF" inst="1" lnType="PDIF_Type">
            <Inputs>
              <ExtRef iedName="MU_BAY1" ldInst="MU" lnClass="TCTR" doName="AmpSv"/>
              <ExtRef iedName="MU_BAY1" ldInst="MU" lnClass="TVTR" doName="VolSv"/>
            </Inputs>
          </LN>
          <LN lnClass="PTRC" inst="1" lnType="PTRC_Type"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>
