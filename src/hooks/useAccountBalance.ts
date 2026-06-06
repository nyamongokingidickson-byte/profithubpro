import { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { transformBalanceRequest } from '@/utils/api-migration-adapter';

export type TBalance = {
    amount: number;
    currency: string;
    loginid: string;
};

export const useAccountBalance = (subscribe: boolean = true) => {
    const [balance, setBalance] = useState<TBalance | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLoading(true);
        setError(null);

        // Transform to new API format (removes deprecated loginid, account params)
        const legacyRequest = { balance: 1, subscribe: subscribe ? 1 : 0 };
        const request = transformBalanceRequest(legacyRequest);

        let subId: string | null = null;
        let cancelled = false;
        const cb = (data: any) => {
            if (data.error) {
                setError(data.error.message);
            } else if (data.balance) {
                setBalance({
                    amount: data.balance.balance,
                    currency: data.balance.currency,
                    loginid: data.balance.loginid,
                });
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
                console.warn('[useAccountBalance] subscribe error', e);
            }
        })();

        return () => {
            cancelled = true;
            if (subId) api_base.unsubscribeById(subId).catch(() => null);
        };
    }, [subscribe]);

    return { balance, isLoading, error };
};

export default useAccountBalance;
