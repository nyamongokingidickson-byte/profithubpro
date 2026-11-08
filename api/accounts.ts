import { parse } from 'cookie';
import { NextApiRequest, NextApiResponse } from 'next';

const APP_ID = process.env.APP_ID || process.env.OAUTH_CLIENT_ID || process.env.LEGACY_APP_ID || '34J0u7zObmeCX5lnl8zm7';

function getAccessTokenFromRequest(req: NextApiRequest): string | null {
    const authorization = req.headers.authorization;
    if (authorization && authorization.startsWith('Bearer ')) {
        return authorization.replace('Bearer ', '');
    }

    const cookies = parse(req.headers.cookie || '');
    return cookies.access_token || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const accessToken = getAccessTokenFromRequest(req);
    if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Deriv-App-ID': APP_ID,
            },
        });

        if (!accountsResponse.ok) {
            const errorData = await accountsResponse.text();
            console.error('Accounts request failed:', errorData);
            return res.status(accountsResponse.status).json({ error: 'Failed to get accounts' });
        }

        const accountsData = await accountsResponse.json();
        res.status(200).json(accountsData);
    } catch (error) {
        console.error('Error getting accounts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}