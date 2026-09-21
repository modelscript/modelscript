export function generateSparseMatrix(): string {
  return `// --- Sparse Matrix (CSR) Data Structure ---
// Compressed Sparse Row format for high-performance pantelides and bipartite matching
class CSRMatrix {
    public numRows: u32;
    public numCols: u32;
    
    public rowPtrs: u32; // pointer to array of size numRows + 1
    public colIndices: u32; // pointer to array of size NNZ (Number of Non-Zeroes)
    public values: u32; // pointer to array of size NNZ (byte array)
    
    public nnz: u32;
    public capacity: u32;

    constructor(numRows: u32, numCols: u32, initialCapacity: u32 = 1000) {
        this.numRows = numRows;
        this.numCols = numCols;
        this.nnz = 0;
        this.capacity = initialCapacity;
        
        this.rowPtrs = heap.alloc((numRows + 1) * 4) as u32;
        this.colIndices = heap.alloc(initialCapacity * 4) as u32;
        this.values = heap.alloc(initialCapacity) as u32;
        
        for (let i: u32 = 0; i <= numRows; i++) {
            store<u32>(this.rowPtrs + i * 4, 0);
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
        
        store<u32>(this.colIndices + this.nnz * 4, col);
        store<u8>(this.values + this.nnz, value);
        
        // Update row pointers for all subsequent rows until the next insertion
        // Since we insert ordered by row, this is efficient.
        store<u32>(this.rowPtrs + (row + 1) * 4, this.nnz + 1);
        this.nnz++;
    }

    public finalize(): void {
        // Ensure all remaining row pointers are filled
        let lastNnz = load<u32>(this.rowPtrs);
        for (let r: u32 = 0; r <= this.numRows; r++) {
            let ptr = load<u32>(this.rowPtrs + r * 4);
            if (ptr == 0 && r > 0) {
                store<u32>(this.rowPtrs + r * 4, lastNnz);
            } else {
                lastNnz = ptr;
            }
        }
    }

    public get(row: u32, col: u32): u8 {
        let rowStart = load<u32>(this.rowPtrs + row * 4);
        let rowEnd = load<u32>(this.rowPtrs + (row + 1) * 4);
        
        for (let i: u32 = rowStart; i < rowEnd; i++) {
            let c = load<u32>(this.colIndices + i * 4);
            if (c == col) {
                return load<u8>(this.values + i);
            }
        }
        return 0;
    }
}
`;
}
