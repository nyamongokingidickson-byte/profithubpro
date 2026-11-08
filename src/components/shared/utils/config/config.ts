import { createCodeChallenge, createCodeVerifier, createState, storePKCEState, clearPKCEVerifier } from '@/utils/pkce';
import { isStaging } from '../url/helpers';

const resolveAuthEndpoint = (envValue: string | undefined, fallback: string) => {
    const trimmed = envValue?.trim();
    if (!trimmed || trimmed.includes('oauth.deriv.com')) {
        return fallback;
    }
    return trimmed;
};

export const DERIV_API_REST_BASE = process.env.DERIV_API_REST_BASE || 'https://api.derivws.com/trading/v1/options';
export const DERIV_OAUTH_URL = resolveAuthEndpoint(process.env.DERIV_OAUTH_URL, 'https://auth.deriv.com/oauth2/auth');
export const DERIV_OAUTH_TOKEN_URL = resolveAuthEndpoint(
    process.env.DERIV_TOKEN_URL,
    'https://auth.deriv.com/oauth2/token'
);
export const DERIV_OAUTH_REVOKE_URL = resolveAuthEndpoint(
    process.env.DERIV_OAUTH_REVOKE_URL,
    'https://auth.deriv.com/oauth2/revoke'
);
export const DERIV_WS_PUBLIC_URL = process.env.DERIV_WS_PUBLIC_URL || 'wss://api.derivws.com/trading/v1/options/ws/public';
export const DERIV_NEW_AUTH_URL = DERIV_OAUTH_URL;
export const DERIV_NEW_TOKEN_URL = DERIV_OAUTH_TOKEN_URL;

export const APP_IDS = {
    LOCALHOST: '34J0u7zObmeCX5lnl8zm7',
    TMP_STAGING: '34J0u7zObmeCX5lnl8zm7',
    STAGING: '34J0u7zObmeCX5lnl8zm7',
    STAGING_BE: '34J0u7zObmeCX5lnl8zm7',
    STAGING_ME: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION_BE: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION_ME: '34J0u7zObmeCX5lnl8zm7',
    DYLANTRADES: '34J0u7zObmeCX5lnl8zm7',
};

export const livechat_license_id = 12049137;
export const livechat_client_id = '66aa088aad5a414484c1fd1fa8a5ace7';

export const domain_app_ids = {
    'dylantrades.site': APP_IDS.DYLANTRADES,
    'www.dylantrades.site': APP_IDS.DYLANTRADES,
};

const LEGACY_APP_ID_STORAGE_KEY = 'config.legacy_app_id';
const LEGACY_APP_ID_ENV = process.env.LEGACY_APP_ID?.trim();
const LEGACY_MODE_STORAGE_KEY = 'config.enable_legacy_mode';

export const normalizeDomain = (hostname: string) =>
    hostname
        ?.toLowerCase()
        .trim()
        .replace(/^www\./, '');

export const getCurrentProductionDomain = () => {
    const normalized_hostname = normalizeDomain(window.location.hostname);
    if (/^staging\./.test(normalized_hostname)) return undefined;
    return Object.keys(domain_app_ids).find(domain => normalizeDomain(domain) === normalized_hostname);
};

export const isProduction = () => {
    const normalized_hostname = normalizeDomain(window.location.hostname);
    return Object.keys(domain_app_ids).some(domain => normalizeDomain(domain) === normalized_hostname);
};

export const isTestLink = () => {
    return (
        window.location.origin?.includes('.binary.sx') ||
        window.location.origin?.includes('bot-65f.pages.dev') ||
        isLocal()
    );
};

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

export const getLegacyAppId = (): number | string | null => {
    const storedLegacy = window.localStorage.getItem(LEGACY_APP_ID_STORAGE_KEY)?.trim();
    const legacySource = storedLegacy || LEGACY_APP_ID_ENV;
    if (!legacySource || legacySource === '113536') return null;
    return /^[0-9]+$/.test(legacySource) ? Number(legacySource) : legacySource;
};

export const isLegacyModeEnabled = (): boolean => {
    const storedLegacyMode = window.localStorage.getItem(LEGACY_MODE_STORAGE_KEY);
    return (
        storedLegacyMode === '1' ||
        storedLegacyMode === 'true' ||
        (!!LEGACY_APP_ID_ENV && LEGACY_APP_ID_ENV !== '113536')
    );
};

const getDefaultServerURL = () => {
    const server = 'ws';
    const server_url = `${server}.derivws.com`;

    return server_url;
};

export const getDefaultAppIdAndUrl = () => {
    const current_domain = getCurrentProductionDomain() ?? '';
    const app_id = domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;
    const server_url = getPublicWebSocketURL(app_id);

    if (isTestLink()) {
        return { app_id: APP_IDS.LOCALHOST, server_url };
    }

    return { app_id, server_url };
};

export const getAppId = (): number | string => {
    // If legacy mode is enabled, use legacy app ID
    if (isLegacyModeEnabled()) {
        const legacyAppId = getLegacyAppId();
        if (legacyAppId) {
            console.log('🔐 [Frontend] Using legacy app ID:', legacyAppId);
            return legacyAppId;
        }
    }

    const env_app_id = process.env.APP_ID?.trim();
    if (env_app_id && env_app_id !== '113536') {
        return env_app_id;
    }

    // Check localStorage first for user-configured app ID (ignoring stale defaults/NaN)
    const stored_app_id = window.localStorage.getItem('config.app_id')?.trim();
    if (
        stored_app_id &&
        stored_app_id !== 'NaN' &&
        stored_app_id !== 'null' &&
        stored_app_id !== 'undefined' &&
        stored_app_id !== '113536' &&
        /^[A-Za-z0-9_-]+$/.test(stored_app_id)
    ) {
        return stored_app_id;
    }

    let app_id: number | string;
    const current_domain = getCurrentProductionDomain() ?? '';

    if (isStaging()) {
        app_id = APP_IDS.STAGING;
    } else if (isTestLink()) {
        app_id = APP_IDS.LOCALHOST;
    } else {
        app_id = domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;
    }

    window.localStorage.setItem('config.app_id', app_id.toString());
    return app_id;
};

export const getSocketURL = () => {
    const local_storage_server_url = window.localStorage.getItem('config.server_url');
    if (local_storage_server_url) {
        if (local_storage_server_url.startsWith('wss://')) {
            return local_storage_server_url;
        }
        return `wss://${local_storage_server_url}/trading/v1/options/ws/public?app_id=${getAppId()}`;
    }

    return getPublicWebSocketURL(getAppId());
};

export const getPublicWebSocketURL = (appId: number | string) => {
    return `${DERIV_WS_PUBLIC_URL}?app_id=${appId}`;
};

export const getDemoWebSocketURL = (appId: number | string) => {
    return `wss://api.derivws.com/trading/v1/options/ws/demo?app_id=${appId}`;
};

export const getRealWebSocketURL = (appId: number | string) => {
    return `wss://api.derivws.com/trading/v1/options/ws/real?app_id=${appId}`;
};

export const checkAndSetEndpointFromUrl = () => {
    if (isTestLink()) {
        const url_params = new URLSearchParams(location.search.slice(1));

        if (url_params.has('qa_server') && url_params.has('app_id')) {
            const qa_server = url_params.get('qa_server') || '';
            const app_id = url_params.get('app_id') || '';

            url_params.delete('qa_server');
            url_params.delete('app_id');

            if (/^(^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com)$/.test(qa_server) && /^[A-Za-z0-9_-]+$/.test(app_id)) {
                localStorage.setItem('config.app_id', app_id);
                localStorage.setItem('config.server_url', qa_server.replace(/"/g, ''));
            }

            const params = url_params.toString();
            const hash = location.hash;

            location.href = `${location.protocol}//${location.hostname}${location.pathname}${
                params ? `?${params}` : ''
            }${hash || ''}`;

            return true;
        }
    }

    return false;
};

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag = window.localStorage.getItem('debug_service_worker');
    if (debug_service_worker_flag) return !!parseInt(debug_service_worker_flag);

    return false;
};

const ENV_OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID?.trim();
const OAUTH_CLIENT_ID =
    ENV_OAUTH_CLIENT_ID && ENV_OAUTH_CLIENT_ID !== '33pC7qk8i9WtRbTbSOkcq'
        ? ENV_OAUTH_CLIENT_ID
        : '34J0u7zObmeCX5lnl8zm7';
const REDIRECT_URI = process.env.REDIRECT_URI?.trim();
const OAUTH_SCOPE = process.env.OAUTH_SCOPE?.trim() || 'trade';

export const getClientId = () => {
    return OAUTH_CLIENT_ID;
};

export const getRedirectUri = () => {
    if (isLocal()) {
        const origin = window.location.origin;
        return `${origin}/callback`;
    }

    if (REDIRECT_URI) {
        return REDIRECT_URI;
    }

    if (
        typeof window !== 'undefined' &&
        (window.location.hostname === 'dylantrades.site' || window.location.hostname === 'www.dylantrades.site')
    ) {
        return 'https://dylantrades.site/callback';
    }

    const origin = window.location.origin;
    return `${origin}/callback`;
};

export const generateOAuthURL = async (prompt?: string) => {
    const client_id = getClientId();
    const redirect_uri = getRedirectUri();
    const code_verifier = createCodeVerifier();
    const code_challenge = await createCodeChallenge(code_verifier);
    const state = createState();

    // Clear any stale PKCE values before storing a fresh login attempt
    clearPKCEVerifier();
    storePKCEState(code_verifier, state, redirect_uri);

    console.log('🔐 [Frontend] PKCE State stored:', {
        state,
        code_verifier: code_verifier.substring(0, 20) + '...',
        code_challenge: code_challenge.substring(0, 20) + '...',
        redirect_uri,
    });

    const params = new URLSearchParams({
        response_type: 'code',
        client_id,
        redirect_uri,
        scope: OAUTH_SCOPE,
        state,
        code_challenge,
        code_challenge_method: 'S256',
    });

    if (prompt) {
        params.set('prompt', prompt);
    }

    const oauthUrl = `${DERIV_OAUTH_URL}?${params.toString()}`;

    console.log('🔐 [Frontend] Full OAuth URL:', oauthUrl.substring(0, 100) + '...');

    return oauthUrl;
};
