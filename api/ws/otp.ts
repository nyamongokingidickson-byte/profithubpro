import { parse } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';

const APP_ID = process.env.APP_ID || process.env.LEGACY_APP_ID || '113536';

function getAccessTokenFromRequest(req: NextApiRequest): string | null {
    const authorization = req.headers.authorization;
    if (authorization && authorization.startsWith('Bearer ')) {
        return authorization.replace('Bearer ', '');
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

    const { accountId } = req.body;
    if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
    }

    try {
        const otpResponse = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Deriv-App-ID': APP_ID,
            },
        });

        if (!otpResponse.ok) {
            const errorData = await otpResponse.text();
            console.error('OTP request failed:', errorData);
            return res.status(otpResponse.status).json({ error: 'Failed to get OTP' });
        }

        const otpData = await otpResponse.json();
        res.status(200).json(otpData);
    } catch (error) {
        console.error('Error getting OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}