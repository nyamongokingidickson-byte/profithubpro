import DerivAuth from './DerivAuth';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';

export type MessageHandler = (data: any) => void;
class DerivWS {
    private static _instance: DerivWS;
    private ws: WebSocket | null = null;
    private loginId: string | null = null;
    private handlers = new Map<string, MessageHandler>();
    private responseHandlers = new Map<string, (data: any) => void>();
    private requestCounter = 0;
    private subIndex = 0;
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
        return `wss://${serverUrl}/websockets/v3?app_id=${appId}`;
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
        const id = `sub_${Date.now()}_${this.subIndex++}`;
        this.handlers.set(id, (data) => {
            const transformedData = transformResponse(data, data.msg_type);
            cb(transformedData);
        });
        const msgType = Object.keys(payload).find(k => k !== 'req_id' && k !== 'subscribe') || '';
        const transformed = transformRequest(payload, msgType);
        const message = { ...transformed, subscribe: 1, req_id: id };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.connect(this.loginId).then(() => {
                if (this.ws) this.ws.send(JSON.stringify(message));
            }).catch(() => null);
        }
        return id;
    }

    unsubscribe(subId: string) {
        this.handlers.delete(subId);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ forget: subId }));
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
            for (const cb of this.handlers.values()) cb(data);
        } catch (e) {
            console.error('DerivWS.handleMessage parse error', e, raw);
        }
    }
}

export default DerivWS.instance;
