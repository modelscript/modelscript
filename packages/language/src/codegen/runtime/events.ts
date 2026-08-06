import { DaeBuilder } from "./dae";
import { evalExpr } from "./eval";

/**
 * Event Detector for zero-crossings (e.g. conditional `when` or `if` state events).
 */
@unmanaged
export class EventDetector {
  dae: DaeBuilder;
  
  init(dae: DaeBuilder): void {
    this.dae = dae;
  }

  /**
   * Checks if any zero-crossing expression changed sign between previous values and current values.
   */
  @inline
  checkZeroCrossing(zcfExprId: u32, prevValuesPtr: u32, currValuesPtr: u32): boolean {
    let prevVal = evalExpr(zcfExprId, this.dae, prevValuesPtr);
    let currVal = evalExpr(zcfExprId, this.dae, currValuesPtr);

    // Zero crossing occurred if sign changed
    return (prevVal <= 0.0 && currVal > 0.0) || (prevVal >= 0.0 && currVal < 0.0);
  }
}
