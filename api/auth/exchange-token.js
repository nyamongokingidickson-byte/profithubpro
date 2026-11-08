'use strict';

const MAX_BODY_BYTES = 16 * 1024;
const ENV_OAUTH_CLIENT_ID = (process.env.OAUTH_CLIENT_ID || '').trim();
const OAUTH_CLIENT_ID =
    ENV_OAUTH_CLIENT_ID && ENV_OAUTH_CLIENT_ID !== '33pC7qk8i9WtRbTbSOkcq'
        ? ENV_OAUTH_CLIENT_ID
        : '34J0u7zObmeCX5lnl8zm7';

const REDIRECT_URI = (process.env.REDIRECT_URI || '').trim() || 'https://www.dylantrades.site/callback';
const ALLOWED_PRODUCTION_ORIGINS = new Set([
    'https://www.dylantrades.site',
    'https://dylantrades.site',
]);

function resolveTokenEndpoint(envValue) {
    const trimmed = (envValue || '').trim();
    if (!trimmed || trimmed.includes('oauth.deriv.com')) {
        return 'https://auth.deriv.com/oauth2/token';
    }
    return trimmed;
}

function reply(res, status, payload, extraHeaders) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (extraHeaders && typeof extraHeaders === 'object') {
        for (const [k, v] of Object.entries(extraHeaders)) {
            if (v !== undefined) res.setHeader(k, v);
        }
    }
    res.end(JSON.stringify(payload));
}

function formatAccessTokenCookie(token, maxAgeSeconds) {
    const parts = [
        `access_token=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
    ];
    if (typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
        parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
    }
    return parts.join('; ');
}

async function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'object') return req.body;
        if (typeof req.body === 'string') {
            if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) throw new Error('Body too large');
            try {
                return JSON.parse(req.body);
            } catch {
                const params = new URLSearchParams(req.body);
                return {
                    code: params.get('code'),
                    code_verifier: params.get('code_verifier'),
                    redirect_uri: params.get('redirect_uri'),
                };
            }
        }
    }

    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('Body too large');
    }
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        const params = new URLSearchParams(raw);
        return {
            code: params.get('code'),
            code_verifier: params.get('code_verifier'),
            redirect_uri: params.get('redirect_uri'),
        };
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Allow', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    if (req.method !== 'POST') {
        return reply(res, 405, { error: 'Method not allowed' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch {
        return reply(res, 400, { error: 'Invalid request', error_description: 'Invalid request body.' });
    }

    const { code, code_verifier, redirect_uri } = body || {};

    if (
        typeof code !== 'string' ||
        !code ||
        code.length > 4096 ||
        typeof code_verifier !== 'string' ||
        code_verifier.length < 43 ||
        code_verifier.length > 128 ||
        typeof redirect_uri !== 'string' ||
        !redirect_uri
    ) {
        return reply(res, 400, {
            error: 'Invalid request',
            error_description: 'Missing or invalid OAuth token exchange parameters.',
        });
    }

    try {
        const incoming = new URL(redirect_uri);
        const incomingPath = incoming.pathname.replace(/\/$/, '') || '/callback';
        const originHeader = typeof req.headers?.origin === 'string' ? req.headers.origin : null;
        const forwardedHost =
            (typeof req.headers?.['x-forwarded-host'] === 'string' &&
                req.headers['x-forwarded-host'].split(',')[0].trim()) ||
            (typeof req.headers?.host === 'string' ? req.headers.host.trim() : null);
        const forwardedProto =
            (typeof req.headers?.['x-forwarded-proto'] === 'string' &&
                req.headers['x-forwarded-proto'].split(',')[0].trim()) ||
            'https';
        const derivedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;

        const allowedLocalhost = incoming.hostname === 'localhost' || incoming.hostname === '127.0.0.1';
        const allowedVercelPreview =
            incoming.protocol === 'https:' && incoming.hostname.endsWith('.vercel.app');
        const isSameOrigin = Boolean(
            (originHeader && incoming.origin === originHeader) ||
                (derivedOrigin && incoming.origin === derivedOrigin)
        );

        const base = new URL(REDIRECT_URI);
        const basePath = base.pathname.replace(/\/$/, '') || '/callback';
        const originAllowed =
            incoming.origin === base.origin ||
            ALLOWED_PRODUCTION_ORIGINS.has(incoming.origin) ||
            allowedVercelPreview ||
            isSameOrigin ||
            allowedLocalhost;
        const allowedPaths = Array.from(new Set([basePath, '/callback']));

        if (!originAllowed || !allowedPaths.includes(incomingPath)) {
            return reply(res, 400, {
                error: 'Invalid redirect_uri',
                error_description: `Unexpected redirect_uri: ${redirect_uri}`,
            });
        }
    } catch {
        return reply(res, 400, {
            error: 'Invalid redirect_uri',
            error_description: 'Malformed redirect_uri parameter.',
        });
    }

    try {
        const tokenEndpoint = resolveTokenEndpoint(process.env.DERIV_TOKEN_URL);
        const formBody = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: OAUTH_CLIENT_ID,
            code,
            code_verifier,
            redirect_uri,
        }).toString();

        const tokenResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: formBody,
            signal: AbortSignal.timeout(15000),
        });

        const rawText = await tokenResponse.text();
        let parsed = null;
        try {
            parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
            parsed = null;
        }

        if (!tokenResponse.ok) {
            return reply(res, 400, {
                error: parsed?.error || 'token_exchange_failed',
                error_description:
                    parsed?.error_description ||
                    parsed?.message ||
                    rawText ||
                    `Deriv token endpoint returned HTTP ${tokenResponse.status}`,
            });
        }

        if (!parsed || typeof parsed !== 'object') {
            return reply(res, 502, {
                error: 'invalid_upstream_response',
                error_description: 'Deriv token endpoint returned an invalid JSON payload.',
            });
        }

        const extraHeaders = {};
        if (parsed.access_token) {
            extraHeaders['Set-Cookie'] = formatAccessTokenCookie(parsed.access_token, parsed.expires_in);
        }

        return reply(res, 200, parsed, extraHeaders);
    } catch (error) {
        console.error('Error exchanging token:', error);
        return reply(res, 502, {
            error: 'token_exchange_failed',
            error_description: 'Could not reach the Deriv authentication service. Please try signing in again.',
        });
    }
};
