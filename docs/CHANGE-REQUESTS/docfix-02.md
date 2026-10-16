## docfix-02 — a tab that opened no longer says it was blocked (2026-10-15)

The second half of the document-fixes round (`docfix-01.md`, item 5), in the
same pull request.

**What.** Nine screens opened a page with
`window.open(url, '_blank', 'noopener,noreferrer')` and read a null answer as
"the browser blocked it". With "noopener", the HTML standard has
`window.open` return null whether or not the tab opened. So in a browser
that follows the standard, each of those screens reported a failure every
time it succeeded. Each was proved with a failing test that stands in a
browser behaving as the standard says.

| Screen | Stream | What it said every time |
|---|---|---|
| `app/admin/reports/ReportEditor.tsx` (preview) | reports | "Your browser blocked the window." (fixed in docfix-01) |
| `app/admin/reports/ReportView.tsx` | reports | "The report could not be opened. Your browser blocked the window." |
| `app/admin/clients/DocumentLink.tsx` | client-record | "Your browser stopped the file opening." |
| `app/admin/clients/ErasureSection.tsx` (WhatsApp draft) | client-record | "Your browser stopped WhatsApp opening." |
| `app/admin/assessments/ExportFiles.tsx` | assessment | "Your browser stopped the file opening." |
| `app/client/MoneyScreen.tsx` | client-portal | "That document could not be opened." |
| `app/client/ReportsScreen.tsx` | client-portal | "That document could not be opened." |
| `app/client/AgreementsScreen.tsx` (a consent's wording) | client-portal | "That document could not be opened." |
| `app/client/OffersSwitch.tsx` (the offers wording) | client-portal | "That document could not be opened." |

The last four were shown to households.

**Change.** There is one helper, `app/shell/openInNewTab.ts`, with its test.
It is in the shared zone (`app/shell/**`), and this file is the change
request for it. It opens the tab without "noopener", sets the new tab's
`opener` to null straight away, and answers whether the tab opened. All
nine screens use it.

What "noopener" protected is still protected: the opened page cannot reach
back into the console. What "noreferrer" protected is covered by the app's
own `Referrer-Policy: no-referrer` (`app/api/_middleware/security.ts`). The
map pages are the one exception: they send their origin alone, and no
address in the app names a person.

**Not changed.** These open with "noopener" but never read the answer, so
they say nothing false:

- `app/admin/billing/documents.ts`
- `app/admin/billing/SendDrawer.tsx`
- `app/admin/reports/qeeg/useQeegSigning.ts`
- `app/shell/components/CoordinateFields.tsx`, which needs its opener

The paths edited outside the reports stream belong to client-record,
assessment and client-portal. They ride in this pull request, as the
widened rounds did, and are listed above for the integrator.
