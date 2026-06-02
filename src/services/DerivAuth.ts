import Cookies from 'js-cookie';

type StoredToken = {
    token: string;
    expiresAt: number;
};

const STORAGE_KEY = 'deriv_auth_v1';

export class DerivAuth {
    private static _instance: DerivAuth | null = null;

    static get instance() {
        if (!this._instance) this._instance = new DerivAuth();
        return this._instance;
    }

    private constructor() {}

    setToken(token: string, ttlSeconds = 3600) {
        const payload: StoredToken = {
            token,
            expiresAt: Date.now() + ttlSeconds * 1000,
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        localStorage.setItem('authToken', token);
    }

    getToken(): string | null {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
            const payload: StoredToken = JSON.parse(raw);
            if (Date.now() > payload.expiresAt) {
                this.clearToken();
                return null;
            }
            return payload.token;
        } catch (e) {
            this.clearToken();
            return null;
        }
    }

    clearToken() {
        sessionStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('accountsList');
        localStorage.removeItem('clientAccounts');
        localStorage.removeItem('active_loginid');
        Cookies.remove('logged_state');
    }

    async refresh(): Promise<boolean> {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return false;
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            const newToken = data.access_token || data.accessToken;
            const ttl = data.expires_in || data.expiresIn || 3600;
            if (newToken) {
                this.setToken(newToken, ttl);
                return true;
            }
            return false;
        } catch (e) {
            console.error('DerivAuth.refresh failed', e);
            return false;
        }
    }

    async login(): Promise<void> {
        // Delegate to existing front-end helper to initiate OAuth flow
        try {
            const mod = await import('@/lib/auth');
            if (mod.startLogin) await mod.startLogin();
            else window.location.href = '/';
        } catch (e) {
            window.location.href = '/';
        }
    }

    logout(): void {
        this.clearToken();
        // Attempt to call server-side logout endpoint
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
    }
}

export default DerivAuth.instance;
