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

export const generateDerivApiInstance = () => {
    const appId = getAppId();
    const socketUrl = getSocketURL();
    const normalizedUrl = normalizeSocket(socketUrl);
    const finalUrl = normalizedUrl || getPublicWebSocketURL(Number(appId));

    window.debugSocketUrl = finalUrl;
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
    return null;
};

export const V2GetActiveClientId = () => {
    const token = V2GetActiveToken();

    if (!token) return null;
    const account_list = JSON.parse(localStorage.getItem('accountsList'));
    if (account_list && account_list !== 'null') {
        const active_clientId = Object.keys(account_list).find(key => account_list[key] === token);
        return active_clientId;
    }
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
