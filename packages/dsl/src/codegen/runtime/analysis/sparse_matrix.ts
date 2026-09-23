// --- Sparse Matrix (CSR) Data Structure ---
// Compressed Sparse Row format for high-performance pantelides and bipartite matching

import { UnmanagedUint32Array, UnmanagedUint8Array } from "../core/array";

export class CSRMatrix {
    public numRows: u32;
    public numCols: u32;
    
    public rowPtrs: u32; // pointer to array of size numRows + 1
    public colIndices: u32; // pointer to array of size NNZ (Number of Non-Zeroes)
    public values: u32; // pointer to array of size NNZ (byte array)
    
    public nnz: u32;
    public capacity: u32;

    @inline get rowPtrsArr(): UnmanagedUint32Array {
        return changetype<UnmanagedUint32Array>(this.rowPtrs);
    }
    @inline get colIndicesArr(): UnmanagedUint32Array {
        return changetype<UnmanagedUint32Array>(this.colIndices);
    }
    @inline get valuesArr(): UnmanagedUint8Array {
        return changetype<UnmanagedUint8Array>(this.values);
    }

    constructor(numRows: u32, numCols: u32, initialCapacity: u32 = 1000) {
        this.numRows = numRows;
        this.numCols = numCols;
        this.nnz = 0;
        this.capacity = initialCapacity;
        
        this.rowPtrs = heap.alloc((numRows + 1) * 4) as u32;
        this.colIndices = heap.alloc(initialCapacity * 4) as u32;
        this.values = heap.alloc(initialCapacity) as u32;
        
        for (let i: u32 = 0; i <= numRows; i++) {
            this.rowPtrsArr[i] = 0;
        }
    }

    public insert(row: u32, col: u32, value: u8): void {
        // Simple append for builder pattern; assumes we insert ordered by row
        if (this.nnz >= this.capacity) {
            let newCap = this.capacity * 2;
            let newCols = heap.alloc(newCap * 4) as u32;
            let newVals = heap.alloc(newCap) as u32;
            
            memory.copy(newCols, this.colIndices, this.nnz * 4);
            memory.copy(newVals, this.values, this.nnz);
            
            this.colIndices = newCols;
            this.values = newVals;
            this.capacity = newCap;
        }
        
        this.colIndicesArr[this.nnz] = col;
        this.valuesArr[this.nnz] = value;
        
        // Update row pointers for all subsequent rows until the next insertion
        // Since we insert ordered by row, this is efficient.
        this.rowPtrsArr[row + 1] = this.nnz + 1;
        this.nnz++;
    }

    public finalize(): void {
        // Ensure all remaining row pointers are filled
        let lastNnz = this.rowPtrsArr[0];
        for (let r: u32 = 0; r <= this.numRows; r++) {
            let ptr = this.rowPtrsArr[r];
            if (ptr == 0 && r > 0) {
                this.rowPtrsArr[r] = lastNnz;
            } else {
                lastNnz = ptr;
            }
        }
    }

    public get(row: u32, col: u32): u8 {
        let rowStart = this.rowPtrsArr[row];
        let rowEnd = this.rowPtrsArr[row + 1];
        
        for (let i: u32 = rowStart; i < rowEnd; i++) {
            let c = this.colIndicesArr[i];
            if (c == col) {
                return this.valuesArr[i];
            }
        }
        return 0;
    }
}
