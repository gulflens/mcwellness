# billing-02: routing the price list screen

This is the change billing-01.md's item 2 deferred to "the pull request that
adds `app/admin/billing/BillingPage.tsx`" — that pull request is this one.
Item 1 (mounting `mountBilling` in `app/api/create-api.ts`) is already live
(billing-01.md, applied in round 5); this request only concerns the two
shared-zone files a screen needs to be reachable: the route table and the
rail link.

`app/admin/billing/BillingPage.tsx` and `app/admin/billing/PriceDrawer.tsx`
now exist on this branch, so the diffs below are the real ones, not
illustrative. Both edits are entirely mechanical: one route line following
the `clients` route's own shape, and the rail's existing "Billing" entry
(currently a disabled "Arriving" item) given the `to` destination the other
sections already carry.

## 1. Register the route

**What.** In `app/shell/App.tsx`, import `BillingPage` and add a `billing`
route under `/admin`, beside `clients`.

**Why.** `App.tsx` is the one place routes are registered (the `ClientsPage`
precedent). Nothing else needs to change: `RequireAuth` already wraps the
whole `/admin` subtree, so the screen inherits the same sign-in gate
`ClientsPage` has, and role gating within the screen (the "Add price" button)
is the screen's own concern, not the route's.

**Diff.**

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { Navigate, Route, Routes, useLocation } from 'react-router';
+import { BillingPage } from '../admin/billing/BillingPage';
 import { ClientsPage } from '../admin/clients/ClientsPage';
 import { PortalLanding } from '../client/PortalLanding';
@@
         <Route index element={<Navigate to="/admin/clients" replace />} />
         <Route path="clients" element={<ClientsPage />} />
+        <Route path="billing" element={<BillingPage />} />
       </Route>
```

## 2. Give the rail's "Billing" entry a destination

**What.** In `app/shell/components/Rail.tsx`, add `to: '/admin/billing'` to
the existing `billing` entry in `ADMIN_SECTIONS`.

**Why.** The rail already lists Billing; today it renders as
`rail__item--later` ("Arriving") because `to` is unset. Adding the
destination is the whole change — `Rail.tsx`'s own logic already renders any
section with a `to` as a real `NavLink` (see the `clients`, and no other,
entry today).

**Diff.**

```diff
--- a/app/shell/components/Rail.tsx
+++ b/app/shell/components/Rail.tsx
@@
 export const ADMIN_SECTIONS: readonly RailSection[] = [
   { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
   { key: 'schedule', label: 'Schedule', icon: <ScheduleIcon /> },
   { key: 'sessions', label: 'Sessions', icon: <SessionsIcon /> },
-  { key: 'billing', label: 'Billing', icon: <BillingIcon /> },
+  { key: 'billing', label: 'Billing', to: '/admin/billing', icon: <BillingIcon /> },
   { key: 'audit', label: 'Audit', icon: <AuditIcon /> },
 ];
```

## Verification

This worktree applied both diffs locally (`git checkout app/shell/App.tsx
app/shell/components/Rail.tsx` before every commit, per the worktree's own
constraint) to drive the screen during development: `pnpm dev`, sign in as
the seeded owner, admin and lead practitioner, and confirm the price list
loads, "Add price" is present for owner/admin/finance and absent for a lead
practitioner, and the rail link navigates there. Nothing about that
verification depends on this file — it is the record of the two-line diff
for the integrator to apply on `main`, exactly as billing-01.md's item 1 was.
