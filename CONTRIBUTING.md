# Contributing to LifeOS

Issues and pull requests are welcome.

Before submitting a change:

1. Run `cd server && npm run typecheck`.
2. Run `cd app && npm run build`.
3. Do not commit `.env`, `server/data/`, personal exports, API keys, APKs, or
   local toolchains.
4. For changes involving imported data formats or third-party code, document
   the source and license in `NOTICE.md`.

LifeOS is local-first, but the optional LAN access mode is unauthenticated in
the current development build. Do not expose it to the public Internet.
