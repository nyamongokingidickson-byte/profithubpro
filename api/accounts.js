'use strict';

function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') return out;
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key && out[key] === undefined) {
            try {
                out[key] = decodeURIComponent(val);
            } catch {
                out[key] = val;
            }
        }
    }
    return out;
}

function getAccessTokenFromRequest(req) {
    const authorization = req.headers?.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        return authorization.slice('Bearer '.length).trim();
    }
    const cookies = parseCookies(req.headers?.cookie || '');
    return cookies.access_token || null;
}

function reply(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
    res.setHeader('Allow', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    if (req.method !== 'GET') {
        return reply(res, 405, { error: 'Method not allowed' });
    }

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
        return reply(res, 401, { error: 'Not authenticated' });
    }

    try {
        const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });

        const rawText = await accountsResponse.text();
        let data = null;
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch {
            data = null;
        }

        if (!accountsResponse.ok) {
            return reply(res, accountsResponse.status, {
                error: 'Failed to get accounts',
                details: data || rawText,
            });
        }

        return reply(res, 200, data || { data: [] });
    } catch (error) {
        console.error('Error getting accounts:', error);
        return reply(res, 502, { error: 'Failed to reach Deriv accounts service' });
    }
};
