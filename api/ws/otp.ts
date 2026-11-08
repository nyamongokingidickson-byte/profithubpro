import { parse } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';

function getAccessTokenFromRequest(req: NextApiRequest): string | null {
    const authorization = req.headers.authorization;
    if (authorization && authorization.startsWith('Bearer ')) {
        return authorization.replace('Bearer ', '').trim();
    }

    const cookies = parse(req.headers.cookie || '');
    return cookies.access_token || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    let body: any = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = {};
        }
    }

    const accountId = body?.accountId || body?.account_id;
    if (!accountId || !/^[A-Za-z0-9_-]+$/.test(String(accountId))) {
        return res.status(400).json({ error: 'Valid accountId is required' });
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
            }
        );

        if (!otpResponse.ok) {
            const errorData = await otpResponse.text();
            console.error('OTP request failed:', otpResponse.status, errorData);
            return res.status(otpResponse.status).json({
                error: 'Failed to get OTP',
                details: errorData,
            });
        }

        const otpData = await otpResponse.json();
        const resolvedUrl =
            otpData?.data?.url || otpData?.ws_url || otpData?.wsUrl || otpData?.url || '';

        return res.status(200).json({
            ...otpData,
            url: resolvedUrl,
            ws_url: resolvedUrl,
            wsUrl: resolvedUrl,
        });
    } catch (error) {
        console.error('Error getting OTP:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
