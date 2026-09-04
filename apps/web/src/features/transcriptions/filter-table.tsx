"use client";

import { useMemo, useState } from "react";

import type { FilterTableStatus } from "./transcription-status";

export type FilterTableRow = {
  id: string;
  primary: string;
  date: string;
  status: FilterTableStatus;
  model?: string | null;
  language?: string | null;
  selected?: boolean;
  onSelect?: () => void;
};

const STATUS = {
  queued: { label: "Queued", className: "bg-secondary text-muted-foreground" },
  active: { label: "In progress", className: "bg-warning/[12%] text-warning" },
  completed: { label: "Completed", className: "bg-success/[12%] text-success" },
  error: { label: "Failed", className: "bg-destructive/[12%] text-destructive" },
} as const;

type Filter = "all" | FilterTableStatus;

/** Ported from Beautiful UI's Filter Table for Transcription history. */
function FilterTable({ rows }: { rows: FilterTableRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filters = useMemo(
    () => [
      { key: "all" as const, label: "All", count: rows.length },
      {
        key: "queued" as const,
        label: "Queued",
        count: rows.filter((row) => row.status === "queued").length,
      },
      {
        key: "active" as const,
        label: "In progress",
        count: rows.filter((row) => row.status === "active").length,
      },
      {
        key: "completed" as const,
        label: "Completed",
        count: rows.filter((row) => row.status === "completed").length,
      },
      {
        key: "error" as const,
        label: "Failed",
        count: rows.filter((row) => row.status === "error").length,
      },
    ],
    [rows],
  );

  const filteredRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => row.status === filter)),
    [filter, rows],
  );

  return (
    <div data-beautiful-ui data-slot="filter-table" className="w-full">
      <div className="-mx-1 mb-1 flex items-center gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
        {filters.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.key)}
              className={`flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,box-shadow,color] duration-200 ease-out ${
                active ? "bg-card text-foreground shadow-btn" : "text-foreground/75 hover:bg-accent"
              }`}
            >
              {item.key !== "all" && (
                <span
                  className={`size-1.5 rounded-full ${
                    item.key === "completed"
                      ? "bg-success"
                      : item.key === "error"
                        ? "bg-destructive"
                        : item.key === "active"
                          ? "bg-warning"
                          : "bg-muted-foreground"
                  }`}
                />
              )}
              {item.label}
              <span
                className={`rounded px-1 text-[10px] tabular-nums ${active ? "bg-secondary text-foreground/75" : "text-muted-foreground"}`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-label="Transcription history"
        className="overflow-x-auto rounded-xl bg-card shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [scrollbar-width:none]"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[600px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[34.177%]" />
            <col className="w-[22.785%]" />
            <col className="w-[20.253%]" />
            <col className="w-[22.785%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-[11px] font-medium text-muted-foreground">
              <th scope="col" className="py-2 pl-3 font-medium">
                Transcription
              </th>
              <th scope="col" className="py-2 font-medium">
                Date
              </th>
              <th scope="col" className="py-2 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Model
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const status = STATUS[row.status];
              const primary = (
                <>
                  {row.primary}
                  {row.language && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      ({row.language})
                    </span>
                  )}
                </>
              );

              return (
                <tr
                  key={row.id}
                  aria-current={row.selected ? "true" : undefined}
                  onClick={row.onSelect}
                  className={`border-b border-border text-xs transition-colors duration-150 last:border-0 ${
                    row.selected
                      ? "bg-muted"
                      : row.onSelect
                        ? "cursor-pointer hover:bg-accent"
                        : "cursor-default"
                  }`}
                >
                  <td className="py-2 pl-3 font-medium text-foreground">
                    {row.onSelect ? (
                      <button
                        type="button"
                        aria-label={`View ${row.primary} transcription from ${row.date}`}
                        aria-pressed={row.selected ?? false}
                        onClick={(event) => {
                          event.stopPropagation();
                          row.onSelect?.();
                        }}
                        className="block w-full truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {primary}
                      </button>
                    ) : (
                      <span className="block truncate">{primary}</span>
                    )}
                  </td>
                  <td className="py-2 tabular-nums text-foreground/75">{row.date}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="truncate py-2 pr-3 font-mono text-[11px] text-foreground/75">
                    {row.model || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { FilterTable };
