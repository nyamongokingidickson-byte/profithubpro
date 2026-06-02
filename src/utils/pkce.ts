/**
 * PKCE utilities for OAuth 2.0 Authorization Code with PKCE
 */

export function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    // Use base64url encoding for higher entropy per character (PKCE spec compliant charset)
    const base64 = btoa(String.fromCharCode(...array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function createCodeVerifier(): string {
    // 32 random bytes → ~43 base64url chars (meets PKCE 43-128 char requirement)
    return generateRandomString(32);
}

export function createCodeChallenge(verifier: string): Promise<string> {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        .then(hash => {
            const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        });
}

export function createState(): string {
    return generateRandomString(16);
}

const PKCE_CODE_VERIFIER_KEY = 'pkce_code_verifier';
const PKCE_STATE_KEY = 'pkce_state';

const setStorageItem = (key: string, value: string) => {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // ignore storage failures
    }
    try {
        localStorage.setItem(key, value);
    } catch {
        // ignore storage failures
    }
};

const removeStorageItem = (key: string) => {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // ignore storage failures
    }
    try {
        localStorage.removeItem(key);
    } catch {
        // ignore storage failures
    }
};

const getStorageItem = (key: string): string | null => {
    try {
        const sessionValue = sessionStorage.getItem(key);
        if (sessionValue) return sessionValue;
    } catch {
        // ignore
    }
    try {
        const localValue = localStorage.getItem(key);
        if (localValue) return localValue;
    } catch {
        // ignore
    }
    return null;
};

export const storePKCEState = (verifier: string, state: string) => {
    setStorageItem(PKCE_CODE_VERIFIER_KEY, verifier);
    setStorageItem(PKCE_STATE_KEY, state);
};

export const popPKCEVerifier = (): string | null => {
    const verifier = getStorageItem(PKCE_CODE_VERIFIER_KEY);
    removeStorageItem(PKCE_CODE_VERIFIER_KEY);
    return verifier;
};

export const clearPKCEVerifier = () => {
    removeStorageItem(PKCE_CODE_VERIFIER_KEY);
    removeStorageItem(PKCE_STATE_KEY);
};

export const validatePKCEState = (incomingState: string): boolean => {
    const savedState = getStorageItem(PKCE_STATE_KEY);
    return incomingState === savedState;
};

export const generateState = (): string => generateRandomString(32);
