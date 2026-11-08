import Cookies from 'js-cookie';
import { getRedirectUri } from '@/components/shared/utils/config/config';
import derivApiService from '@/lib/deriv-api-service';
import {
    clearPKCEVerifier,
    popPKCEVerifier,
    retrieveOAuthRedirectUri,
    validatePKCEState,
} from '../utils/pkce';

const isVirtualAccount = (accountId: string, accountType?: string): boolean => {
    return (
        accountType === 'demo' ||
        accountId.startsWith('VR') ||
        accountId.startsWith('DOT')
    );
};

async function fetchAccountsWithRetry(accessToken: string): Promise<Response> {
    const requestInit: RequestInit = {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    };
    const firstResponse = await fetch('/api/accounts', requestInit);
    if (firstResponse.status === 503) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        return fetch('/api/accounts', requestInit);
    }
    return firstResponse;
}

export async function startLogin(): Promise<void> {
    try {
        const { generateOAuthURL } = await import('@/components/shared/utils/config/config');
        const url = await generateOAuthURL();
        if (!url) {
            throw new Error('OAuth URL generation returned an empty value');
        }
        window.location.href = url;
    } catch (error) {
        console.error('Failed to start login:', error);
        throw error;
    }
}

export async function startSignup(): Promise<void> {
    try {
        const { generateOAuthURL } = await import('@/components/shared/utils/config/config');
        const url = await generateOAuthURL('registration');
        if (!url) {
            throw new Error('OAuth URL generation returned an empty value');
        }
        window.location.href = url;
    } catch (error) {
        console.error('Failed to start signup:', error);
        throw error;
    }
}

export async function handleCallback(): Promise<{ success: boolean; error?: string }> {
    console.log('📍 [Frontend] Callback handler triggered');

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    if (error) {
        console.error('❌ [Frontend] OAuth error:', error, errorDescription);
        clearPKCEVerifier();
        return { success: false, error: errorDescription || error };
    }

    if (!code || !state) {
        console.error('❌ [Frontend] Missing code or state:', { code: !!code, state: !!state });
        return { success: false, error: 'Missing code or state parameter' };
    }

    if (!validatePKCEState(state)) {
        console.error('❌ [Frontend] State validation failed');
        clearPKCEVerifier();
        return { success: false, error: 'State mismatch. Please try signing in again.' };
    }

    const codeVerifier = popPKCEVerifier();
    if (!codeVerifier) {
        console.error('❌ [Frontend] Code verifier not found in storage');
        clearPKCEVerifier();
        return { success: false, error: 'PKCE code verifier not found. Please try signing in again.' };
    }

    // Use the exact redirect_uri stored when starting the authorization flow
    const redirect_uri = retrieveOAuthRedirectUri() || getRedirectUri();

    try {
        const response = await fetch('/api/auth/exchange-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code,
                code_verifier: codeVerifier,
                redirect_uri,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            clearPKCEVerifier();
            return {
                success: false,
                error: errorData.error_description || errorData.error || 'Token exchange failed',
            };
        }

        const tokenData = await response.json();
        const access_token = tokenData.access_token || tokenData.accessToken;
        const refresh_token = tokenData.refresh_token || tokenData.refreshToken;

        if (!access_token) {
            clearPKCEVerifier();
            return { success: false, error: 'Access token was not returned' };
        }

        localStorage.setItem('authToken', access_token);
        if (refresh_token) {
            localStorage.setItem('refreshToken', refresh_token);
        }

        try {
            const accountsResponse = await fetchAccountsWithRetry(access_token);

            if (accountsResponse.ok) {
                const accountsData = await accountsResponse.json();
                const accountsList: Record<string, string> = {};
                const clientAccounts: Record<
                    string,
                    {
                        loginid: string;
                        token: string;
                        currency: string;
                        balance: number;
                        is_virtual: number;
                        account_type?: string;
                    }
                > = {};

                if (Array.isArray(accountsData?.data)) {
                    accountsData.data.forEach(
                        (account: {
                            account_id: string;
                            account_type?: string;
                            currency?: string;
                            balance?: number;
                        }) => {
                            if (account.account_id) {
                                const virtualFlag = isVirtualAccount(account.account_id, account.account_type) ? 1 : 0;
                                accountsList[account.account_id] = access_token;
                                clientAccounts[account.account_id] = {
                                    loginid: account.account_id,
                                    token: access_token,
                                    currency: account.currency || 'USD',
                                    balance: Number(account.balance ?? 0),
                                    is_virtual: virtualFlag,
                                    account_type: account.account_type,
                                };
                            }
                        }
                    );
                }

                const accountIds = Object.keys(accountsList);
                if (accountIds.length > 0) {
                    localStorage.setItem('accountsList', JSON.stringify(accountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                    const preferredDemoId = accountIds.find(id => clientAccounts[id]?.is_virtual === 1);
                    localStorage.setItem('active_loginid', preferredDemoId || accountIds[0]);
                }
            } else {
                const errText = await accountsResponse.text();
                console.error(
                    '❌ [Frontend] Accounts fetch failed with status:',
                    accountsResponse.status,
                    'body:',
                    errText
                );
            }
        } catch (accountsError) {
            console.error('❌ [Frontend] Failed to fetch Deriv accounts after token exchange:', accountsError);
        }

        Cookies.set('logged_state', 'true', { path: '/' });
        clearPKCEVerifier();

        return { success: true };
    } catch (err) {
        console.error('Error exchanging token:', err);
        clearPKCEVerifier();
        return { success: false, error: 'Network error during token exchange' };
    }
}

export async function connectAuthenticatedWebSocket(accountId: string): Promise<boolean> {
    const accessToken = localStorage.getItem('authToken');
    if (!accessToken) {
        console.error('No authorization token found');
        return false;
    }

    try {
        const response = await fetch('/api/ws/otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ accountId }),
        });

        if (!response.ok) {
            console.error('Failed to get OTP url:', response.statusText);
            return false;
        }

        const data = await response.json();
        const wsUrl = data?.data?.url || data?.ws_url || data?.wsUrl || data?.url;
        if (!wsUrl) {
            console.error('No ws_url returned from OTP endpoint', data);
            return false;
        }

        derivApiService.connectWithOtp(wsUrl);
        return true;
    } catch (e) {
        console.error('Failed to establish authenticated WebSocket connection:', e);
        return false;
    }
}
