'use strict';

const MAX_BODY_BYTES = 16 * 1024;

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

async function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'object') return req.body;
        if (typeof req.body === 'string') {
            if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) throw new Error('Body too large');
            return req.body ? JSON.parse(req.body) : {};
        }
    }
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('Body too large');
    }
    return raw ? JSON.parse(raw) : {};
}

function reply(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(payload));
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

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
        return reply(res, 401, { error: 'Not authenticated' });
    }

    let body;
    try {
        body = await readBody(req);
    } catch {
        return reply(res, 400, { error: 'Invalid JSON body' });
    }

    const accountId = body?.accountId || body?.account_id;
    if (!accountId || !/^[A-Za-z0-9_-]+$/.test(String(accountId))) {
        return reply(res, 400, { error: 'Valid accountId is required' });
    }

    try {
        const otpResponse = await fetch(
            `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(String(accountId))}/otp`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(15000),
            }
        );

        const rawText = await otpResponse.text();
        let otpData = null;
        try {
            otpData = rawText ? JSON.parse(rawText) : {};
        } catch {
            otpData = null;
        }

        if (!otpResponse.ok) {
            return reply(res, otpResponse.status, {
                error: 'Failed to get OTP',
                details: otpData || rawText,
            });
        }

        const safeData = otpData && typeof otpData === 'object' ? otpData : {};
        const resolvedUrl =
            safeData?.data?.url || safeData?.ws_url || safeData?.wsUrl || safeData?.url || '';

        return reply(res, 200, {
            ...safeData,
            url: resolvedUrl,
            ws_url: resolvedUrl,
            wsUrl: resolvedUrl,
        });
    } catch (error) {
        console.error('Error getting OTP:', error);
        return reply(res, 502, { error: 'Failed to reach Deriv OTP service' });
    }
};
