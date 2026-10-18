---
paths: ["app/**"]
---
# UI rules — see DESIGN.md and docs/DESIGN-BRIEF.md
- Admin: light, dense, tables not cards, working content on white panels, 44px rows, hairline rules, right-side drawer not modals. One focal point per screen.
- The session ribbon is the signature figure: client home, client record, clients ledger, end of session, report cover.
- Practitioner PWA: dark, single column, one decision per screen, 56px primary action in thumb zone, no chrome during a session. Offline is a calm band, never a red alert.
- Client: calm, generous, plain-language copy first, the measurement on tap.
- Use design tokens from `app/shell/tokens.css`; never hardcode colours.
- Arabic: RTL-safe layout from day one (logical CSS properties), even if v1 copy is English.
- No personal data in URL paths or query strings. Route by opaque ids only.
