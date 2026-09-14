export interface MultiBodyAssembly {
  name: string;
  bodies: {
    name: string;
    frameVariable?: string;
    mass: number;
    inertia: {
      I_11: number;
      I_22: number;
      I_33: number;
      I_21: number;
      I_31: number;
      I_32: number;
    };
    r_CM: number[];
    shapeRef?: string;
  }[];
  joints: {
    name: string;
    type: string;
    n: number[];
    partA: string;
    partB: string;
  }[];
  fixedTranslations: {
    name: string;
    r: number[];
    partA: string;
    partB: string;
  }[];
}
export declare function generateMultiBodyModelica(assembly: MultiBodyAssembly, stepUri: string): string;
