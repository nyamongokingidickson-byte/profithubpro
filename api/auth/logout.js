'use strict';

module.exports = async function handler(req, res) {
    res.setHeader('Allow', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', 'access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.end(JSON.stringify({ ok: true }));
};
