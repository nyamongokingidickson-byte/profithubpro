import { isStaging } from '../url/helpers';

export const DERIV_API_REST_BASE = 'https://api.derivws.com';
export const DERIV_OAUTH_URL = 'https://oauth.deriv.com/oauth2/authorize';
export const DERIV_OAUTH_TOKEN_URL = 'https://oauth.deriv.com/oauth2/token';
export const DERIV_OAUTH_REVOKE_URL = 'https://oauth.deriv.com/oauth2/revoke';
export const DERIV_NEW_AUTH_URL = DERIV_OAUTH_URL;
export const DERIV_NEW_TOKEN_URL = DERIV_OAUTH_TOKEN_URL;
export const API_MODE: 'legacy' | 'new' = 'new';

export const APP_IDS = {
    LOCALHOST: '34J0u7zObmeCX5lnl8zm7',
    TMP_STAGING: '34J0u7zObmeCX5lnl8zm7',
    STAGING: '34J0u7zObmeCX5lnl8zm7',
    STAGING_BE: '34J0u7zObmeCX5lnl8zm7',
    STAGING_ME: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION_BE: '34J0u7zObmeCX5lnl8zm7',
    PRODUCTION_ME: '34J0u7zObmeCX5lnl8zm7',
    VERCEL: '34J0u7zObmeCX5lnl8zm7',
};

export const livechat_license_id = 12049137;
export const livechat_client_id = '66aa088aad5a414484c1fd1fa8a5ace7';

export const domain_app_ids = {
    'master.bot-standalone.pages.dev': APP_IDS.TMP_STAGING,
    'staging-dbot.deriv.com': APP_IDS.STAGING,
    'staging-dbot.deriv.be': APP_IDS.STAGING_BE,
    'staging-dbot.deriv.me': APP_IDS.STAGING_ME,
    'dbot.deriv.com': APP_IDS.PRODUCTION,
    'dbot.deriv.be': APP_IDS.PRODUCTION_BE,
    'dbot.deriv.me': APP_IDS.PRODUCTION_ME,
    'dylantrades.site': '34J0u7zObmeCX5lnl8zm7',
    'www.dylantrades.site': '34J0u7zObmeCX5lnl8zm7',
};

export const getCurrentProductionDomain = () =>
    !/^staging\./.test(window.location.hostname) &&
    Object.keys(domain_app_ids).find(domain => window.location.hostname === domain);

export const isProduction = () => {
    const all_domains = Object.keys(domain_app_ids).map(domain => `(www\\.)?${domain.replace('.', '\\.')}`);
    return new RegExp(`^(${all_domains.join('|')})$`, 'i').test(window.location.hostname);
};

export const isTestLink = () => {
    return (
        window.location.origin?.includes('.binary.sx') ||
        window.location.origin?.includes('bot-65f.pages.dev') ||
        isLocal()
    );
};

export const isLocal = () =>
    /localhost(:\d+)?$|127\.0\.0\.1(:\d+)?$|0\.0\.0\.0(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    return 'ws.derivws.com';
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

export const getAppId = () => {
    // 1. Priority: Environment Variable (Deployment)
    const env_app_id =
        process.env.VITE_APP_ID ||
        (import.meta as unknown as { env: { VITE_APP_ID: string } }).env?.VITE_APP_ID ||
        process.env.REACT_APP_Deriv_APP_ID;

    if (env_app_id) {
        console.log('[Config] Using App ID from environment variable:', env_app_id);
        return String(env_app_id);
    }

    let app_id = null;
    const config_app_id = window.localStorage.getItem('config.app_id');
    const current_domain = getCurrentProductionDomain() ?? '';

    // 2. Priority: LocalStorage Override (Endpoint Page)
    if (config_app_id) {
        app_id = config_app_id;
    }
    // 3. Priority: Staging/Test Environments
    else if (isStaging()) {
        app_id = APP_IDS.STAGING;
    } else if (isTestLink()) {
        app_id = APP_IDS.LOCALHOST;
    }
    // 4. Priority: Production / Default
    else {
        app_id = domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;
    }

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
    return `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${appId}`;
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

            if (/^(^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com)$/.test(qa_server) && /^[0-9]+$/.test(app_id)) {
                localStorage.setItem('config.app_id', app_id);
                localStorage.setItem('config.server_url', qa_server.replace(/"/g, ''));
            }

            const params = url_params.toString();
            const hash = location.hash;

            location.href = `${location.protocol}//${location.hostname}${location.pathname}${params ? `?${params}` : ''
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

const legacyGenerateOAuthURL = () => {
    const is_local = isLocal();
    const app_id = is_local ? APP_IDS.LOCALHOST : getAppId();
    const login_url = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&brand=dylantrades&redirect=home&state=`;
 
    console.log('[Config] Generated Legacy OAuth URL:', login_url);
    return login_url;
};

export const generateOAuthURL = async () => {
    // Force legacy regardless of requested mode
    return legacyGenerateOAuthURL();
};
