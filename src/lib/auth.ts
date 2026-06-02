import Cookies from 'js-cookie';
import { getAppId, getRedirectUri } from '@/components/shared/utils/config/config';
import { clearPKCEVerifier, popPKCEVerifier, validatePKCEState } from '@/utils/pkce';
import derivApiService from '@/lib/deriv-api-service';

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
    console.log('📍 [Frontend] URL:', window.location.href);
    console.log('📍 [Frontend] Search params:', window.location.search);
    
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    console.log('📍 [Frontend] Parsed params:', {
        code: code ? code.substring(0, 20) + '...' : 'null',
        state: state ? state.substring(0, 20) + '...' : 'null',
        error,
        errorDescription
    });

    if (error) {
        console.error('❌ [Frontend] OAuth error:', error, errorDescription);
        return { success: false, error: errorDescription || error };
    }

    if (!code || !state) {
        console.error('❌ [Frontend] Missing code or state:', { code: !!code, state: !!state });
        return { success: false, error: 'Missing code or state parameter' };
    }

    if (!validatePKCEState(state)) {
        const savedState = sessionStorage.getItem('oauth_state');
        console.error('❌ [Frontend] State validation failed', {
            incomingState: state,
            savedState,
        });
        clearPKCEVerifier();
        return { success: false, error: 'State mismatch' };
    }

    const codeVerifier = popPKCEVerifier();
    if (!codeVerifier) {
        console.error('❌ [Frontend] Code verifier not found in sessionStorage');
        return { success: false, error: 'Code verifier not found' };
    }

    try {
        const redirect_uri = getRedirectUri();
        const code_verifier_short = codeVerifier.substring(0, 20) + '...';
        console.log('📤 [Frontend] Sending to /api/auth/exchange-token:', {
            code: code.substring(0, 20) + '...',
            code_verifier: code_verifier_short,
            redirect_uri,
        });
        // Use our server-side exchange endpoint to avoid CORS issues and to allow the server to set HTTP-only cookies
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
            return {
                success: false,
                error: errorData.error_description || errorData.error || 'Token exchange failed',
            };
        }

        const tokenData = await response.json();
        const access_token = tokenData.access_token || tokenData.accessToken;
        const refresh_token = tokenData.refresh_token || tokenData.refreshToken;

        if (!access_token) {
            return { success: false, error: 'Access token was not returned' };
        }

        localStorage.setItem('authToken', access_token);
        if (refresh_token) {
            localStorage.setItem('refreshToken', refresh_token);
        }

        try {
            console.log('📡 [Frontend] Fetching Deriv accounts using proxy...', {
                token_preview: access_token.substring(0, 15) + '...'
            });
            const accountsResponse = await fetch('/api/accounts', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${access_token}`,
                },
            });

            console.log('📡 [Frontend] Accounts response status:', accountsResponse.status);

            if (accountsResponse.ok) {
                const accountsData = await accountsResponse.json();
                console.log('📡 [Frontend] Accounts data received:', accountsData);
                const accountsList: Record<string, string> = {};
                const clientAccounts: Record<string, { loginid: string; token: string; currency: string; balance: number }> = {};

                if (Array.isArray(accountsData?.data)) {
                    accountsData.data.forEach((account: { account_id: string; currency?: string; balance?: number }) => {
                        if (account.account_id) {
                            accountsList[account.account_id] = access_token;
                            clientAccounts[account.account_id] = {
                                loginid: account.account_id,
                                token: access_token,
                                currency: account.currency || '',
                                balance: account.balance || 0,
                            };
                        }
                    });
                } else {
                    console.warn('⚠️ [Frontend] accountsData.data is not an array:', accountsData?.data);
                }

                console.log('📡 [Frontend] Processed accounts:', {
                    accountsListKeys: Object.keys(accountsList),
                    clientAccountsKeys: Object.keys(clientAccounts)
                });

                if (Object.keys(accountsList).length > 0) {
                    localStorage.setItem('accountsList', JSON.stringify(accountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                    const firstAccountId = Object.keys(accountsList)[0];
                    if (firstAccountId) {
                        localStorage.setItem('active_loginid', firstAccountId);
                    }
                    console.log('✅ [Frontend] Saved accounts and active login ID to localStorage');
                } else {
                    console.error('❌ [Frontend] No accounts found to save in localStorage');
                }
            } else {
                const errText = await accountsResponse.text();
                console.error('❌ [Frontend] Accounts fetch failed with status:', accountsResponse.status, 'body:', errText);
            }
        } catch (accountsError) {
            console.error('❌ [Frontend] Failed to fetch Deriv accounts after token exchange:', accountsError);
        }

        Cookies.set('logged_state', 'true', { path: '/' });
        clearPKCEVerifier();

        return { success: true };
    } catch (err) {
        console.error('Error exchanging token:', err);
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
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ accountId }),
        });

        if (!response.ok) {
            console.error('Failed to get OTP url:', response.statusText);
            return false;
        }

        const data = await response.json();
        const wsUrl = data.ws_url || data.wsUrl;
        if (!wsUrl) {
            console.error('No ws_url returned from OTP endpoint', data);
            return false;
        }

        console.log('Connecting DerivApiService using OTP ws_url...');
        derivApiService.connectWithOtp(wsUrl);
        return true;
    } catch (e) {
        console.error('Failed to establish authenticated WebSocket connection:', e);
        return false;
    }
}
