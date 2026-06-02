# OAuth Migration - QA Testing Checklist

## Pre-Deployment Verification

- [ ] All TypeScript files compile without errors
- [ ] API routes are in `api/` directory (not nested in src)
- [ ] `vercel.json` includes API routes in builds and routes
- [ ] Environment variables configured in Vercel dashboard for all environments
- [ ] REDIRECT_URI matches exactly in code and Deriv OAuth app settings
- [ ] Production domain is set in Vercel project settings

## Frontend Flow Testing

### Login Flow
- [ ] Visit `/auth` page shows login/signup buttons
- [ ] Click "Login" redirects to `https://auth.deriv.com/oauth2/auth`
- [ ] URL contains correct parameters:
  - `client_id=32LTHOWJyXh0f3E6uTNFP`
  - `response_type=code`
  - `scope=trade`
  - `code_challenge` (S256 format)
  - `state` (random string)
- [ ] Can authorize with Deriv credentials
- [ ] Redirected back to `/callback` with `?code=...&state=...`

### Callback Processing
- [ ] Callback page shows "Processing authentication..."
- [ ] Backend `/api/auth/exchange-token` is called
- [ ] State is verified (should not show "State mismatch")
- [ ] Token exchange succeeds (should not show "Token exchange failed")
- [ ] Automatically redirects to `/auth` after success

### Post-Login State
- [ ] `/auth` now shows "Logged in" message
- [ ] "Logout" button is visible
- [ ] Accounts list is populated

### Signup Flow
- [ ] Click "Signup" redirects to auth server with `prompt=registration`
- [ ] New account registration works
- [ ] Callback and login same as regular flow

### Logout
- [ ] Click "Logout" calls `/api/auth/logout`
- [ ] Access token cookie is cleared
- [ ] Page returns to login state
- [ ] Cannot access protected endpoints without logging in again

## Backend API Testing

### POST `/api/auth/exchange-token`

```bash
curl -X POST https://extradollarhub.site/api/auth/exchange-token \
  -H "Content-Type: application/json" \
  -d '{
    "code": "YOUR_AUTH_CODE",
    "code_verifier": "YOUR_VERIFIER",
    "redirect_uri": "https://extradollarhub.site"
  }'
```

- [ ] Returns `{"ok": true}` on success
- [ ] Sets `access_token` cookie (HTTP-only)
- [ ] Cookie has Secure and SameSite flags
- [ ] Subsequent requests can use the session

### GET `/api/accounts`

```bash
curl https://extradollarhub.site/api/accounts
```

- [ ] Returns account list when logged in
- [ ] Returns 401 Unauthorized when not logged in
- [ ] Cookie is automatically sent by browser

### POST `/api/ws/otp`

```bash
curl -X POST https://extradollarhub.site/api/ws/otp \
  -H "Content-Type: application/json" \
  -d '{"accountId": "demo"}'
```

- [ ] Returns `{"url": "wss://..."}`
- [ ] OTP URL can be used to connect WebSocket
- [ ] Returns 401 when not logged in
- [ ] Different account IDs return different OTP URLs

### POST `/api/auth/logout`

```bash
curl -X POST https://extradollarhub.site/api/auth/logout
```

- [ ] Returns `{"ok": true}`
- [ ] Clears `access_token` cookie
- [ ] Subsequent `/api/accounts` returns 401

## WebSocket Testing

### Public WebSocket (No Auth)
- [ ] Can connect to `wss://api.derivws.com/trading/v1/options/ws/public`
- [ ] Can send and receive messages
- [ ] Connection closes gracefully

### Authenticated WebSocket (with OTP)
- [ ] Get OTP URL from `/api/ws/otp` with valid account ID
- [ ] URL format: `wss://api.derivws.com/trading/v1/options/ws/{account}?otp={otp}`
- [ ] Can connect to OTP URL
- [ ] Can send trading messages (proposal, buy, etc.)
- [ ] Receives trading responses
- [ ] Connection works for at least 30 minutes
- [ ] Gracefully handles disconnection and reconnection

## Security Testing

### PKCE Implementation
- [ ] `sessionStorage` contains `pkce_code_verifier` before redirect
- [ ] `sessionStorage` contains `pkce_state` before redirect
- [ ] Code verifier is not logged or exposed anywhere
- [ ] Code challenge in URL is base64url-encoded S256 hash

### State Verification
- [ ] State in callback URL matches stored state
- [ ] Changing state parameter shows error
- [ ] Missing state parameter shows error

### Cookie Security
- [ ] Cookie has `HttpOnly` flag (cannot be accessed by JavaScript)
  ```bash
  document.cookie // should NOT show access_token
  ```
- [ ] Cookie has `Secure` flag (only sent over HTTPS)
- [ ] Cookie has `SameSite=Lax` flag (CSRF protection)
- [ ] Cookie sent automatically when calling APIs from same origin

### Token Exposure
- [ ] Access token never appears in browser console logs
- [ ] Access token never appears in Network tab responses
- [ ] Access token only appears on Deriv API responses to backend
- [ ] Frontend only receives derived data, not tokens

## Environment Isolation

### Local Development
- [ ] Can set `REDIRECT_URI=http://localhost:8443` in `.env.local`
- [ ] Auth flow works with localhost
- [ ] Can switch back to production URI

### Production
- [ ] All environment variables correct
- [ ] REDIRECT_URI exactly matches `https://extradollarhub.site`
- [ ] Session secret is cryptographically random (32+ bytes)

## Error Handling

### Invalid OAuth Code
- [ ] Sending invalid code to `/api/auth/exchange-token` shows error
- [ ] Error message is user-friendly
- [ ] User can retry login

### Missing Credentials
- [ ] `/api/accounts` returns 401 without login
- [ ] `/api/ws/otp` returns 401 without login
- [ ] `/api/auth/logout` works without login (idempotent)

### Network Errors
- [ ] Timeout during token exchange shows error
- [ ] Network failure during OAuth redirect is handled
- [ ] Can retry login

### Expired/Invalid Token
- [ ] Using expired token returns 401/403
- [ ] Frontend can detect and ask to re-login
- [ ] Clearing cookie and re-logging fixes it

## Performance Testing

- [ ] OAuth redirect happens within 1 second
- [ ] Token exchange completes within 3 seconds
- [ ] Accounts API responds within 2 seconds
- [ ] WebSocket connects within 2 seconds
- [ ] Page remains responsive during all operations

## Cross-Browser Testing

- [ ] Chrome/Edge: All flows work
- [ ] Firefox: All flows work
- [ ] Safari: All flows work (check SameSite cookie handling)
- [ ] Mobile browsers: All flows work

## Regression Testing

- [ ] Existing bot builder functionality still works
- [ ] Existing trading features not broken
- [ ] Existing pages still load
- [ ] No console errors in DevTools

---

## QA Sign-Off

Once all tests pass:

1. **Date Tested**: _____________
2. **Tested By**: _____________
3. **Browser/Device**: _____________
4. **Account ID Used**: _____________
5. **Status**: ☐ PASS ☐ FAIL (note issues below)

**Issues Found**:
```
[List any bugs or issues here]
```

**Sign-Off**: ___________________

---

## Deployment Readiness Checklist

Before deploying to production:

- [ ] All QA tests passed
- [ ] Code reviewed
- [ ] No security vulnerabilities
- [ ] All environment variables set in Vercel
- [ ] Backup of current version available
- [ ] Rollback plan documented
- [ ] Support team notified of changes
- [ ] User documentation updated (if applicable)

**Ready for Production**: Yes ☐ No ☐

**Deployment Date**: _______________
**Deployed By**: _______________
**Verified By**: _______________
