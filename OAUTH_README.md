# Deriv Bot OAuth Migration

This project has been migrated to use Deriv's OAuth 2.0 Authorization Code with PKCE for authentication.

## Overview

The migration includes:
- Frontend PKCE implementation
- Backend serverless API routes for token exchange and OTP
- Secure HTTP-only cookie-based sessions
- WebSocket connections with authenticated OTP URLs

## Environment Variables

Set these in your Vercel dashboard (Production and Preview):

- `OAUTH_CLIENT_ID`: 34J0u7zObmeCX5lnl8zm7
- `APP_ID`: 34J0u7zObmeCX5lnl8zm7
- `REDIRECT_URI`: https://dylantrades.site/callback
- `SESSION_SECRET`: Generate a long random string (e.g., `openssl rand -base64 32`)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables in `.env`:
   ```
   OAUTH_CLIENT_ID=34J0u7zObmeCX5lnl8zm7
   APP_ID=34J0u7zObmeCX5lnl8zm7
   REDIRECT_URI=https://dylantrades.site/callback
   SESSION_SECRET=your-secret-here
   ```

3. Start the development server:
   ```bash
   npm run start
   ```

## Vercel Deployment

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Set the environment variables in Vercel dashboard
4. Set the production domain to match `REDIRECT_URI` (https://dylantrades.site/callback)
5. Deploy

## Testing the Flow

1. Visit `/auth` to see the authentication UI
2. Click "Login" -> redirected to Deriv OAuth
3. Authorize the app
4. Redirected back to `/callback` -> token exchanged and stored in cookie
5. Back to `/auth` -> shows logged in status
6. Use "Get OTP" with account ID (e.g., "demo") to connect WebSocket
7. Send trading messages via the WebSocket

## API Endpoints

- `POST /api/auth/exchange-token`: Exchanges authorization code for access token
- `POST /api/ws/otp`: Gets OTP URL for authenticated WebSocket
- `GET /api/accounts`: Lists user accounts (for testing auth)
- `POST /api/auth/logout`: Clears session cookie

## Security Notes

- Access tokens are never exposed to the browser
- HTTP-only, Secure, SameSite=Lax cookies used for sessions
- All URLs use HTTPS
- PKCE prevents authorization code interception

## Files Added/Modified

### Frontend
- `src/utils/pkce.ts`: PKCE utilities
- `src/lib/auth.ts`: OAuth flow functions
- `src/components/AuthButtons.tsx`: Login/Signup buttons
- `src/pages/callback/callback-page.tsx`: OAuth callback handler
- `src/lib/ws.ts`: WebSocket connection helpers
- `src/components/UserStatus.tsx`: Auth status and OTP UI
- `src/pages/AuthPage.tsx`: Simple auth test page

### Backend
- `api/auth/exchange-token.ts`: Token exchange API
- `api/ws/otp.ts`: OTP generation API
- `api/accounts.ts`: Accounts listing API
- `api/auth/logout.ts`: Logout API

### Config
- `vercel.json`: Updated for serverless API routes
- `package.json`: Added `cookie` and `@types/cookie` dependencies

## Next Steps

- Integrate the auth flow into your main application UI
- Handle token expiration and refresh
- Add proper error handling and user feedback
- Implement WebSocket reconnection logic
- Add more trading API integrations as needed