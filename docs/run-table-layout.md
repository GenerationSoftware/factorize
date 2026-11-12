# Run table sizing

RunList and RunHistory share the widths in `packages/app/src/features/runs/table-layout.ts`.
The width envelope was checked in Chromium against the built app and its actual
table font, header weight, and responsive cell padding (`px-2` below `sm`, `px-3`
from `sm` upward):

| Column | Fixed width | Representative content used |
| --- | ---: | --- |
| Status | 120px (7.5rem) | `Status (11)` with both sort arrows; all 11 supported statuses selected |
| Elapsed | 160px (10rem) | `59m 59s–1h 2m`, `99999h 59m`, short and missing values |
| Created | 208px (13rem) | Full English and French medium-date/short-time strings and a recent relative date |

These are border-box table column widths, so they include the responsive cell
padding. The Status cell uses the widest bounded label and arrow state and stays
one line. Elapsed and Created fit the representative content without changing
the existing formatters. Longer durations and locale-specific dates stay in the
same columns, truncate within the cell, and expose the formatted value in the
native title tooltip. The rendered text remains left-aligned.

Run has no fixed width in either table. With the bounded Project/Job columns,
the minimum table widths leave at least 160px for Run: 62rem for the all-runs
listing, 52rem for RunList with one bounded context column, and 42rem for job
history. On narrow screens, the existing table shell owns horizontal scrolling;
the page itself does not grow horizontally. The fixed metadata widths do not
depend on visible rows, filters, sort direction, pagination, or row updates.

The browser coverage in `packages/app/test/runs.browser.test.mjs` checks the
header measurements and content matrix at wide and narrow viewports, including
the broader all-runs listing with both Project and Job columns.
