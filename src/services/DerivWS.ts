import DerivAuth from './DerivAuth';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import { getValidatedWebSocketURL } from '@/services/deriv-url';

export type MessageHandler = (data: any) => void;
class DerivWS {
    private static _instance: DerivWS;
    private ws: WebSocket | null = null;
    private loginId: string | null = null;
    private handlers = new Map<string, MessageHandler>();
    private responseHandlers = new Map<string, (data: any) => void>();
    private requestCounter = 0;
    private subIndex = 0;
    // Subscription manager: canonicalKey -> { payload, reqId, callbacks, subscribed, lastMessageTime }
    private activeSubscriptions: Map<
        string,
        {
            payload: Record<string, any>;
            reqId?: string;
            callbacks: Set<MessageHandler>;
            subscribed: boolean;
            lastMessageTime?: number;
        }
    > = new Map();
    private visibilityTimeout: any = null;
    private openingPromise: Promise<void> | null = null;

    static get instance() {
        if (!this._instance) this._instance = new DerivWS();
        return this._instance;
    }

    private constructor() {
        if (typeof window !== 'undefined') {
            document.addEventListener('visibilitychange', () => this.onVisibilityChange());
        }
    }

    private getUrl() {
        const appId = getAppId();
        const serverUrl = getSocketURL();
        const validated = getValidatedWebSocketURL(appId, serverUrl);
        console.info('[DerivWS] Using WebSocket URL:', validated);
        return validated;
    }

    get isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    private onVisibilityChange() {
        if (this.visibilityTimeout) clearTimeout(this.visibilityTimeout);
        this.visibilityTimeout = setTimeout(() => {
            if (document.visibilityState === 'visible') this.reconnectIfNeeded();
        }, 500);
    }

    async connect(loginId?: string) {
        if (loginId) this.loginId = loginId;
        const token = DerivAuth.getToken();
        const url = this.getUrl();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.openingPromise) {
            return this.openingPromise;
        }

        this.openingPromise = new Promise<void>((resolve, reject) => {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => {
                console.info('DerivWS connected');
                const t = token;
                if (t && this.ws) {
                    this.ws.send(JSON.stringify({ authorize: t }));
                }
                // Auto-resubscribe any previous subscriptions
                try {
                    for (const [key, sub] of this.activeSubscriptions.entries()) {
                        sub.subscribed = false; // reset so subscribe will send again
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.sendSubscriptionForKey(key).catch(() => null);
                        }
                    }
                } catch (e) {
                    console.error('DerivWS resubscribe error', e);
                }
                resolve();
            };
            this.ws.onmessage = (ev) => this.handleMessage(ev.data);
            this.ws.onclose = () => {
                console.warn('DerivWS closed');
                this.openingPromise = null;
            };
            this.ws.onerror = (e) => {
                console.error('DerivWS error', e);
                reject(e);
            };
        });

        return this.openingPromise.finally(() => {
            this.openingPromise = null;
        });
    }

    async send(payload: Record<string, any>) {
        await this.connect(this.loginId || undefined);
        return new Promise<any>((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket is not open'));
                return;
            }
            const reqId = payload.req_id || `req_${Date.now()}_${++this.requestCounter}`;
            const msgType = Object.keys(payload).find(k => k !== 'req_id' && k !== 'subscribe') || '';
            const transformed = transformRequest(payload, msgType);
            const message = { ...transformed, req_id: reqId };
            const timeout = setTimeout(() => {
                this.responseHandlers.delete(reqId);
                reject(new Error(`DerivWS.send timeout for req_id ${reqId}`));
            }, 10000);

            this.responseHandlers.set(reqId, (data) => {
                clearTimeout(timeout);
                this.responseHandlers.delete(reqId);
                const transformedData = transformResponse(data, data.msg_type);
                resolve(transformedData);
            });
            this.ws.send(JSON.stringify(message));
        });
    }

    subscribe(payload: Record<string, any>, cb: MessageHandler) {
        // Create a canonical key for the payload to dedupe subscriptions
        const canonicalPayload = { ...payload };
        delete canonicalPayload.req_id;
        delete canonicalPayload.subscribe;
        const key = JSON.stringify(canonicalPayload);

        let entry = this.activeSubscriptions.get(key);
        if (!entry) {
            entry = {
                payload: canonicalPayload,
                callbacks: new Set<MessageHandler>(),
                subscribed: false,
            };
            this.activeSubscriptions.set(key, entry);
        }

        entry.callbacks.add(cb);

        // If already subscribed, return existing reqId
        if (entry.reqId && entry.subscribed) {
            return entry.reqId;
        }

        // Ensure connection, then send subscription
        this.connect(this.loginId)
            .then(() => this.sendSubscriptionForKey(key))
            .catch((e) => console.error('subscribe connect error', e));

        return entry.reqId ?? `pending_${Date.now()}_${this.subIndex++}`;
    }

    private async sendSubscriptionForKey(key: string) {
        const entry = this.activeSubscriptions.get(key);
        if (!entry) return;
        if (entry.subscribed) return;
        

        const reqId = `sub_${Date.now()}_${++this.subIndex}`;
        entry.reqId = reqId;

        // set handler for incoming subscription messages
        this.handlers.set(reqId, (data) => {
            try {
                entry!.lastMessageTime = Date.now();
                const transformedData = transformResponse(data, data.msg_type);
                for (const cb of entry!.callbacks) cb(transformedData);
            } catch (e) {
                console.error('subscription handler error', e);
            }
        });

        const msgType = Object.keys(entry.payload).find(k => k !== 'req_id') || '';
        const transformed = transformRequest(entry.payload, msgType);
        const message = { ...transformed, subscribe: 1, req_id: reqId };

        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(message));
                entry.subscribed = true;
                console.info('[DerivWS] Subscribed', { key, reqId, payload: entry.payload });
            } else {
                // If not open, queue via this.connect flow — connect() will trigger resend
                entry.subscribed = false;
            }
        } catch (e) {
            console.error('[DerivWS] sendSubscription failed', e);
        }
    }

    // Diagnostics: list active subscriptions with basic metadata
    public getSubscriptionDiagnostics() {
        const diagnostics: Array<{
            key: string;
            reqId?: string;
            subscribed: boolean;
            lastMessageTime?: number;
            payload: Record<string, any>;
        }> = [];
        for (const [key, entry] of this.activeSubscriptions.entries()) {
            diagnostics.push({
                key,
                reqId: entry.reqId,
                subscribed: entry.subscribed,
                lastMessageTime: entry.lastMessageTime,
                payload: entry.payload,
            });
        }
        return diagnostics;
    }

    public getConnectionState() {
        return this.ws?.readyState ?? -1;
    }

    unsubscribe(subId: string) {
        // remove from handlers map
        this.handlers.delete(subId);

        // find subscription entry by reqId
        for (const [key, entry] of this.activeSubscriptions.entries()) {
            if (entry.reqId === subId) {
                // remove all callbacks
                entry.callbacks.clear();
                entry.subscribed = false;
                entry.reqId = undefined;
                // tell server to forget
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    try {
                        this.ws.send(JSON.stringify({ forget: subId }));
                    } catch (e) {
                        console.error('unsubscribe send error', e);
                    }
                }
                this.activeSubscriptions.delete(key);
                return;
            }
        }
    }

    private handleMessage(raw: any) {
        try {
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const reqId = data.req_id || data.echo_req?.req_id;
            if (reqId && this.responseHandlers.has(reqId)) {
                const handler = this.responseHandlers.get(reqId)!;
                handler(data);
            }
            if (reqId && this.handlers.has(reqId)) {
                const cb = this.handlers.get(reqId)!;
                cb(data);
                return;
            }

            // try matching by subscription keys: some messages may not include req_id
            // update lastMessageTime for matching activeSubscriptions by symbol/msg_type
            const msgType = data.msg_type || '';
            for (const [key, entry] of this.activeSubscriptions.entries()) {
                // basic heuristic: if payload has symbol and data contains that symbol, route
                const payload = entry.payload || {};
                const symbol = payload.symbol || payload.ticks || payload.active_symbols || payload.contract_id || null;
                if (symbol && typeof symbol === 'string') {
                    if (data.msg_type && JSON.stringify(data).includes(symbol)) {
                        entry.lastMessageTime = Date.now();
                        const transformedData = transformResponse(data, msgType);
                        for (const cb of entry.callbacks) cb(transformedData);
                    }
                } else if (msgType && key.includes(msgType)) {
                    entry.lastMessageTime = Date.now();
                    const transformedData = transformResponse(data, msgType);
                    for (const cb of entry.callbacks) cb(transformedData);
                }
            }

            // fallback: broadcast to any non-reqId handlers
            for (const cb of this.handlers.values()) cb(data);
        } catch (e) {
            console.error('DerivWS.handleMessage parse error', e, raw);
        }
    }
}

export default DerivWS.instance;
