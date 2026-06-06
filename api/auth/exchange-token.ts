import { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || '33pC7qk8i9WtRbTbSOkcq';
// Canonical redirect URI must match the registered OAuth redirect exactly.
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://profithubpro.vercel.app/callback';

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
            } catch (e) {
                body = {};
            }
        }
    }

    const { code, code_verifier, redirect_uri } = body || {};

    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    // Enforce a safe redirect URI for the OAuth flow.
    // Allow the configured canonical redirect URI if provided, otherwise allow the current app origin if it matches the request origin.
        try {
            const incoming = new URL(redirect_uri);
            const incoming_path = incoming.pathname.replace(/\/$/, '') || '/callback';
            const origin_header = typeof req.headers.origin === 'string' ? req.headers.origin : null;
            const allowed_localhost = incoming.hostname === 'localhost' || incoming.hostname === '127.0.0.1';

            if (REDIRECT_URI) {
                const base = new URL(REDIRECT_URI);
                const base_path = base.pathname.replace(/\/$/, '') || '/callback';
                const base_origin_matches = incoming.origin === base.origin || allowed_localhost;
                const allowed_paths = [base_path];

                if (!base_origin_matches || !allowed_paths.includes(incoming_path)) {
                    console.warn('Rejecting unexpected redirect_uri', {
                        redirect_uri,
                        allowed_origin: base.origin,
                        incoming_origin: incoming.origin,
                        incoming_path,
                    });
                    return res.status(400).json({ error: 'Invalid redirect_uri' });
                }
            } else if (origin_header) {
                const is_same_origin = incoming.origin === origin_header;
                if (!is_same_origin && !allowed_localhost) {
                    console.warn('Rejecting unexpected redirect_uri for dynamic callback', {
                        redirect_uri,
                        origin_header,
                        incoming_origin: incoming.origin,
                    });
                    return res.status(400).json({ error: 'Invalid redirect_uri' });
                }
                if (incoming_path !== '/callback') {
                    console.warn('Rejecting unexpected callback path', { redirect_uri, incoming_path });
                    return res.status(400).json({ error: 'Invalid redirect_uri' });
                }
            } else {
                console.warn('Missing origin header when validating redirect_uri', { redirect_uri });
                return res.status(400).json({ error: 'Invalid redirect_uri' });
            }
        } catch (err) {
            console.warn('Invalid redirect_uri format', { redirect_uri, err });
            return res.status(400).json({ error: 'Invalid redirect_uri' });
        }

    try {
        console.log('🔑 [Backend] Deriv token exchange request:', {
            client_id: OAUTH_CLIENT_ID,
            code: code.substring(0, 20) + '...',
            redirect_uri,
            code_verifier: code_verifier.substring(0, 20) + '...',
        });
        const tokenEndpoint = process.env.DERIV_TOKEN_URL || 'https://oauth.deriv.com/oauth2/token';
        const tokenResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: OAUTH_CLIENT_ID,
                code,
                code_verifier,
                // Use the same redirect_uri that was sent by the frontend
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
                    code: code.substring(0, 10) + '...',
                    code_verifier: code_verifier.substring(0, 10) + '...'
                }
            });

            return res.status(400).json({
                error: 'Token exchange failed',
                error_description: errorData?.error_description || errorData?.message || errorText || `HTTP Status ${tokenResponse.status}`,
                deriv_response: errorData ?? errorText,
                debug_info: {
                    client_id: OAUTH_CLIENT_ID,
                    redirect_uri,
                }
            });
        }

        const tokenData = await tokenResponse.json();
        const { access_token, expires_in } = tokenData;

        // Set HTTP-only cookie
        const cookieOptions = {
            httpOnly: true,
            secure: true,
            sameSite: 'lax' as const,
            maxAge: expires_in,
            path: '/',
        };

        res.setHeader('Set-Cookie', serialize('access_token', access_token, cookieOptions));

        // Return the token data to the client as well so front-end can store non-HTTP-only values if needed
        res.status(200).json(tokenData);
    } catch (error) {
        console.error('Error exchanging token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}