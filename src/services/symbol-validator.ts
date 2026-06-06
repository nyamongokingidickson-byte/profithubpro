import { api_base } from '@/external/bot-skeleton/services/api/api-base';

let cachedSymbols: Set<string> | null = null;
let lastFetched = 0;
const TTL = 60 * 1000; // 1 minute cache

export const refreshSymbols = async () => {
    try {
        await api_base.getActiveSymbols();
        const list = (api_base.active_symbols || []).map((s: any) => s.symbol).filter(Boolean);
        cachedSymbols = new Set(list);
        lastFetched = Date.now();
        return cachedSymbols;
    } catch (e) {
        console.warn('refreshSymbols failed', e);
        return cachedSymbols ?? new Set();
    }
};

export const isSymbolAvailable = async (symbol: string) => {
    if (!symbol) return false;
    const now = Date.now();
    if (!cachedSymbols || now - lastFetched > TTL) {
        await refreshSymbols();
    }
    return cachedSymbols ? cachedSymbols.has(symbol) : false;
};

export default { isSymbolAvailable, refreshSymbols };
