"use client";

import { ArrowDown, Clock3, ExternalLink, Radio } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export type RecordsTableRow = {
  id: string;
  title: ReactNode;
  sortTitle: string;
  source?: string | null;
  duration?: string | null;
  durationSeconds?: number | null;
  status: ReactNode;
  actions?: ReactNode;
};

type SortKey = "title" | "source" | "duration";

function HeaderButton({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  icon,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: 1 | -1;
  onSort: (key: SortKey) => void;
  icon: ReactNode;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ArrowDown
        className={`ml-auto size-3 transition-[opacity,transform] duration-150 ${active ? "opacity-100" : "opacity-0"}`}
        style={{ transform: active && direction === -1 ? "rotate(180deg)" : undefined }}
      />
    </button>
  );
}

/** Ported from Beautiful UI's Records Table, generalized for product records. */
function RecordsTable({ rows }: { rows: RecordsTableRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({
    key: "title",
    direction: 1,
  });

  const visibleRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const comparison =
          sort.key === "title"
            ? left.sortTitle.localeCompare(right.sortTitle)
            : sort.key === "source"
              ? (left.source ?? "").localeCompare(right.source ?? "")
              : (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
        return comparison * sort.direction;
      }),
    [rows, sort],
  );

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: (current.direction * -1) as 1 | -1 }
        : { key, direction: 1 },
    );

  return (
    <div
      data-beautiful-ui
      data-slot="records-table"
      className="overflow-hidden rounded-xl bg-card shadow-card"
    >
      <div
        className="max-h-[460px] overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        tabIndex={0}
        role="region"
        aria-label="Video library. Scroll horizontally to view all columns."
      >
        <table className="w-full min-w-[680px] border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-card">
            <tr>
              <th className="sticky left-0 z-30 w-[42%] border-r border-b border-border bg-card">
                <HeaderButton
                  label="Video"
                  sortKey="title"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                  icon={<Radio className="size-3.5" />}
                />
              </th>
              <th className="w-[18%] border-r border-b border-border">
                <HeaderButton
                  label="Source"
                  sortKey="source"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                  icon={<ExternalLink className="size-3.5" />}
                />
              </th>
              <th className="w-[12%] border-r border-b border-border">
                <HeaderButton
                  label="Duration"
                  sortKey="duration"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                  icon={<Clock3 className="size-3.5" />}
                />
              </th>
              <th className="w-[14%] border-r border-b border-border px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                Status
              </th>
              <th className="w-[14%] border-b border-border px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="group">
                <td className="sticky left-0 z-10 border-r border-b border-border bg-card px-3 py-2.5 transition-colors duration-100 group-hover:bg-accent">
                  <div className="min-w-0 font-medium text-foreground">{row.title}</div>
                </td>
                <td className="border-r border-b border-border px-3 py-2.5 text-foreground/75 transition-colors duration-100 group-hover:bg-accent">
                  <span className="block truncate">{row.source || "—"}</span>
                </td>
                <td className="border-r border-b border-border px-3 py-2.5 font-mono tabular-nums text-foreground/75 transition-colors duration-100 group-hover:bg-accent">
                  {row.duration || "—"}
                </td>
                <td className="border-r border-b border-border px-3 py-2.5 transition-colors duration-100 group-hover:bg-accent">
                  {row.status}
                </td>
                <td className="border-b border-border px-2 py-2 text-right transition-colors duration-100 group-hover:bg-accent">
                  <div className="flex items-center justify-end gap-1">{row.actions}</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-mono tabular-nums text-foreground">{rows.length}</span>{" "}
                {rows.length === 1 ? "record" : "records"}
              </td>
              <td colSpan={4} className="px-3 py-2 text-right text-[11px] text-muted-foreground">
                Local library
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export { RecordsTable };
