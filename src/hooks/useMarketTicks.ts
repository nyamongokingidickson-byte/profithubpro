import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    transformTicksHistoryRequest,
} from '@/utils/api-migration-adapter';

export type TTick = {
    symbol: string;
    quote: number;
    epoch: number;
};

export type TMarketTicksOptions = {
    count?: number;
    subscribe?: boolean;
};

export const useMarketTicks = (symbol: string, options: TMarketTicksOptions = {}) => {
    const { count = 100, subscribe = true } = options;
    const [ticks, setTicks] = useState<TTick[]>([]);
    const [history, setHistory] = useState<number[]>([]);
    const [lastTick, setLastTick] = useState<TTick | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Ref to avoid stale closures in callbacks
    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;

    useEffect(() => {
        if (!symbol) return;

        setIsLoading(true);
        setError(null);

        const historyRequest = transformTicksHistoryRequest({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style: 'ticks',
        });

        // Use centralized api_base for history fetch
        try {
            api_base.api?.send(historyRequest as any);
        } catch (e) {
            console.warn('[useMarketTicks] history request failed', e);
        }

        // 2. Subscribe if requested
        let unsubscribe: (() => void) | null = null;

        if (subscribe) {
            // Subscribe via centralized subscription manager
            let subId: string | null = null;
            let cancelled = false;
            const cb = (transformedData: any) => {
                if (transformedData.msg_type === 'tick' && transformedData.tick) {
                    if (transformedData.tick.symbol === symbolRef.current) {
                        const newTick = {
                            symbol: transformedData.tick.symbol,
                            quote: parseFloat(transformedData.tick.quote),
                            epoch: transformedData.tick.epoch,
                        };
                        setLastTick(newTick);
                        setTicks(prev => [...prev.slice(-count + 1), newTick]);
                    }
                } else if (transformedData.msg_type === 'history' && transformedData.echo_req?.ticks_history === symbolRef.current) {
                    if (transformedData.error) {
                        setError(transformedData.error.message);
                    } else if (transformedData.history?.prices) {
                        setHistory(transformedData.history.prices);
                        const lastPrice = transformedData.history.prices[transformedData.history.prices.length - 1];
                        setLastTick({
                            symbol: symbolRef.current,
                            quote: lastPrice,
                            epoch: transformedData.history.times[transformedData.history.times.length - 1],
                        });
                    }
                    setIsLoading(false);
                } else if (transformedData.error && transformedData.echo_req?.ticks === symbolRef.current) {
                    setError(transformedData.error.message);
                }
            };

            (async () => {
                try {
                    subId = await api_base.subscribeTo({ ticks: symbol }, cb as any);
                    if (cancelled && subId) await api_base.unsubscribeById(subId);
                } catch (e) {
                    console.warn('[useMarketTicks] subscribe error', e);
                }
            })();

            unsubscribe = () => {
                cancelled = true;
                if (subId) api_base.unsubscribeById(subId).catch(() => null);
            };
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [symbol, count, subscribe]);

    return {
        ticks,
        history,
        lastTick,
        error,
        isLoading,
    };
};

export default useMarketTicks;
