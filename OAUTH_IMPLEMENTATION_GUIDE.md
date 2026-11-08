# OAuth 2.0 PKCE Implementation Guide for Dylan Trades

## Overview

This guide covers the complete OAuth 2.0 Authorization Code Flow with PKCE implementation for the Dylan Trades platform. The system supports secure authentication, automatic token refresh, trading session management, and backward compatibility with legacy authentication.

## Architecture

### Core Components

1. **Frontend (React)**
   - OAuth service (`src/services/oauth/oauth2.service.ts`)
   - PKCE utilities (`src/utils/oauth/pkce-utils.ts`)
   - React hooks (`src/hooks/useOAuth.ts`)
   - Admin onboarding wizard (`src/components/admin-onboarding-wizard/`)

2. **Backend (Node.js/Express)**
   - OAuth routes (`api/oauth/routes.ts`)
   - Token management
   - Session handling
   - Rate limiting & CSRF protection

3. **Configuration**
   - Environment variables (`.env.oauth`)
   - Admin-configurable settings via wizard

## Setup Instructions

### 1. Environment Configuration

```bash
# Copy the OAuth configuration file
cp .env.oauth .env.local

# Update with your OAuth provider details
VITE_OAUTH_CLIENT_ID=your_client_id
VITE_OAUTH_AUTH_URL=your_auth_endpoint
VITE_OAUTH_TOKEN_URL=your_token_endpoint
```

### 2. Backend Setup

#### Install Dependencies

```bash
npm install express axios express-rate-limit uuid
npm install --save-dev @types/express @types/node
```

#### Enable OAuth Routes

In your main server file:

```typescript
import { oauthRouter } from './api/oauth/routes';

app.use('/api/oauth', oauthRouter);
```

#### Configure Session Management

```typescript
import session from 'express-session';
import RedisStore from 'connect-redis';
import redis from 'redis';

const redisClient = redis.createClient();

app.use(
    session({
        store: new RedisStore({ client: redisClient }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        },
    })
);
```

### 3. Frontend Integration

#### Initialize OAuth Service

```typescript
import { initializeOAuth2Service } from '@/services/oauth/oauth2.service';
import { OAuthConfig } from '@/types/oauth-types';

const config: OAuthConfig = {
    siteUrl: import.meta.env.VITE_SITE_URL,
    clientId: import.meta.env.VITE_OAUTH_CLIENT_ID,
    legacyAppId: import.meta.env.VITE_LEGACY_APP_ID,
    redirectUri: `${import.meta.env.VITE_SITE_URL}/callback`,
    authUrl: import.meta.env.VITE_OAUTH_AUTH_URL,
    tokenUrl: import.meta.env.VITE_OAUTH_TOKEN_URL,
    revokeUrl: import.meta.env.VITE_OAUTH_REVOKE_URL,
    scopes: ['read', 'trade', 'payments', 'trading_information'],
    enableLegacyMode: import.meta.env.VITE_ENABLE_LEGACY_MODE === 'true',
    codeChallengeMethod: 'S256',
};

initializeOAuth2Service(config);
```

#### Use OAuth Hook in Components

```typescript
import { useOAuth } from '@/hooks/useOAuth';

function LoginComponent() {
    const { isAuthenticated, isLoading, login, logout } = useOAuth();

    if (isAuthenticated) {
        return <button onClick={logout}>Logout</button>;
    }

    return <button onClick={login} disabled={isLoading}>Login with OAuth</button>;
}
```

#### Handle OAuth Callback

Create a callback page at `/callback`:

```typescript
import { useOAuth } from '@/hooks/useOAuth';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CallbackPage() {
    const { isAuthenticated, error } = useOAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard');
        } else if (error) {
            navigate('/login?error=' + error.error);
        }
    }, [isAuthenticated, error, navigate]);

    return <div>Processing login...</div>;
}
```

### 4. Admin Onboarding Wizard

The wizard provides a user-friendly interface for OAuth configuration:

```typescript
import AdminOnboardingWizard from '@/components/admin-onboarding-wizard';
import { AdminOnboardingConfig } from '@/types/oauth-types';

function AdminPanel() {
    const [wizardOpen, setWizardOpen] = React.useState(false);

    const handleWizardComplete = (config: AdminOnboardingConfig) => {
        // Save configuration to database or local storage
        saveOAuthConfig(config);
        setWizardOpen(false);
    };

    return (
        <>
            <button onClick={() => setWizardOpen(true)}>
                Configure OAuth
            </button>
            <AdminOnboardingWizard
                isOpen={wizardOpen}
                onComplete={handleWizardComplete}
                onCancel={() => setWizardOpen(false)}
            />
        </>
    );
}
```

## PKCE Code Generation

The system automatically generates and manages PKCE parameters:

```typescript
import {
    generatePKCEParameters,
    generateCodeChallenge,
    validateOAuthState,
    getPKCEParameters,
} from '@/utils/oauth/pkce-utils';

// Generate PKCE parameters automatically
const { codeVerifier, codeChallenge, state, nonce } = await generatePKCEParameters();

// Parameters are stored securely in sessionStorage
// Retrieved on callback for code validation
```

## Token Management

### Automatic Token Refresh

Tokens are automatically refreshed 5 minutes before expiry:

```typescript
const { token, refreshToken } = useOAuth();

// Auto-refresh is handled internally by OAuth2Service
// Refresh tokens are stored in HTTP-only cookies
```

### Manual Token Operations

```typescript
const oauthService = getOAuth2Service();

// Refresh token
const newToken = await oauthService.refreshAccessToken(refreshToken);

// Revoke token (logout)
await oauthService.revokeToken(accessToken);

// Get current token
const currentToken = oauthService.getToken();
```

## WebSocket Session Recovery

After token refresh, WebSocket sessions are automatically reconnected:

```typescript
// This is handled automatically by the framework
// WebSocket reconnect is triggered after successful token refresh
// Trading sessions are preserved across token updates
```

## Legacy App ID Support

For backward compatibility with existing integrations:

```typescript
// Enable legacy mode in configuration
const config: OAuthConfig = {
    ...baseConfig,
    enableLegacyMode: true,
    legacyAppId: '34J0u7zObmeCX5lnl8zm7',
};

// Existing users are automatically migrated
// Legacy sessions continue to work alongside OAuth
```

## Migration Strategy

### Detecting Legacy Sessions

```typescript
const detectLegacySession = (): boolean => {
    const accountsList = localStorage.getItem('accountsList');
    const clientAccounts = localStorage.getItem('clientAccounts');
    return !!accountsList && !!clientAccounts;
};
```

### Automatic Migration

```typescript
if (detectLegacySession()) {
    // Preserve existing integrations
    const legacyData = {
        accountsList: localStorage.getItem('accountsList'),
        clientAccounts: localStorage.getItem('clientAccounts'),
    };
    
    // Store for fallback, migrate user to OAuth
    localStorage.setItem('legacy_backup', JSON.stringify(legacyData));
}
```

## Security Best Practices

1. **PKCE Protection**: Automatically implemented for all authorization flows
2. **CSRF Protection**: Token validation on all state-changing operations
3. **Secure Cookies**: HTTP-only, Secure, SameSite=Strict for refresh tokens
4. **Rate Limiting**: 100 requests per 15 minutes per IP
5. **Token Expiry**: Access tokens expire after configured duration
6. **Session Timeout**: Automatic logout after 30 minutes of inactivity

## Testing

### Unit Tests

```typescript
import { generatePKCEParameters, validateOAuthState } from '@/utils/oauth/pkce-utils';

describe('PKCE Utils', () => {
    it('should generate valid PKCE parameters', async () => {
        const params = await generatePKCEParameters();
        expect(params.codeVerifier).toBeTruthy();
        expect(params.codeChallenge).toBeTruthy();
        expect(params.state).toBeTruthy();
        expect(params.nonce).toBeTruthy();
    });

    it('should validate OAuth state correctly', () => {
        const state = 'test-state';
        sessionStorage.setItem('oauth_pkce_params', JSON.stringify({ state }));
        expect(validateOAuthState(state)).toBe(true);
        expect(validateOAuthState('wrong-state')).toBe(false);
    });
});
```

### E2E Tests

1. Test complete login flow
2. Test token refresh
3. Test logout/token revocation
4. Test session recovery after token refresh
5. Test legacy app ID compatibility

## Troubleshooting

### Common Issues

**Issue**: "PKCE parameters not found"
- Solution: Ensure sessionStorage is not cleared between auth and callback

**Issue**: "CSRF token validation failed"
- Solution: Verify X-CSRF-Token header is sent with POST requests

**Issue**: "Token refresh failed"
- Solution: Check refresh token expiry and rate limiting status

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS for all OAuth endpoints
- [ ] Configure secure cookies
- [ ] Set up Redis for session management
- [ ] Enable CSRF protection
- [ ] Configure rate limiting
- [ ] Set up monitoring for OAuth failures
- [ ] Configure backup authentication method
- [ ] Test token refresh functionality
- [ ] Verify session recovery after disconnect

### Environment Variables

Required variables for production:

```
VITE_SITE_URL=https://your-domain.com
VITE_OAUTH_CLIENT_ID=your-client-id
VITE_OAUTH_AUTH_URL=https://oauth-provider/authorize
VITE_OAUTH_TOKEN_URL=https://oauth-provider/token
VITE_OAUTH_REVOKE_URL=https://oauth-provider/revoke
SESSION_SECRET=your-session-secret
REDIS_URL=redis://your-redis-instance
```

## Support & Documentation

For detailed API documentation, see the individual component files:
- `src/services/oauth/oauth2.service.ts` - OAuth service documentation
- `src/utils/oauth/pkce-utils.ts` - PKCE utilities documentation
- `api/oauth/routes.ts` - Backend routes documentation
- `src/types/oauth-types.ts` - Type definitions and interfaces

## License

Dylan Trades OAuth 2.0 Implementation - © 2026
