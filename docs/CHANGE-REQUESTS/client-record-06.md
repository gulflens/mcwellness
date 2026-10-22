# client-record-06: Finance is offered a Timeline tab it cannot open

Raised by the accounting stream on 2026-10-22 while reviewing the console from
a finance user's seat. Nothing in `app/admin/clients/**` was edited; this
request asks the client-record stream to make one of two changes.

---

## The defect

`app/admin/clients/ClientDrawer.tsx` gives a finance-only user three tabs:

```ts
const FINANCE_TABS = ALL_TABS.filter((tab) =>
  ['overview', 'contacts', 'timeline'].includes(tab.id),
);
```

The comment above it says "Finance reads demographics and contacts, and
nothing else". The Timeline tab mounts `RecordTimeline`, which calls
`GET /api/clients/:id/timeline`. That route asks for `audit.read`
(`app/api/audit/timeline.ts`), and `domain/shared/actor.ts` grants `audit.read`
to the owner, admin and lead practitioner only. The tab therefore opens onto
the timeline's error state for every finance-only user.

## The two remedies

1. **Remove `'timeline'` from `FINANCE_TABS`** (recommended). It matches the
   comment, the read policies and `docs/SPEC/client-record.md` section 2, and
   it needs no permission change. One line here, plus the drawer test's
   expectation for a finance actor.
2. **Grant Finance a timeline limited to billing events.** That would be useful
   to an accountant tracing a payment, but it is a change to who may read the
   audit log. It needs the owner's decision and a policy change in
   `db/policies/core/audit_log.sql`, which is the trunk's. It belongs with
   item 15 of the finance plan (a financial-records audit view), not here.

## Done when

A finance-only user opening a client sees Overview and Contacts only, and
`ClientDrawer.test.tsx` asserts it.
