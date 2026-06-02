# Login → Token → WebSocket → Market Data (Architecture)

## Mermaid Flow

```mermaid
flowchart TD
    UI[User clicks "Login"] --> OAuth[Deriv OAuth flow]
    OAuth -->|token| APIBase[api_base.init()]
    APIBase -->|store token| AuthObs[authData$ observable]
    AuthObs -->|emit| ClientStore
    ClientStore -->|set loginId| WSLoginID[ws_login_id]
    WSLoginID -->|if needed| Regenerate[ClientStore.regenerateWebSocket]
    Regenerate -->|clear singleton| ClearDerivAPI[clearDerivApiInstance]
    ClearDerivAPI --> APIBase
    APIBase -->|create WS| WS[WebSocket]
    WS -->|subscribe| MarketStores[marketkiller, free‑bots, dashboard…]
    MarketStores -->|updates| UI
    UI -->|logout| ClientStore.logout()
    ClientStore.logout -->|clear| ClearAll[storage, cookies, observers]
```

## New services added (reference implementations)

- `src/services/DerivAuth.ts` — Auth singleton that centralises token storage (sessionStorage) and refresh/logout helpers.
- `src/services/DerivWS.ts` — WebSocketManager-style wrapper that encapsulates connect/disconnect/subscribe/unsubscribe and handles visibility-based reconnects (debounced).
- `src/services/SubscriptionRegistry.ts` — Tracks subscriptions per component scope and guarantees cleanup on dispose.
- `src/utils/result.ts` — Small `Result<T,E>` helper to standardise error handling.

## Migration notes

To migrate from the current ClientStore-centric model to the new services:

1. Replace direct `localStorage`/`sessionStorage` reads with calls to `DerivAuth.getToken()` and `DerivAuth.setToken()`.
2. Replace direct usage of the global `api_base` WebSocket with `DerivWS.connect(loginId)` and `DerivWS.subscribe(...)`.
3. Use `SubscriptionRegistry.register(componentId())` in components/stores to ensure subscriptions are cleaned up on unmount.
