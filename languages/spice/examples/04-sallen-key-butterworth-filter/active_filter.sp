* 2nd-Order Sallen-Key Butterworth Low-Pass Filter (fc = 10 kHz)
.include lib/opamp_subckt.lib

Vin in 0 DC 0 AC 1
R1 in n1 10k
R2 n1 n2 10k
C1 n1 out 2.25n
C2 n2 0 1.12n

Xop1 n2 out out OPAMP_IDEAL
Rload out 0 10k

.SUBCKT OPAMP_IDEAL inp inm out
Rin inp inm 1Meg
Egain nint 0 inp inm 100k
Rout nint out 50
.ENDS OPAMP_IDEAL

.AC DEC 40 100 1Meg
.END
