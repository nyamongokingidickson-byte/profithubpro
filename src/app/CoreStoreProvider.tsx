import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { getDecimalPlaces, toMoment } from '@/components/shared';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { TLandingCompany, TSocketResponseData } from '@/types/api-types';
import { transformBalanceResponse } from '@/utils/api-migration-adapter';
import { useTranslations } from '@deriv-com/translations';

type TClientInformation = {
    loginid?: string;
    email?: string;
    currency?: string;
    residence?: string | null;
    first_name?: string;
    last_name?: string;
    preferred_language?: string | null;
    user_id?: number | string;
    landing_company_shortcode?: string;
};

const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const currentDomain = useMemo(() => '.' + window.location.hostname.split('.').slice(-2).join('.'), []);
    const { isAuthorizing, isAuthorized, connectionStatus, accountList, activeLoginid } = useApiBase();

    const appInitialization = useRef(false);
    const accountInitialization = useRef(false);
    const timeInterval = useRef<NodeJS.Timeout | null>(null);
    const msg_listener = useRef<{ unsubscribe: () => void } | null>(null);
    const { client, common } = useStore() ?? {};

    const { currentLang } = useTranslations();

    const { oAuthLogout } = useOauth2({ handleLogout: async () => client.logout(), client });

    const { is_tmb_enabled: tmb_enabled_from_hook } = useTMB();

    const is_tmb_enabled = useMemo(
        () => window.is_tmb_enabled === true || tmb_enabled_from_hook,
        [tmb_enabled_from_hook]
    );

    const isLoggedOutCookie = Cookies.get('logged_state') === 'false' && !is_tmb_enabled;

    useEffect(() => {
        if (isLoggedOutCookie && client?.is_logged_in) {
            oAuthLogout();
        }
    }, [isLoggedOutCookie, oAuthLogout, client?.is_logged_in]);

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    useEffect(() => {
        const currentBalanceData = client?.all_accounts_balance?.accounts?.[activeAccount?.loginid ?? ''];
        if (currentBalanceData) {
            const numericBalance = Number(currentBalanceData.balance ?? 0);
            const currency = currentBalanceData.currency || activeAccount?.currency || 'USD';
            client?.setBalance(numericBalance.toFixed(getDecimalPlaces(currency)));
            client?.setCurrency(currency);
        } else if (activeAccount) {
            const fallbackBalance = Number((activeAccount as any)?.balance ?? 0);
            const currency = activeAccount.currency || 'USD';
            client?.setBalance(fallbackBalance.toFixed(getDecimalPlaces(currency)));
            client?.setCurrency(currency);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount, client?.all_accounts_balance]);

    useEffect(() => {
        if (client && activeAccount) {
            client?.setLoginId(activeLoginid);
            client?.setAccountList(accountList);
            client?.setIsLoggedIn(true);

            if (Array.isArray(accountList) && accountList.length > 0) {
                const seededAccounts: Record<string, any> = {
                    ...(client.all_accounts_balance?.accounts ?? {}),
                };
                accountList.forEach((acc: any) => {
                    if (acc?.loginid && seededAccounts[acc.loginid] === undefined) {
                        seededAccounts[acc.loginid] = {
                            balance: Number(acc.balance ?? 0),
                            currency: acc.currency || 'USD',
                            demo_account: Number(Boolean(acc.is_virtual)),
                            type: 'deriv',
                        };
                    }
                });
                client.setAllAccountsBalance({
                    ...(client.all_accounts_balance ?? {}),
                    accounts: seededAccounts,
                } as any);
            }
        }
    }, [accountList, activeAccount, activeLoginid, client]);

    useEffect(() => {
        initFormErrorMessages(FORM_ERROR_MESSAGES());

        return () => {
            if (timeInterval.current) {
                clearInterval(timeInterval.current);
            }
        };
    }, []);

    useEffect(() => {
        if (common && currentLang) {
            common.setCurrentLanguage(currentLang);
        }
    }, [currentLang, common]);

    useEffect(() => {
        if (client && !isAuthorizing && !appInitialization.current) {
            if (!api_base?.api) return;
            appInitialization.current = true;

            api_base.api
                ?.websiteStatus()
                .then((res: TSocketResponseData<'website_status'>) => {
                    if (res?.website_status) {
                        client.setWebsiteStatus(res.website_status);
                    }
                })
                .catch(() => {
                    // website_status is not supported on Deriv New Options WS endpoints
                });

            // Update server time every 10 seconds
            timeInterval.current = setInterval(() => {
                api_base.api
                    ?.time()
                    .then((res: TSocketResponseData<'time'>) => {
                        common.setServerTime(toMoment(res.time), false);
                    })
                    .catch(() => {
                        common.setServerTime(toMoment(Date.now()), true);
                    });
            }, 10000);
        }
    }, [client, common, isAuthorizing, is_tmb_enabled]);

    const handleMessages = useCallback(
        async (res: Record<string, unknown>) => {
            if (!res) return;
            const data = res.data as TSocketResponseData<'balance'>;
            if (!data) return;
            const { msg_type, error } = data;

            if (
                (error?.code === 'AuthorizationRequired' ||
                    error?.code === 'DisabledClient' ||
                    error?.code === 'InvalidToken') &&
                (isAuthorized || client?.is_logged_in)
            ) {
                await oAuthLogout();
                return;
            }

            if (msg_type === 'balance' && data && !error && client) {
                const transformedData = transformBalanceResponse(data);
                const balance = transformedData.balance;
                const resolvedLoginid = balance?.loginid || activeLoginid;

                if (balance?.accounts && balance?.loginid) {
                    const mergedAccounts = {
                        ...(client.all_accounts_balance?.accounts ?? {}),
                        ...balance.accounts,
                    };
                    client.setAllAccountsBalance({
                        ...balance,
                        accounts: mergedAccounts,
                    });
                } else if (resolvedLoginid && balance?.balance !== undefined) {
                    const existingAccounts = client.all_accounts_balance?.accounts ?? {};
                    const currentAccountEntry = existingAccounts[resolvedLoginid] ?? {
                        currency: balance.currency || client.currency || 'USD',
                        demo_account: 0,
                        type: 'deriv',
                    };
                    client.setAllAccountsBalance({
                        ...(client.all_accounts_balance ?? {}),
                        balance: balance.balance,
                        currency: balance.currency || currentAccountEntry.currency,
                        loginid: resolvedLoginid,
                        accounts: {
                            ...existingAccounts,
                            [resolvedLoginid]: {
                                ...currentAccountEntry,
                                balance: Number(balance.balance),
                                currency: balance.currency || currentAccountEntry.currency,
                            },
                        },
                    } as any);
                }
            }
        },
        [activeLoginid, client, isAuthorized, oAuthLogout]
    );

    useEffect(() => {
        // Only subscribe to private balance stream when authenticated!
        // Subscribing on the public WebSocket triggers AuthorizationRequired.
        if (!isAuthorizing && isAuthorized && client) {
            let subId: string | null = null;
            let cancelled = false;

            const cb = (transformedData: any) => {
                handleMessages({ data: transformedData });
            };

            (async () => {
                try {
                    subId = await api_base.subscribeTo({ balance: 1, account: 'all' }, cb as any);
                    if (cancelled && subId) {
                        await api_base.unsubscribeById(subId);
                        return;
                    }
                    if (subId) {
                        msg_listener.current = { unsubscribe: () => api_base.unsubscribeById(subId!) };
                    }
                } catch (e) {
                    console.warn('[CoreStoreProvider] subscribeTo balance listener failed', e);
                }
            })();

            return () => {
                cancelled = true;
                if (msg_listener.current) {
                    msg_listener.current.unsubscribe?.();
                    msg_listener.current = null;
                }
            };
        }

        return () => {
            if (msg_listener.current) {
                msg_listener.current.unsubscribe?.();
                msg_listener.current = null;
            }
        };
    }, [connectionStatus, handleMessages, isAuthorizing, isAuthorized, client]);

    useEffect(() => {
        if (!isAuthorizing && isAuthorized && !accountInitialization.current && client) {
            accountInitialization.current = true;
            api_base.api
                ?.getSettings?.()
                .then((settingRes: TSocketResponseData<'get_settings'>) => {
                    if (!settingRes?.get_settings) return;
                    client?.setAccountSettings(settingRes.get_settings);
                    const client_information: TClientInformation = {
                        loginid: activeAccount?.loginid,
                        email: settingRes.get_settings?.email,
                        currency: client?.currency,
                        residence: settingRes.get_settings?.residence,
                        first_name: settingRes.get_settings?.first_name,
                        last_name: settingRes.get_settings?.last_name,
                        preferred_language: settingRes.get_settings?.preferred_language,
                        user_id: ((api_base.account_info as any)?.user_id as number) || activeLoginid,
                        landing_company_shortcode: activeAccount?.landing_company_name,
                    };

                    Cookies.set('client_information', JSON.stringify(client_information), {
                        domain: currentDomain,
                    });

                    if (settingRes.get_settings?.country_code) {
                        api_base.api
                            ?.landingCompany?.({
                                landing_company: settingRes.get_settings.country_code,
                            })
                            .then((res: TSocketResponseData<'landing_company'>) => {
                                if (res?.landing_company) {
                                    client?.setLandingCompany(res.landing_company as unknown as TLandingCompany);
                                }
                            })
                            .catch(() => undefined);
                    }
                })
                .catch(() => {
                    // get_settings is optional / unavailable on New Options WS
                });

            api_base.api
                ?.getAccountStatus?.()
                .then((res: TSocketResponseData<'get_account_status'>) => {
                    if (res?.get_account_status) {
                        client?.setAccountStatus(res.get_account_status);
                    }
                })
                .catch(() => {
                    // get_account_status is optional / unavailable on New Options WS
                });
        }
    }, [activeAccount, activeLoginid, client, currentDomain, isAuthorizing, isAuthorized]);

    return <>{children}</>;
});

export default CoreStoreProvider;
