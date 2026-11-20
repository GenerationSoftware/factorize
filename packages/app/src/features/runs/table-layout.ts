/**
 * Shared sizing envelope for the run tables. These widths include the cell
 * padding supplied by tableCellClasses. Metadata stays fixed across rows and
 * states; the Run column has no width and receives the table's remaining space.
 */
export const runTableColumnWidths = {
  status: "w-[7.5rem]",
  elapsed: "w-40",
  created: "w-52",
} as const;

export const runTableMinimumWidths = {
  history: "min-w-[82rem]",
  trigger: "min-w-[82rem]",
  all: "min-w-[82rem]",
} as const;
