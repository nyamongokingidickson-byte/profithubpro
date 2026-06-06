import { getAppId, getPublicWebSocketURL } from '@/components/shared/utils/config/config';

export enum ConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    AUTHORIZED = 'AUTHORIZED',
    ERROR = 'ERROR',
}

export type TDerivResponse = {
    msg_type: string;
    req_id?: number;
    error?: {
        code: string;
        message: string;
    };
    echo_req: Record<string, any>;
    [key: string]: any;
};

type TSubscriptionCallback = (data: TDerivResponse) => void;

class DerivApiService {
    private static instance: DerivApiService;
    private ws: WebSocket | null = null;
    private appId: string;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    private reconnectAttempts: number = 0;
    private maxReconnectDelay: number = 5000;
    private minReconnectDelay: number = 2000;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private subscriptions: Map<string, { request: Record<string, unknown>; callback: TSubscriptionCallback }> =
        new Map();
    private pendingRequests: Map<
        number,
        {
            resolve: (data: TDerivResponse) => void;
            reject: (error: TDerivResponse['error']) => void;
            timeout: NodeJS.Timeout;
        }
    > = new Map();
    private onStateChangeCallbacks: Set<(state: ConnectionState) => void> = new Set();
    private lastReqId: number = 0;
    private latency: number = 0;
    private pingStartTime: number = 0;
    private apiToken: string | null = null;
    private isManuallyDisconnected: boolean = false;

    private constructor() {
        this.appId = String(getAppId());
    }

    private getEndpoint(): string {
        return getPublicWebSocketURL(Number(this.appId));
    }

    public static getInstance(): DerivApiService {
        if (!DerivApiService.instance) {
            DerivApiService.instance = new DerivApiService();
        }
        return DerivApiService.instance;
    }

    public connect(token?: string): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.isManuallyDisconnected = false;
        this.apiToken = token || this.apiToken;
        this.setState(ConnectionState.CONNECTING);

        try {
            this.ws = new WebSocket(this.getEndpoint());

            this.ws.onopen = () => {
                console.log('[DerivApiService] WebSocket connected');
                this.setState(ConnectionState.CONNECTED);
                this.reconnectAttempts = 0;
                this.startPing();

                if (this.apiToken) {
                    console.log('[DerivApiService] Re-authorizing with stored token...');
                    this.authorize(this.apiToken);
                } else {
                    this.restoreSubscriptions();
                }
            };

            this.ws.onmessage = event => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            };

            this.ws.onerror = error => {
                console.error('[DerivApiService] WebSocket error:', error);
                this.setState(ConnectionState.ERROR);
            };

            this.ws.onclose = () => {
                console.log('[DerivApiService] WebSocket closed');
                this.stopPing();
                if (!this.isManuallyDisconnected) {
                    this.setState(ConnectionState.DISCONNECTED);
                    this.attemptReconnect();
                }
            };
        } catch (error) {
            console.error('[DerivApiService] Failed to establish connection:', error);
            this.setState(ConnectionState.ERROR);
            this.attemptReconnect();
        }
    }

    public disconnect(): void {
        this.isManuallyDisconnected = true;
        this.stopPing();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.setState(ConnectionState.DISCONNECTED);
    }

    public authorize(token: string): Promise<any> {
        this.apiToken = token;
        // Don't log the token!
        console.log('[DerivApiService] Sending authorization request (token hidden)');
        return this.sendRequest({ authorize: token });
    }

    public send(request: Record<string, unknown>): void {
        const req_id = ++this.lastReqId;
        const msg = { ...request, req_id };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        } else {
            console.warn('[DerivApiService] Cannot send message: WebSocket is not open');
        }
    }

    public sendRequest(request: Record<string, unknown>, timeoutMs: number = 30000): Promise<TDerivResponse> {
        return new Promise((resolve, reject) => {
            const req_id = ++this.lastReqId;
            const msg = { ...request, req_id };

            const timeout = setTimeout(() => {
                const pending = this.pendingRequests.get(req_id);
                if (pending) {
                    pending.reject(new Error(`Request timed out after ${timeoutMs}ms`));
                    this.subscriptions.delete(req_id.toString());
                    this.pendingRequests.delete(req_id);
                }
            }, timeoutMs);

            this.pendingRequests.set(req_id, { resolve, reject, timeout });

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(msg));
            } else {
                clearTimeout(timeout);
                this.pendingRequests.delete(req_id);
                reject(new Error('WebSocket is not open'));
            }
        });
    }

    public buy(params: Record<string, unknown>): Promise<TDerivResponse> {
        return this.sendRequest({ buy: 1, ...params });
    }

    public sell(contractId: string | number, price: number = 0): Promise<any> {
        return this.sendRequest({ sell: contractId, price });
    }

    public getProposal(params: Record<string, unknown>): Promise<TDerivResponse> {
        return this.sendRequest({ proposal: 1, ...params });
    }

    public subscribe(request: Record<string, unknown>, callback: TSubscriptionCallback): () => void {
        const subscriptionKey = this.getSubscriptionKey(request);

        // Tracking the subscription even if disconnected
        this.subscriptions.set(subscriptionKey, { request, callback });

        // If connected, send the request immediately
        if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.AUTHORIZED) {
            this.send(request);
        }

        return () => {
            this.unsubscribe(subscriptionKey);
        };
    }

    private unsubscribe(key: string): void {
        const sub = this.subscriptions.get(key);
        if (sub && (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.AUTHORIZED)) {
            // Some requests might need a specific forget call depending on Deriv API structure
            // Example: { forget: 'subscription_id' }
            // For now, we just remove from local tracking or send a generic forget if we have an ID
            // In a more advanced version, we'd track the subscription_id returned by the API
            this.subscriptions.delete(key);
        }
    }

    private handleMessage(data: TDerivResponse): void {
        // Handle pending requests via req_id
        if (data.req_id) {
            const pending = this.pendingRequests.get(data.req_id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(data.req_id);
                if (data.error) {
                    pending.reject(data.error);
                } else {
                    pending.resolve(data);
                }
            }
        }

        // Handle authorize response
        if (data.msg_type === 'authorize') {
            if (data.error) {
                console.error('[DerivApiService] Authorization failed:', data.error.message);
                this.setState(ConnectionState.ERROR);
            } else {
                console.log('[DerivApiService] Authorized successfully');
                this.setState(ConnectionState.AUTHORIZED);
                this.restoreSubscriptions();
            }
        }

        // Handle pong
        if (data.msg_type === 'ping') {
            this.latency = Date.now() - this.pingStartTime;
            console.debug(`[DerivApiService] Latency: ${this.latency}ms`);
        }

        // Handle errors
        if (data.error) {
            this.handleApiError(data.error);
        }

        // Dispatch to subscribers
        this.subscriptions.forEach(sub => {
            // Simple match logic, could be refined based on echo_req or msg_type
            if (this.isMatchingResponse(sub.request, data)) {
                sub.callback(data);
            }
        });
    }

    private isMatchingResponse(request: Record<string, unknown>, response: TDerivResponse): boolean {
        // Deriv API echo_req is useful here
        if (response.echo_req) {
            // Check if major keys match (ticks, ticks_history, etc)
            const reqKeys = Object.keys(request);
            return reqKeys.every(k => request[k] === response.echo_req[k]);
        }
        return false;
    }

    private handleApiError(error: { code: string; message: string }): void {
        console.error(`[DerivApiService] API Error: ${error.code} - ${error.message}`);
        if (error.code === 'InvalidToken' || error.code === 'AuthorizationRequired') {
            this.setState(ConnectionState.ERROR);
        }
    }

    private restoreSubscriptions(): void {
        console.log('[DerivApiService] Restoring subscriptions:', this.subscriptions.size);
        this.subscriptions.forEach(sub => {
            this.send(sub.request);
        });
    }

    private attemptReconnect(): void {
        if (this.isManuallyDisconnected) return;

        const delay = Math.min(this.minReconnectDelay + this.reconnectAttempts * 1000, this.maxReconnectDelay);
        console.log(`[DerivApiService] Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts + 1})`);

        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
        }, delay);
    }

    private setState(state: ConnectionState): void {
        if (this.state !== state) {
            this.state = state;
            this.onStateChangeCallbacks.forEach(cb => cb(state));
        }
    }

    public onStateChange(callback: (state: ConnectionState) => void): () => void {
        this.onStateChangeCallbacks.add(callback);
        return () => this.onStateChangeCallbacks.delete(callback);
    }

    public getState(): ConnectionState {
        return this.state;
    }

    private startPing(): void {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            this.pingStartTime = Date.now();
            this.send({ ping: 1 });
        }, 30000);
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    public getLatency(): number {
        return this.latency;
    }

    private getSubscriptionKey(request: Record<string, unknown>): string {
        return JSON.stringify(request);
    }
}

export default DerivApiService.getInstance();
