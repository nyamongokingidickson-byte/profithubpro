import { getPublicWebSocketURL, getSocketURL as getSocketURLFromConfig } from '@/components/shared/utils/config/config';

export const getValidatedWebSocketURL = (appId: number | string, serverUrl?: string) => {
    const fallback = getPublicWebSocketURL(appId);

    const candidate = (serverUrl && serverUrl.trim()) || getSocketURLFromConfig();
    if (!candidate) return fallback;

    try {
        let urlStr = candidate;
        // If scheme missing, assume wss
        if (!/^wss?:\/\//i.test(urlStr)) {
            urlStr = `wss://${urlStr}`;
        }

        const u = new URL(urlStr);

        // Ensure using websocket scheme
        if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
            u.protocol = 'wss:';
        }

        const params = new URLSearchParams(u.search);
        if (!params.has('app_id')) params.set('app_id', String(appId));
        u.search = params.toString();

        const final = u.toString();

        // Basic sanity: must contain ws in path or host
        if (!/ws/i.test(final)) {
            console.warn('[deriv-url] sanity check failed for url, falling back', final);
            return fallback;
        }

        return final;
    } catch (e) {
        console.error('[deriv-url] invalid serverUrl, using fallback', candidate, e);
        return fallback;
    }
};

export default getValidatedWebSocketURL;
