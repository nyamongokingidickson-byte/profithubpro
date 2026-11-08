// @ts-nocheck
/**
 * Backend OAuth 2.0 API Routes (Node.js/Express)
 * Handles OAuth token exchange, refresh, and revocation
 */

import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

// Initialize Express router
export const oauthRouter = express.Router();

// Rate limiting for security
const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many token requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// CSRF protection middleware
const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
    // Verify CSRF token from request headers
    const csrfToken = req.headers['x-csrf-token'];
    const sessionCsrf = req.session?.csrfToken;
    
    if (!csrfToken || csrfToken !== sessionCsrf) {
        return res.status(403).json({ error: 'CSRF token validation failed' });
    }
    
    next();
};

// Generate CSRF token
oauthRouter.get('/csrf-token', (req: Request, res: Response) => {
    const csrfToken = uuidv4();
    if (req.session) {
        req.session.csrfToken = csrfToken;
    }
    
    res.json({ csrfToken });
});

/**
 * Validate and store state parameter for OAuth flow
 */
oauthRouter.post(
    '/validate-state',
    tokenLimiter,
    (req: Request, res: Response) => {
        const { state } = req.body;
        
        if (!state) {
            return res.status(400).json({ error: 'State parameter required' });
        }
        
        if (req.session) {
            req.session.oauthState = state;
            req.session.stateTimestamp = Date.now();
        }
        
        res.json({ success: true });
    }
);

/**
 * Token Exchange Endpoint
 * Exchange authorization code for access token
 */
oauthRouter.post(
    '/token',
    tokenLimiter,
    csrfProtection,
    async (req: Request, res: Response) => {
        try {
            const { code, redirectUri, clientId, codeVerifier } = req.body;
            
            if (!code || !redirectUri || !clientId || !codeVerifier) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing required parameters',
                });
            }
            
            // Call OAuth provider to exchange code for token
            const tokenResponse = await axios.post(
                process.env.OAUTH_TOKEN_URL!,
                {
                    grant_type: 'authorization_code',
                    code,
                    client_id: clientId,
                    redirect_uri: redirectUri,
                    code_verifier: codeVerifier,
                },
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeout: 10000,
                }
            );
            
            const { access_token, refresh_token, id_token, expires_in } = tokenResponse.data;
            
            // Store tokens securely in session
            if (req.session) {
                req.session.accessToken = access_token;
                req.session.refreshToken = refresh_token;
                req.session.idToken = id_token;
                req.session.tokenExpiry = Date.now() + expires_in * 1000;
                req.session.userId = req.body.userId;
            }
            
            // Set secure HTTP-only cookie for refresh token
            res.cookie('refreshToken', refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            });
            
            res.json({
                access_token,
                id_token,
                expires_in,
                token_type: 'Bearer',
            });
        } catch (error) {
            console.error('Token exchange error:', error);
            
            res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Failed to exchange authorization code for token',
            });
        }
    }
);

/**
 * Token Refresh Endpoint
 * Refresh access token using refresh token
 */
oauthRouter.post(
    '/refresh',
    tokenLimiter,
    csrfProtection,
    async (req: Request, res: Response) => {
        try {
            const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
            
            if (!refreshToken) {
                return res.status(401).json({
                    error: 'invalid_request',
                    error_description: 'Refresh token not found',
                });
            }
            
            // Call OAuth provider to refresh token
            const tokenResponse = await axios.post(
                process.env.OAUTH_TOKEN_URL!,
                {
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: process.env.OAUTH_CLIENT_ID || '34J0u7zObmeCX5lnl8zm7',
                },
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeout: 10000,
                }
            );
            
            const { access_token, refresh_token, expires_in } = tokenResponse.data;
            
            // Update session
            if (req.session) {
                req.session.accessToken = access_token;
                req.session.tokenExpiry = Date.now() + expires_in * 1000;
            }
            
            // Update refresh token cookie if a new one was issued
            if (refresh_token) {
                res.cookie('refreshToken', refresh_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                });
            }
            
            res.json({
                access_token,
                expires_in,
                token_type: 'Bearer',
            });
        } catch (error) {
            console.error('Token refresh error:', error);
            
            res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Failed to refresh access token',
            });
        }
    }
);

/**
 * Token Revocation Endpoint
 * Revoke access or refresh token (logout)
 */
oauthRouter.post(
    '/revoke',
    tokenLimiter,
    csrfProtection,
    async (req: Request, res: Response) => {
        try {
            const { token } = req.body;
            const refreshToken = req.cookies.refreshToken;
            
            // Call OAuth provider to revoke token
            await axios.post(
                process.env.OAUTH_REVOKE_URL!,
                {
                    token: token || refreshToken,
                    client_id: process.env.OAUTH_CLIENT_ID || '34J0u7zObmeCX5lnl8zm7',
                },
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeout: 10000,
                }
            );
            
            // Clear session
            if (req.session) {
                req.session.destroy((err) => {
                    if (err) console.error('Session destruction error:', err);
                });
            }
            
            // Clear refresh token cookie
            res.clearCookie('refreshToken');
            
            res.json({ success: true });
        } catch (error) {
            console.error('Token revocation error:', error);
            
            // Still clear local session even if revocation fails
            if (req.session) {
                req.session.destroy((err) => {
                    if (err) console.error('Session destruction error:', err);
                });
            }
            res.clearCookie('refreshToken');
            
            res.json({ success: true });
        }
    }
);

/**
 * Get User Info Endpoint
 * Retrieve authenticated user information
 */
oauthRouter.get(
    '/user',
    csrfProtection,
    async (req: Request, res: Response) => {
        try {
            const accessToken = req.session?.accessToken;
            
            if (!accessToken) {
                return res.status(401).json({
                    error: 'unauthorized',
                    error_description: 'No access token found',
                });
            }
            
            // Verify token is still valid
            const now = Date.now();
            const tokenExpiry = req.session?.tokenExpiry || 0;
            
            if (now > tokenExpiry) {
                return res.status(401).json({
                    error: 'token_expired',
                    error_description: 'Access token has expired',
                });
            }
            
            // Retrieve user info from OAuth provider
            // This is a mock implementation - replace with actual provider call
            res.json({
                userId: req.session?.userId,
                email: req.session?.email,
                name: req.session?.name,
                tradingAccounts: req.session?.tradingAccounts || [],
            });
        } catch (error) {
            console.error('Get user info error:', error);
            
            res.status(500).json({
                error: 'server_error',
                error_description: 'Failed to retrieve user information',
            });
        }
    }
);

/**
 * Validate Token Endpoint
 * Check if token is still valid
 */
oauthRouter.post(
    '/validate-token',
    async (req: Request, res: Response) => {
        try {
            const { token } = req.body;
            
            if (!token) {
                return res.status(400).json({ valid: false });
            }
            
            const now = Date.now();
            const tokenExpiry = req.session?.tokenExpiry || 0;
            
            if (now > tokenExpiry) {
                return res.json({ valid: false, reason: 'expired' });
            }
            
            res.json({ valid: true });
        } catch (error) {
            console.error('Token validation error:', error);
            res.json({ valid: false });
        }
    }
);

/**
 * Initialize Trading Session
 * Set up trading session after successful authentication
 */
oauthRouter.post(
    '/trading-session',
    csrfProtection,
    async (req: Request, res: Response) => {
        try {
            const { loginId } = req.body;
            const accessToken = req.session?.accessToken;
            
            if (!accessToken || !loginId) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing required parameters',
                });
            }
            
            // Create trading session
            const sessionId = uuidv4();
            const wsAuthToken = uuidv4();
            
            if (req.session) {
                req.session.tradeSession = {
                    sessionId,
                    loginId,
                    wsAuthToken,
                    createdAt: Date.now(),
                };
            }
            
            res.json({
                sessionId,
                wsAuthToken,
                loginId,
            });
        } catch (error) {
            console.error('Trading session initialization error:', error);
            
            res.status(500).json({
                error: 'server_error',
                error_description: 'Failed to initialize trading session',
            });
        }
    }
);

export default oauthRouter;
