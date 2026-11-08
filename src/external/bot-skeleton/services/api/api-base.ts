import Cookies from 'js-cookie';
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;
    // Subscription manager: canonicalKey -> { payload, subscriptionId, callbacks, lastMessageTime }
    activeSubscriptions: Map<
        string,
        {
            payload: Record<string, any>;
            subscriptionId?: string;
            callbacks: Set<(data: any) => void>;
            lastMessageTime?: number;
        }
    > = new Map();
    private messageSubscription: { unsubscribe: () => void } | null = null;

    unsubscribeAllSubscriptions = () => {
        // Forget all tracked subscriptions
        for (const [, entry] of this.activeSubscriptions.entries()) {
            if (entry.subscriptionId && this.api && this.api.connection?.readyState === 1) {
                try {
                    this.api.send({ forget: entry.subscriptionId });
                } catch (e) {
                    console.error('unsubscribeAll failed for', entry.subscriptionId, e);
                }
            }
        }
        this.activeSubscriptions.clear();
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        const token = V2GetActiveToken();
        const account_id = V2GetActiveClientId();
        let otp_ws_url = '';

        if (token && account_id) {
            try {
                // Fetch authenticated OTP WebSocket URL
                const response = await fetch('/api/ws/otp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ accountId: account_id }),
                });
                if (response.ok) {
                    const data = await response.json();
                    otp_ws_url = data?.data?.url || data?.ws_url || data?.wsUrl || data?.url || '';
                    if (otp_ws_url) {
                        console.log('[APIBase] Obtained authenticated OTP WS URL');
                    }
                } else if (response.status === 401 || response.status === 403) {
                    console.warn('[APIBase] Stored auth token rejected by OTP endpoint; clearing stale session');
                    clearAuthData();
                    setIsAuthorized(false);
                    this.is_authorized = false;
                }
            } catch (e) {
                console.error('[APIBase] Failed to get OTP url:', e);
            }
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
                this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }
            const original_api = generateDerivApiInstance(otp_ws_url);
            const wrapped_api = new Proxy(original_api, {
                get(target, prop, receiver) {
                    if (prop === 'authorize') {
                        return async () => {
                            const loginId = localStorage.getItem('active_loginid') || '';
                            const clientAccounts = JSON.parse(localStorage.getItem('clientAccounts') || '{}');
                            const isAccountVirtual = (acc: any) =>
                                Number(
                                    acc?.is_virtual ??
                                        (acc?.account_type === 'demo' ||
                                            String(acc?.loginid || '').startsWith('VR') ||
                                            String(acc?.loginid || '').startsWith('DOT'))
                                );
                            const account_list = Object.values(clientAccounts).map((acc: any) => ({
                                loginid: acc.loginid,
                                currency: acc.currency || 'USD',
                                balance: Number(acc.balance ?? 0),
                                is_virtual: isAccountVirtual(acc),
                            }));
                            const country = localStorage.getItem('client.country') || '';
                            const activeAccount = clientAccounts[loginId];
                            const currency = activeAccount?.currency || 'USD';
                            return {
                                authorize: {
                                    loginid: loginId,
                                    account_list,
                                    country,
                                    currency,
                                    balance: Number(activeAccount?.balance ?? 0),
                                    is_virtual: isAccountVirtual(activeAccount ?? { loginid: loginId }),
                                },
                                error: null,
                            };
                        };
                    }
                    if (prop === 'send') {
                        return (data: any) => {
                            let req_type = null;
                            if (data && typeof data === 'object') {
                                req_type = Object.keys(data).find(k => k !== 'req_id');
                            }
                            const transformed = req_type ? transformRequest(data, req_type) : data;
                            return target.send(transformed);
                        };
                    }
                    if (prop === 'onMessage') {
                        return () => {
                            const original_observable = target.onMessage();
                            return {
                                subscribe: (callback: any) => {
                                    return original_observable.subscribe((msg: any) => {
                                        if (msg?.data) {
                                            const transformedData = transformResponse(msg.data, msg.data.msg_type);
                                            callback({ ...msg, data: transformedData });
                                        } else {
                                            const transformedMsg = transformResponse(msg, msg.msg_type);
                                            callback(transformedMsg);
                                        }
                                    });
                                }
                            };
                        };
                    }
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
            this.api = wrapped_api as any;
            this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));

            // Setup a central onMessage router to dispatch to activeSubscriptions callbacks
            try {
                if (this.messageSubscription && typeof this.messageSubscription.unsubscribe === 'function') {
                    this.messageSubscription.unsubscribe();
                }
                this.messageSubscription = this.api.onMessage().subscribe((msg: any) => {
                    const data = msg?.data ?? msg;
                    const reqId = data.req_id || data.subscription?.id || data.echo_req?.req_id;

                    // route to matching subscription by subscriptionId
                    if (reqId) {
                        for (const [, entry] of this.activeSubscriptions.entries()) {
                            if (entry.subscriptionId === reqId) {
                                entry.lastMessageTime = Date.now();
                                try {
                                    const transformed = transformResponse(data, data.msg_type);
                                    for (const cb of entry.callbacks) cb(transformed);
                                } catch (e) {
                                    console.error('subscription callback error', e);
                                }
                            }
                        }
                    }

                    // fallback: route by symbol/msg_type heuristics
                    const msgType = data.msg_type || '';
                    for (const [key, entry] of this.activeSubscriptions.entries()) {
                        const payload = entry.payload || {};
                        const symbol = payload.symbol || payload.ticks || null;
                        if (symbol && typeof symbol === 'string' && JSON.stringify(data).includes(symbol)) {
                            entry.lastMessageTime = Date.now();
                            const transformed = transformResponse(data, msgType);
                            for (const cb of entry.callbacks) cb(transformed);
                        } else if (msgType && key.includes(msgType)) {
                            entry.lastMessageTime = Date.now();
                            const transformed = transformResponse(data, msgType);
                            for (const cb of entry.callbacks) cb(transformed);
                        }
                    }
                });
            } catch (e) {
                console.warn('Failed to attach central onMessage router', e);
            }
        }

        const hasAuthenticatedSocket = Boolean(otp_ws_url && V2GetActiveToken());

        if (!this.has_active_symbols && !hasAuthenticatedSocket) {
            this.active_symbols_promise = this.getActiveSymbols();
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (hasAuthenticatedSocket) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
        } else {
            setIsAuthorizing(false);
        }

        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        // eslint-disable-next-line no-console
        console.log('connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('Info: Connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (!token || !this.api) return;

        this.token = token;
        this.account_id = V2GetActiveClientId() ?? '';
        setIsAuthorizing(true);

        try {
            const { authorize, error } = await this.api.authorize(this.token);
            if (error) {
                if (error.code === 'InvalidToken') {
                    const is_tmb_enabled = window.is_tmb_enabled === true;
                    if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                        globalObserver.emit('InvalidToken', { error });
                    } else {
                        clearAuthData();
                    }
                } else {
                    console.error('Authorization error:', error);
                }
                return error;
            }

            this.account_info = authorize;
            setAccountList(authorize?.account_list || []);
            setAuthData(authorize);
            setIsAuthorized(true);
            this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(authorize?.account_list));
            localStorage.setItem('client.country', authorize?.country);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }
            this.subscribe();
            this.getSelfExclusion();
        } catch (e) {
            console.error('Authorization failed:', e);
            this.is_authorized = false;
            clearAuthData();
            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            setIsAuthorizing(false);
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        try {
            await this.api.getSelfExclusion();
        } catch {
            // get_self_exclusion is not supported on Deriv New Options WS endpoints
        }
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                        ...(streamName === 'balance' ? { account: 'all' } : {}),
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    // New subscribe helper that deduplicates subscriptions and routes callbacks
    async subscribeTo(payload: Record<string, any>, cb: (data: any) => void) {
        if (!this.api) throw new Error('API not initialized');

        const canonical = { ...payload };
        delete canonical.req_id;
        delete canonical.subscribe;
        const key = JSON.stringify(canonical);

        let entry = this.activeSubscriptions.get(key);
        if (!entry) {
            entry = { payload: canonical, callbacks: new Set() };
            this.activeSubscriptions.set(key, entry);
        }

        entry.callbacks.add(cb);

        if (entry.subscriptionId) {
            return entry.subscriptionId;
        }

        try {
            const msgType = Object.keys(canonical).find(k => k !== 'req_id') || '';
            const transformed = msgType ? transformRequest(canonical, msgType) : canonical;
            const message = { ...transformed, subscribe: 1 };
            const response = await this.api.send(message as any);

            const subId = response?.subscription?.id || response?.tick?.id || response?.subscriptionId || null;
            if (subId) {
                entry.subscriptionId = subId;
                console.info('[APIBase] Subscribed', { key, subId, payload: entry.payload });
                return subId;
            }
            return null;
        } catch (e) {
            console.error('subscribeTo error', e, payload);
            throw e;
        }
    }

    async unsubscribeById(subscriptionId: string) {
        if (!subscriptionId) return;
        // remove from activeSubscriptions
        for (const [key, entry] of this.activeSubscriptions.entries()) {
            if (entry.subscriptionId === subscriptionId) {
                entry.callbacks.clear();
                entry.subscriptionId = undefined;
                try {
                    if (this.api && this.api.connection?.readyState === 1) {
                        this.api.send({ forget: subscriptionId });
                    }
                } catch (e) {
                    console.error('unsubscribeById send error', e);
                }
                this.activeSubscriptions.delete(key);
                return;
            }
        }
        // fallback: send forget anyway
        try {
            if (this.api && this.api.connection?.readyState === 1) {
                this.api.send({ forget: subscriptionId });
            }
        } catch (e) {
            console.error('unsubscribeById fallback send error', e);
        }
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }

    // Diagnostics helper: return active subscription metadata
    getSubscriptionDiagnostics() {
        const out: Array<{
            key: string;
            subscriptionId?: string;
            lastMessageTime?: number;
            payload: Record<string, any>;
            callbackCount: number;
        }> = [];
        for (const [key, entry] of this.activeSubscriptions.entries()) {
            out.push({
                key,
                subscriptionId: entry.subscriptionId,
                lastMessageTime: entry.lastMessageTime,
                payload: entry.payload,
                callbackCount: entry.callbacks.size,
            });
        }
        return out;
    }
}

export const api_base = new APIBase();
