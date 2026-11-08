import { getAppId, getSocketURL, getPublicWebSocketURL } from '@/components/shared/utils/config/config';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

const normalizeSocket = (socketUrl) => {
    if (!socketUrl) return '';
    if (socketUrl.startsWith('wss://') || socketUrl.startsWith('ws://')) return socketUrl;
    if (socketUrl.includes('/')) return `wss://${socketUrl}`;
    return '';
};

export const generateDerivApiInstance = (custom_ws_url) => {
    const appId = getAppId();
    const socketUrl = custom_ws_url || getSocketURL();
    const normalizedUrl = normalizeSocket(socketUrl);
    const finalUrl = normalizedUrl || getPublicWebSocketURL(appId);
    const deriv_socket = new WebSocket(finalUrl);
    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
    return deriv_api;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveToken = () => {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null') return token;

    try {
        const active_loginid = getLoginId();
        const account_list = JSON.parse(localStorage.getItem('accountsList') || '{}');
        if (active_loginid && account_list?.[active_loginid]) {
            return account_list[active_loginid];
        }
    } catch {
        // ignore JSON parse errors
    }

    return null;
};

export const V2GetActiveClientId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;

    const token = V2GetActiveToken();

    if (!token) return null;
    try {
        const account_list = JSON.parse(localStorage.getItem('accountsList') || '{}');
        if (account_list && typeof account_list === 'object') {
            const active_clientId = Object.keys(account_list).find(key => account_list[key] === token);
            return active_clientId || null;
        }
    } catch {
        // ignore JSON parse errors
    }
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    let resolvedToken;
    try {
        const client_accounts = JSON.parse(localStorage.getItem('accountsList') || '{}');
        resolvedToken = (active_loginid && client_accounts?.[active_loginid]) || undefined;
    } catch {
        resolvedToken = undefined;
    }
    if (!resolvedToken) {
        resolvedToken = V2GetActiveToken() || undefined;
    }
    return {
        token: typeof resolvedToken === 'string' && resolvedToken ? resolvedToken : undefined,
        account_id: active_loginid ?? undefined,
    };
};
