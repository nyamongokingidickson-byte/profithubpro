import { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    transformPortfolioRequest,
    transformPortfolioResponse,
} from '@/utils/api-migration-adapter';

export type TPortfolioItem = {
    contract_id: number;
    buy_price: number;
    symbol: string;
    contract_type: string;
    expiry_time: number;
};

export const usePortfolio = (subscribe: boolean = true) => {
    const [portfolio, setPortfolio] = useState<TPortfolioItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLoading(true);
        setError(null);

        const legacyRequest = { portfolio: 1, subscribe: subscribe ? 1 : 0 };
        const request = transformPortfolioRequest(legacyRequest);

        let subId: string | null = null;
        let cancelled = false;
        const cb = (data: any) => {
            if (data.error) {
                setError(data.error.message);
            } else if (data.portfolio) {
                const transformedData = transformPortfolioResponse(data);
                setPortfolio(transformedData.portfolio.contracts || []);
            }
            setIsLoading(false);
        };

        (async () => {
            try {
                if (subscribe) {
                    subId = await api_base.subscribeTo(request as any, cb as any);
                    if (cancelled && subId) await api_base.unsubscribeById(subId);
                }
            } catch (e) {
                console.warn('[usePortfolio] subscribe error', e);
            }
        })();

        return () => {
            cancelled = true;
            if (subId) api_base.unsubscribeById(subId).catch(() => null);
        };
    }, [subscribe]);

    return { portfolio, isLoading, error };
};

export default usePortfolio;
