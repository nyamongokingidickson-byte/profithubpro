export function connectPublicWS(): WebSocket {
    return new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
}

export async function getAuthenticatedWSUrl(accountId: string): Promise<string> {
    const authToken = localStorage.getItem('authToken');
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch('/api/ws/otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ accountId }),
    });

    if (!response.ok) {
        throw new Error('Failed to get OTP URL');
    }

    const data = await response.json();
    const resolvedUrl = data?.data?.url || data?.ws_url || data?.wsUrl || data?.url;
    if (!resolvedUrl) {
        throw new Error('OTP response did not contain a WebSocket URL');
    }
    return resolvedUrl;
}

export function connectAuthenticatedWS(otpUrl: string): WebSocket {
    return new WebSocket(otpUrl);
}
