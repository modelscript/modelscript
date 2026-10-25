// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export interface DataGridColumn<T> {
  key: keyof T | string;
  header: string;
  width?: string | number | undefined;
  sortable?: boolean | undefined;
  render?: ((item: T, index: number) => React.ReactNode) | undefined;
  editable?: boolean | undefined;
}

export interface EngineeringDataGridProps<T> {
  columns: DataGridColumn<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string | number;
  onCellEdit?: ((item: T, key: string, newValue: string) => void) | undefined;
  dark?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  emptyMessage?: string | undefined;
  pageSize?: number | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

/**
 * EngineeringDataGrid — Reusable, high-performance table component for requirements,
 * elements, and engineering metadata tables across ModelScript IDE panels.
 */
export function EngineeringDataGrid<T extends Record<string, any>>({
  columns,
  data,
  keyExtractor,
  onCellEdit,
  dark = true,
  searchPlaceholder = "Filter records…",
  emptyMessage = "No matching items found.",
  pageSize = 50,
  className,
  style,
}: EngineeringDataGridProps<T>): React.ReactElement {
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const [editingKey, setEditingKey] = useState<{ id: string | number; col: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Search filtering
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((item) => {
      return Object.values(item).some((val) => {
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(q);
      });
    });
  }, [data, search]);

  // Sorting
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal === undefined || aVal === null) return 1;
      if (bVal === undefined || bVal === null) return -1;
      const res = aVal < bVal ? -1 : 1;
      return sortAsc ? res : -res;
    });
  }, [filteredData, sortKey, sortAsc]);

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = page * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: dark ? "#18181b" : "#ffffff",
        color: dark ? "#f4f4f5" : "#18181b",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "12px",
        ...style,
      }}
    >
      {/* Search Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: `1px solid ${dark ? "#27272a" : "#e4e4e7"}`,
          gap: 12,
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          style={{
            flex: 1,
            maxWidth: 320,
            padding: "5px 10px",
            borderRadius: 4,
            border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
            background: dark ? "#27272a" : "#f4f4f5",
            color: "inherit",
            fontSize: "12px",
            outline: "none",
          }}
        />
        <div style={{ opacity: 0.75, fontSize: "11px" }}>
          Showing {paginatedData.length} of {sortedData.length} records
        </div>
      </div>

      {/* Grid Container */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: dark ? "#27272a" : "#f4f4f5",
              zIndex: 10,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
          >
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={String(col.key)}
                    onClick={() => col.sortable !== false && handleSort(String(col.key))}
                    style={{
                      padding: "8px 12px",
                      fontWeight: 600,
                      width: col.width,
                      cursor: col.sortable !== false ? "pointer" : "default",
                      userSelect: "none",
                      borderBottom: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span>{col.header}</span>
                      {isSorted && <span>{sortAsc ? "▲" : "▼"}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((item, rowIdx) => {
                const id = keyExtractor(item, rowIdx);
                const isEven = rowIdx % 2 === 0;
                return (
                  <tr
                    key={String(id)}
                    style={{
                      background: isEven ? "transparent" : dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
                      borderBottom: `1px solid ${dark ? "#27272a" : "#f4f4f5"}`,
                    }}
                  >
                    {columns.map((col) => {
                      const colKey = String(col.key);
                      const isEditing = editingKey?.id === id && editingKey?.col === colKey;
                      const rawVal = item[colKey];

                      if (isEditing) {
                        return (
                          <td key={colKey} style={{ padding: "4px 8px" }}>
                            <input
                              type="text"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => {
                                onCellEdit?.(item, colKey, editValue);
                                setEditingKey(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  onCellEdit?.(item, colKey, editValue);
                                  setEditingKey(null);
                                } else if (e.key === "Escape") {
                                  setEditingKey(null);
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "3px 6px",
                                background: dark ? "#18181b" : "#ffffff",
                                color: "inherit",
                                border: "1px solid #3b82f6",
                                borderRadius: 4,
                                fontSize: "11px",
                              }}
                            />
                          </td>
                        );
                      }

                      return (
                        <td
                          key={colKey}
                          onDoubleClick={() => {
                            if (col.editable && onCellEdit) {
                              setEditingKey({ id, col: colKey });
                              setEditValue(String(rawVal ?? ""));
                            }
                          }}
                          style={{
                            padding: "8px 12px",
                            cursor: col.editable ? "text" : "default",
                          }}
                        >
                          {col.render ? col.render(item, rowIdx) : String(rawVal ?? "")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "6px 12px",
            borderTop: `1px solid ${dark ? "#27272a" : "#e4e4e7"}`,
            gap: 8,
            fontSize: "11px",
          }}
        >
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
              background: "transparent",
              color: "inherit",
              cursor: page === 0 ? "not-allowed" : "pointer",
              opacity: page === 0 ? 0.5 : 1,
            }}
          >
            Prev
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
              background: "transparent",
              color: "inherit",
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              opacity: page >= totalPages - 1 ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
