# Deriv API Migration Audit & Action Plan

Date: 2026-06-06

Summary
-------
- Objective: Audit current Deriv integrations and provide a prioritized plan to migrate to modern Deriv endpoints, fix WebSocket issues, authentication, branding, and subscriptions.
- Scope: repository-wide scan for WebSocket, OAuth, app IDs, branding, and Deriv API usage.

Phase 1 — Findings (Configuration Audit)
---------------------------------------

Key files I inspected:

- [src/lib/deriv-websocket.ts](src/lib/deriv-websocket.ts) — primary lightweight WebSocket wrapper used by hooks.
- [src/services/DerivWS.ts](src/services/DerivWS.ts) — higher-level singleton WebSocket/API manager used across trading flows.
- [src/components/shared/utils/config/config.ts](src/components/shared/utils/config/config.ts) — central config, URL builders, app id helpers.
- [src/external/bot-skeleton/services/api/appId.js](src/external/bot-skeleton/services/api/appId.js) — Deriv API instance generator using @deriv/deriv-api.
- [src/external/bot-skeleton/services/api/api-base.ts](src/external/bot-skeleton/services/api/api-base.ts) — API base wrapper handling subscriptions and authorization.
- [.env](.env) — environment values used during development.

Concrete findings
- .env contains legacy and current APP_ID set to `113536` (see [.env](.env)). This is a hardcoded/checked-in app id and also present as `LEGACY_APP_ID`.
- The codebase supports legacy mode (see `isLegacyModeEnabled()` in [config.ts](src/components/shared/utils/config/config.ts)) and will prefer `LEGACY_APP_ID` if present. This can cause legacy App ID usage in production.
- WebSocket URL builders exist (`getPublicWebSocketURL`, `getSocketURL`, `DERIV_WS_PUBLIC_URL`) in [config.ts](src/components/shared/utils/config/config.ts). `DERIV_WS_PUBLIC_URL` is driven by env variable `DERIV_WS_PUBLIC_URL`. Current default is `wss://api.derivws.com/trading/v1/options/ws/public`.
- I found multiple WebSocket wrappers: `src/lib/deriv-websocket.ts` (simple wrapper) and `src/services/DerivWS.ts` (singleton API manager). Both call the URL builders; however, there are code paths that accept `server_url` values from local storage or external OTP fetch which may produce malformed concatenations if not validated (e.g. `getSocketURL` prepends `wss://` when the stored value does not start with `wss://` — this logic is fragile if `server_url` includes path fragments).
- `appId.js` (Deriv API instance generator) normalizes socket strings but will accept arbitrary `custom_ws_url`. There are normalization edge cases where values without slashes are turned into `wss://${value}`, which could create malformed host+path strings if `server_url` is something like `wssapi.derivws.comtradingv1optionswspublicappid113536` — this likely explains malformed URLs seen in logs.
- Reconnect loops: `src/lib/deriv-websocket.ts` and `src/services/DerivWS.ts` both implement reconnect strategies; however:
  - `DerivWebSocket.handleReconnect()` calls `this.connect()` unconditionally and uses exponential backoff but does not cancel pending reconnect timers when a manual `disconnect()` is called.
  - `DerivWS.connect()` tracks `openingPromise` but `onclose` simply sets it to null and doesn't implement a robust reconnect queue; coupled with subscription code that calls `connect()` then immediately `send()`, race conditions and duplicate subscriptions are likely.
- Subscription lifecycle issues: `APIBase.subscribe()` (in [api-base.ts](src/external/bot-skeleton/services/api/api-base.ts)) will queue subscription promises via `doUntilDone`, but unsubscribe uses `forget: subId` only if the connection is open. If the socket disconnects and subscriptions were re-established with different req_ids, unsubscribe calls may target stale ids, leaving server-side subscriptions active and causing duplicate messages or memory leaks.
- Branding endpoints: repository contains local brand config files (e.g., `src/components/shared/brand.config.json`) and uses `@deriv-com/utils` BrandConstants. I did not find a clear external `branding` fetch endpoint in the small scan, but code paths rendering branding data exist. Watch for any runtime branding fetches that may be redirected to HTML pages (server misconfiguration).
- OAuth & CORS: `.env` contains DERIV OAuth endpoints (`DERIV_OAUTH_URL`, `DERIV_TOKEN_URL`) and `OAUTH_CLIENT_ID`. The front-end uses PKCE flows built in `generateOAuthURL()` (in config.ts). Common CORS issues will come from server-side callback endpoints and proxy endpoints such as `/api/ws/otp` used by `api-base.ts` — verify those serverless routes or API proxies to ensure correct CORS headers and JSON responses.

Immediate risks and priorities
- High: WebSocket URL generation/validation — malformed URLs will prevent all market data and trading flows (Phase 2).
- High: Legacy app ID usage — may cause auth or endpoint incompatibilities if different scopes are required (Phase 1 & 6).
- High: OAuth/session CORS or callback failures — blocks login (Phase 6).
- Medium: Subscription duplicate / reconnect loops — leads to incorrect UI state and memory leaks (Phase 4).

Phase 2 — Concrete remediation suggestions
----------------------------------------

1) Centralize and harden WebSocket URL builder
   - Provide a single strongly-typed URL builder function (already partially present as `getPublicWebSocketURL`/`getSocketURL`).
   - Validate inputs: ensure host is a valid hostname, ensure URL has protocol, parse with `new URL()` where possible.
   - Before creating `new WebSocket(url)` always log the final URL and run a sanity check; if malformed, fall back to a safe default `wss://api.derivws.com/trading/v1/options/ws/public?app_id=<id>`.

2) Deprecate legacy APP_ID by default
   - Remove hard-coded `APP_ID=113536` from checked-in `.env` (move to `.env.example`) and require runtime configuration.
   - Make `isLegacyModeEnabled()` opt-in via a secure flag only in development.

3) Fix normalization logic in `appId.js` and `config.ts`
   - Update `normalizeSocket` and `getSocketURL` to use `URL` parsing and explicit path joining instead of naive string concatenation.

4) Subscription engine improvements
   - Only send subscribe requests when socket.readyState === OPEN.
   - Maintain a map of active subscriptions keyed by canonical subscription request (symbol + stream type), reuse existing subscription IDs to prevent duplicates.
   - On reconnect, auto-resubscribe using the canonical subscription map; queue subscription requests while CONNECTING.

5) Authentication/OAuth
   - Ensure server endpoints used by OAuth flow (`/api/ws/otp`, token exchange endpoints, callback routes) return JSON with correct CORS headers and do not redirect to HTML pages for API requests.
   - Add full PKCE validation and improved error handling — detect invalid/expired tokens and force a single clean re-login flow.

6) Branding
   - Add a small wrapper for branding fetch calls that validates `Content-Type: application/json` and rejects HTML results with clear diagnostics and fallback to local brand config.

Phase 3 — Actionable migration plan (short-term tasks)
----------------------------------------------------

1. Add migration docs & tests (this file).
2. Implement URL builder validation utilities (create `src/services/deriv-url.ts`).
3. Replace all raw `new WebSocket(...)` calls with a small factory that logs and validates final URL.
4. Harden `DerivWS` and `DerivWebSocket`:
   - Queue sends until OPEN
   - Track subscriptions with canonical keys
   - Cancel reconnect timers on explicit disconnect
5. Update `appId.js` normalization to use `URL` and fallback logic.
6. Audit serverless endpoints used (`/api/ws/otp`) to ensure JSON/CORS and add retries.
7. Add startup `environment validation` that outputs a small report to console on app boot.

Files to change (candidate list)
- src/components/shared/utils/config/config.ts
- src/lib/deriv-websocket.ts
- src/services/DerivWS.ts
- src/external/bot-skeleton/services/api/appId.js
- src/external/bot-skeleton/services/api/api-base.ts
- .env (do not commit secrets to production)

Next steps I can take now
- Implement the central URL validator and factory and wire it into `DerivWebSocket` and `DerivWS` (Phase 2) — this is the highest-impact and low-risk change.
- Add runtime environment validation that prints missing/invalid env values (Phase 8).

If you want me to continue, I will implement the URL builder and replace raw WebSocket instantiations with a validated factory and add detailed connection logging and diagnostics (symbols, subscription id map, connection state, last message time). Confirm and I will start coding these changes immediately.
