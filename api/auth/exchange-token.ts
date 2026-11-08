import { serialize } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';

const ENV_OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID?.trim();
const OAUTH_CLIENT_ID =
    ENV_OAUTH_CLIENT_ID && ENV_OAUTH_CLIENT_ID !== '33pC7qk8i9WtRbTbSOkcq'
        ? ENV_OAUTH_CLIENT_ID
        : '34J0u7zObmeCX5lnl8zm7';

const resolveTokenEndpoint = (envValue: string | undefined): string => {
    const trimmed = envValue?.trim();
    if (!trimmed || trimmed.includes('oauth.deriv.com')) {
        return 'https://auth.deriv.com/oauth2/token';
    }
    return trimmed;
};

// Canonical redirect URI must match the registered OAuth redirect exactly.
const REDIRECT_URI = process.env.REDIRECT_URI?.trim() || 'https://www.dylantrades.site/callback';
const ALLOWED_PRODUCTION_ORIGINS = new Set([
    'https://dylantrades.site',
    'https://www.dylantrades.site',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Allow', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body: any = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            try {
                const params = new URLSearchParams(body);
                body = {
                    code: params.get('code'),
                    code_verifier: params.get('code_verifier'),
                    redirect_uri: params.get('redirect_uri'),
                };
            } catch {
                body = {};
            }
        }
    }

    const { code, code_verifier, redirect_uri } = body || {};

    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    // Enforce a safe redirect URI for the OAuth flow.
    try {
        const incoming = new URL(redirect_uri);
        const incoming_path = incoming.pathname.replace(/\/$/, '') || '/callback';
        const origin_header = typeof req.headers.origin === 'string' ? req.headers.origin : null;
        const forwarded_host =
            (typeof req.headers['x-forwarded-host'] === 'string' && req.headers['x-forwarded-host'].split(',')[0].trim()) ||
            (typeof req.headers.host === 'string' ? req.headers.host.trim() : null);
        const forwarded_proto =
            (typeof req.headers['x-forwarded-proto'] === 'string' && req.headers['x-forwarded-proto'].split(',')[0].trim()) ||
            'https';
        const derived_origin = forwarded_host ? `${forwarded_proto}://${forwarded_host}` : null;

        const allowed_localhost = incoming.hostname === 'localhost' || incoming.hostname === '127.0.0.1';
        const allowed_vercel_preview = incoming.protocol === 'https:' && incoming.hostname.endsWith('.vercel.app');
        const is_same_origin = Boolean(
            (origin_header && incoming.origin === origin_header) ||
                (derived_origin && incoming.origin === derived_origin)
        );

        const base = new URL(REDIRECT_URI);
        const base_path = base.pathname.replace(/\/$/, '') || '/callback';
        const origin_allowed =
            incoming.origin === base.origin ||
            ALLOWED_PRODUCTION_ORIGINS.has(incoming.origin) ||
            allowed_vercel_preview ||
            is_same_origin ||
            allowed_localhost;
        const allowed_paths = Array.from(new Set([base_path, '/callback']));

        if (!origin_allowed || !allowed_paths.includes(incoming_path)) {
            console.warn('Rejecting unexpected redirect_uri', {
                redirect_uri,
                allowed_origin: base.origin,
                incoming_origin: incoming.origin,
                incoming_path,
            });
            return res.status(400).json({ error: 'Invalid redirect_uri' });
        }
    } catch (err) {
        console.warn('Invalid redirect_uri format', { redirect_uri, err });
        return res.status(400).json({ error: 'Invalid redirect_uri' });
    }

    try {
        const tokenEndpoint = resolveTokenEndpoint(process.env.DERIV_TOKEN_URL);
        console.log('🔑 [Backend] Deriv token exchange request:', {
            tokenEndpoint,
            client_id: OAUTH_CLIENT_ID,
            code: String(code).substring(0, 20) + '...',
            redirect_uri,
            code_verifier: String(code_verifier).substring(0, 20) + '...',
        });

        const tokenResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: OAUTH_CLIENT_ID,
                code,
                code_verifier,
                redirect_uri,
            }).toString(),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            let errorData: any = null;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = null;
            }

            console.error('Token exchange failed:', {
                status: tokenResponse.status,
                body: errorData ?? errorText,
                sent_params: {
                    client_id: OAUTH_CLIENT_ID,
                    redirect_uri,
                    code: String(code).substring(0, 10) + '...',
                    code_verifier: String(code_verifier).substring(0, 10) + '...',
                },
            });

            return res.status(400).json({
                error: 'Token exchange failed',
                error_description:
                    errorData?.error_description ||
                    errorData?.message ||
                    errorText ||
                    `HTTP Status ${tokenResponse.status}`,
                deriv_response: errorData ?? errorText,
                debug_info: {
                    client_id: OAUTH_CLIENT_ID,
                    redirect_uri,
                },
            });
        }

        const tokenData = await tokenResponse.json();
        const { access_token, expires_in } = tokenData;

        if (access_token) {
            const cookieOptions = {
                httpOnly: true,
                secure: true,
                sameSite: 'lax' as const,
                ...(typeof expires_in === 'number' ? { maxAge: expires_in } : {}),
                path: '/',
            };
            res.setHeader('Set-Cookie', serialize('access_token', access_token, cookieOptions));
        }

        return res.status(200).json(tokenData);
    } catch (error) {
        console.error('Error exchanging token:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
