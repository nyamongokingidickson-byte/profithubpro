import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { startLogin } from '@/lib/auth';
import { localize } from '@deriv-com/translations';
import './dtrader.scss';

type TTradeFamily = 'rise_fall' | 'higher_lower' | 'over_under' | 'even_odd' | 'match_diff';
type TDurationUnit = 't' | 's' | 'm';
type TBasis = 'stake' | 'payout';

interface TMarketItem {
    symbol: string;
    display_name: string;
    market: string;
    market_display_name: string;
    submarket_display_name: string;
    pip: number;
}

interface TDirectionOption {
    contractType: string;
    label: string;
    variant: 'up' | 'down';
}

interface TQuoteInfo {
    id: string;
    askPrice: number;
    payout: number;
    longcode: string;
    spot?: number;
    createdAt: number;
    error?: string;
}

interface TTrackedContract {
    contract_id: number;
    contract_type?: string;
    symbol?: string;
    longcode?: string;
    buy_price: number;
    bid_price?: number;
    sell_price?: number;
    payout?: number;
    profit?: number;
    currency: string;
    entry_spot?: number;
    current_spot?: number;
    exit_spot?: number;
    is_valid_to_sell?: number | boolean;
    is_sold?: number | boolean;
    status?: string;
    date_start?: number;
}

const FALLBACK_MARKETS: TMarketItem[] = [
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.0001 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.0001 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.001 },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.001 },
];

const TRADE_FAMILIES: { id: TTradeFamily; label: string; isDigits?: boolean }[] = [
    { id: 'over_under', label: 'Over / Under', isDigits: true },
    { id: 'even_odd', label: 'Even / Odd', isDigits: true },
    { id: 'match_diff', label: 'Matches / Differs', isDigits: true },
    { id: 'rise_fall', label: 'Rise / Fall' },
    { id: 'higher_lower', label: 'Higher / Lower' },
];

const FAMILY_DIRECTIONS: Record<TTradeFamily, [TDirectionOption, TDirectionOption]> = {
    rise_fall: [
        { contractType: 'CALL', label: 'Rise', variant: 'up' },
        { contractType: 'PUT', label: 'Fall', variant: 'down' },
    ],
    higher_lower: [
        { contractType: 'CALL', label: 'Higher', variant: 'up' },
        { contractType: 'PUT', label: 'Lower', variant: 'down' },
    ],
    over_under: [
        { contractType: 'DIGITOVER', label: 'Over', variant: 'up' },
        { contractType: 'DIGITUNDER', label: 'Under', variant: 'down' },
    ],
    even_odd: [
        { contractType: 'DIGITEVEN', label: 'Even', variant: 'up' },
        { contractType: 'DIGITODD', label: 'Odd', variant: 'down' },
    ],
    match_diff: [
        { contractType: 'DIGITMATCH', label: 'Matches', variant: 'up' },
        { contractType: 'DIGITDIFF', label: 'Differs', variant: 'down' },
    ],
};

const QUICK_STAKES = [0.35, 1, 2, 5, 10];
const TICK_CHOICES = [1, 2, 3, 5, 7, 10];
const QUOTE_FRESH_MS = 12000;

const pipToDecimals = (pip?: number): number => {
    if (!pip || !Number.isFinite(pip) || pip <= 0) return 2;
    const str = pip.toString();
    if (str.includes('e-')) {
        return Math.min(10, Math.max(0, parseInt(str.split('e-')[1], 10) || 2));
    }
    const parts = str.split('.');
    return parts[1] ? Math.min(10, parts[1].length) : 0;
};

const extractErrMsg = (err: any): string =>
    err?.error?.message || err?.message || localize('Unable to complete Deriv request.');

const formatMoney = (value: number | string | undefined, currency = 'USD'): string => {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return `0.00 ${currency}`;
    return `${num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${currency}`;
};

const Dtrader = observer(() => {
    const { client } = useStore();
    const { isAuthorized, connectionStatus, activeLoginid } = useApiBase();
    const { is_dark_mode_on } = useThemeSwitcher();

    // Market & live tick state
    const [markets, setMarkets] = useState<TMarketItem[]>(FALLBACK_MARKETS);
    const [symbol, setSymbol] = useState<string>('1HZ100V');
    const [ticks, setTicks] = useState<{ epoch: number; quote: number }[]>([]);
    const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

    // Ticket configuration state
    const [family, setFamily] = useState<TTradeFamily>('over_under');
    const [basis, setBasis] = useState<TBasis>('stake');
    const [amount, setAmount] = useState<string>('1');
    const [durationUnit, setDurationUnit] = useState<TDurationUnit>('t');
    const [duration, setDuration] = useState<string>('1');
    const [prediction, setPrediction] = useState<number>(5);
    const [barrierOffset, setBarrierOffset] = useState<string>('+0.50');

    // Quotes, execution & portfolio state
    const [quotes, setQuotes] = useState<Record<string, TQuoteInfo>>({});
    const [isQuoting, setIsQuoting] = useState<boolean>(false);
    const [buyingType, setBuyingType] = useState<string | null>(null);
    const [sellingId, setSellingId] = useState<number | null>(null);
    const [tradeError, setTradeError] = useState<string>('');
    const [contracts, setContracts] = useState<TTrackedContract[]>([]);

    const isBuyingRef = useRef<boolean>(false);
    const quoteSeqRef = useRef<number>(0);
    const subscribedContractsRef = useRef<Set<number>>(new Set());

    const resolvedLoginId = client?.loginid || activeLoginid || V2GetActiveClientId() || '';
    const hasAuthSession = Boolean((isAuthorized || client?.is_logged_in || V2GetActiveToken()) && resolvedLoginId);
    const currency = client?.currency || 'USD';
    const isDemo = useMemo(() => {
        if (client?.is_virtual !== undefined) return Boolean(client.is_virtual);
        return resolvedLoginId.startsWith('VR') || resolvedLoginId.startsWith('DOT');
    }, [client?.is_virtual, resolvedLoginId]);

    const currentMarket = useMemo(
        () => markets.find(m => m.symbol === symbol) || FALLBACK_MARKETS.find(m => m.symbol === symbol) || markets[0],
        [markets, symbol]
    );
    const decimals = useMemo(() => pipToDecimals(currentMarket?.pip), [currentMarket?.pip]);

    const isDigitFamily = family === 'over_under' || family === 'even_odd' || family === 'match_diff';
    const needsDigitPrediction = family === 'over_under' || family === 'match_diff';
    const needsBarrierOffset = family === 'higher_lower';

    // Ensure digit contracts always use tick durations (1-10)
    useEffect(() => {
        if (isDigitFamily) {
            if (durationUnit !== 't') setDurationUnit('t');
            const d = parseInt(duration, 10);
            if (!Number.isFinite(d) || d < 1 || d > 10) {
                setDuration('1');
            }
        }
    }, [isDigitFamily, durationUnit, duration]);

    // Ensure central API connection is alive when DTrader opens
    useEffect(() => {
        if (!api_base?.api || (api_base.api.connection && api_base.api.connection.readyState > WebSocket.OPEN)) {
            api_base.init?.(true)?.catch(err => {
                console.warn('[DTrader] Initial reconnect warning:', err);
            });
        }
    }, [connectionStatus]);

    // Load active symbols from Deriv WS
    useEffect(() => {
        let cancelled = false;
        const loadMarkets = async () => {
            if (!api_base?.api) return;
            try {
                const res = await api_base.api.send({ active_symbols: 'brief' });
                if (cancelled || !Array.isArray(res?.active_symbols)) return;

                const openSymbols: TMarketItem[] = res.active_symbols
                    .filter(
                        (item: any) =>
                            (item.symbol || item.underlying_symbol) &&
                            item.exchange_is_open !== 0 &&
                            item.exchange_is_open !== false &&
                            !item.is_trading_suspended
                    )
                    .map((item: any) => ({
                        symbol: item.symbol || item.underlying_symbol,
                        display_name: item.display_name || item.underlying_symbol_name || item.symbol,
                        market: item.market || 'synthetic_index',
                        market_display_name: item.market_display_name || 'Derived',
                        submarket_display_name: item.submarket_display_name || 'Indices',
                        pip: Number(item.pip ?? item.pip_size ?? 0.01),
                    }));

                if (openSymbols.length > 0) {
                    openSymbols.sort((a, b) => {
                        if (a.market === 'synthetic_index' && b.market !== 'synthetic_index') return -1;
                        if (a.market !== 'synthetic_index' && b.market === 'synthetic_index') return 1;
                        return a.display_name.localeCompare(b.display_name);
                    });
                    setMarkets(openSymbols);
                    setSymbol(prev =>
                        openSymbols.some(s => s.symbol === prev)
                            ? prev
                            : openSymbols.find(s => s.symbol === '1HZ100V')?.symbol ||
                              openSymbols.find(s => s.symbol === 'R_100')?.symbol ||
                              openSymbols[0].symbol
                    );
                }
            } catch (err) {
                console.warn('[DTrader] Using fallback markets while active_symbols loads:', err);
            }
        };

        loadMarkets();
        return () => {
            cancelled = true;
        };
    }, [connectionStatus, resolvedLoginId]);

    // Subscribe to ticks_history + live ticks for the selected symbol
    useEffect(() => {
        if (!api_base?.api || !symbol) return undefined;

        let active = true;
        let tickSubId: string | null = null;
        setTicks([]);

        const msgSub = api_base.api.onMessage().subscribe((evt: any) => {
            const data = evt?.data ?? evt;
            if (!active || !data || data.error) return;

            if (data.msg_type === 'tick' && data.tick?.symbol === symbol) {
                const quote = Number(data.tick.quote);
                const epoch = Number(data.tick.epoch || Math.floor(Date.now() / 1000));
                if (!Number.isFinite(quote)) return;

                if (data.tick.id && !tickSubId) {
                    tickSubId = data.tick.id;
                }

                setTicks(prev => {
                    const last = prev[prev.length - 1];
                    if (last) {
                        if (quote > last.quote) setPriceFlash('up');
                        else if (quote < last.quote) setPriceFlash('down');
                    }
                    const next = [...prev, { epoch, quote }];
                    return next.slice(-100);
                });
            }
        });

        // Seed 100 historical ticks for instant chart & digit percentages
        api_base.api
            .send({
                ticks_history: symbol,
                count: 100,
                end: 'latest',
                style: 'ticks',
                subscribe: 0,
            })
            .then((res: any) => {
                if (!active || !res?.history?.prices) return;
                const prices: number[] = res.history.prices.map(Number);
                const times: number[] = (res.history.times || []).map(Number);
                const seeded = prices
                    .map((q, idx) => ({ epoch: times[idx] || idx, quote: q }))
                    .filter(item => Number.isFinite(item.quote));
                if (seeded.length) {
                    setTicks(prev => (prev.length > seeded.length ? prev : seeded.slice(-100)));
                }
            })
            .catch(() => {});

        // Start live tick stream
        api_base.api
            .send({ ticks: symbol, subscribe: 1 })
            .then((res: any) => {
                const id = res?.subscription?.id || res?.tick?.id || null;
                if (!active && id) {
                    api_base.api?.send({ forget: id }).catch(() => {});
                    return;
                }
                if (id) tickSubId = id;
            })
            .catch(err => {
                console.warn('[DTrader] Tick stream warning:', err);
            });

        return () => {
            active = false;
            msgSub?.unsubscribe?.();
            if (tickSubId && api_base?.api) {
                api_base.api.send({ forget: tickSubId }).catch(() => {});
            }
        };
    }, [symbol, connectionStatus]);

    useEffect(() => {
        if (!priceFlash) return undefined;
        const timer = setTimeout(() => setPriceFlash(null), 450);
        return () => clearTimeout(timer);
    }, [priceFlash, ticks.length]);

    // Build proposal payload for a given direction
    const buildProposalPayload = useCallback(
        (contractType: string) => {
            const numericAmount = Number(amount);
            const numericDuration = parseInt(duration, 10);
            if (!symbol || !Number.isFinite(numericAmount) || numericAmount <= 0) return null;
            if (!Number.isInteger(numericDuration) || numericDuration < 1) return null;
            if (durationUnit === 't' && numericDuration > 10) return null;

            const payload: Record<string, any> = {
                proposal: 1,
                amount: numericAmount,
                basis,
                contract_type: contractType,
                currency,
                duration: numericDuration,
                duration_unit: durationUnit,
                symbol,
            };

            if (needsDigitPrediction) {
                payload.barrier = String(prediction);
            } else if (needsBarrierOffset) {
                const trimmedBarrier = barrierOffset.trim();
                if (!trimmedBarrier) return null;
                payload.barrier = trimmedBarrier;
            }

            return payload;
        },
        [amount, basis, currency, duration, durationUnit, symbol, needsDigitPrediction, prediction, needsBarrierOffset, barrierOffset]
    );

    // Fetch live quotes for both directions whenever ticket inputs change
    const refreshQuotes = useCallback(async () => {
        const directions = FAMILY_DIRECTIONS[family];
        const seq = ++quoteSeqRef.current;

        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) {
            return;
        }

        const payloads = directions.map(dir => ({
            dir,
            payload: buildProposalPayload(dir.contractType),
        }));

        if (payloads.some(p => !p.payload)) {
            setQuotes({});
            return;
        }

        setIsQuoting(true);
        const results = await Promise.all(
            payloads.map(async ({ dir, payload }) => {
                try {
                    const res = await api_base.api!.send(payload!);
                    if (res?.error) {
                        return [
                            dir.contractType,
                            {
                                id: '',
                                askPrice: 0,
                                payout: 0,
                                longcode: '',
                                createdAt: Date.now(),
                                error: res.error.message,
                            } as TQuoteInfo,
                        ] as const;
                    }
                    const p = res?.proposal;
                    if (!p) {
                        return [dir.contractType, null] as const;
                    }
                    return [
                        dir.contractType,
                        {
                            id: p.id || '',
                            askPrice: Number(p.ask_price ?? 0),
                            payout: Number(p.payout ?? 0),
                            longcode: p.longcode || '',
                            spot: p.spot !== undefined ? Number(p.spot) : undefined,
                            createdAt: Date.now(),
                        } as TQuoteInfo,
                    ] as const;
                } catch (err: any) {
                    return [
                        dir.contractType,
                        {
                            id: '',
                            askPrice: 0,
                            payout: 0,
                            longcode: '',
                            createdAt: Date.now(),
                            error: extractErrMsg(err),
                        } as TQuoteInfo,
                    ] as const;
                }
            })
        );

        if (seq !== quoteSeqRef.current) return;
        const nextQuotes: Record<string, TQuoteInfo> = {};
        results.forEach(([type, info]) => {
            if (info) nextQuotes[type] = info;
        });
        setQuotes(nextQuotes);
        setIsQuoting(false);
    }, [family, buildProposalPayload]);

    useEffect(() => {
        setTradeError('');
        const debounceTimer = setTimeout(() => {
            refreshQuotes();
        }, 250);

        const refreshInterval = setInterval(() => {
            if (!isBuyingRef.current) {
                refreshQuotes();
            }
        }, 10000);

        return () => {
            clearTimeout(debounceTimer);
            clearInterval(refreshInterval);
        };
    }, [refreshQuotes, connectionStatus, resolvedLoginId]);

    // Subscribe to proposal_open_contract updates & load open portfolio contracts
    const trackContractStream = useCallback((contractId: number) => {
        if (!contractId || subscribedContractsRef.current.has(contractId) || !api_base?.api) return;
        subscribedContractsRef.current.add(contractId);
        api_base.api
            .send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            })
            .catch(err => {
                subscribedContractsRef.current.delete(contractId);
                console.warn('[DTrader] proposal_open_contract subscribe warning:', err);
            });
    }, []);

    useEffect(() => {
        subscribedContractsRef.current.clear();
        setContracts([]);

        if (!hasAuthSession || !api_base?.api) return undefined;

        let active = true;
        const sub = api_base.api.onMessage().subscribe((evt: any) => {
            const data = evt?.data ?? evt;
            if (!active || !data || data.error) return;

            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.contract_id) {
                const poc = data.proposal_open_contract;
                setContracts(prev => {
                    const updated: TTrackedContract = {
                        contract_id: poc.contract_id,
                        contract_type: poc.contract_type,
                        symbol: poc.symbol || poc.underlying_symbol,
                        longcode: poc.longcode,
                        buy_price: Number(poc.buy_price ?? 0),
                        bid_price: poc.bid_price !== undefined ? Number(poc.bid_price) : undefined,
                        sell_price: poc.sell_price !== undefined ? Number(poc.sell_price) : undefined,
                        payout: poc.payout !== undefined ? Number(poc.payout) : undefined,
                        profit: poc.profit !== undefined ? Number(poc.profit) : undefined,
                        currency: poc.currency || currency,
                        entry_spot: poc.entry_spot !== undefined ? Number(poc.entry_spot) : undefined,
                        current_spot: poc.current_spot !== undefined ? Number(poc.current_spot) : undefined,
                        exit_spot: poc.exit_spot !== undefined ? Number(poc.exit_spot) : undefined,
                        is_valid_to_sell: poc.is_valid_to_sell,
                        is_sold: poc.is_sold,
                        status: poc.status || (poc.is_sold ? 'sold' : 'open'),
                        date_start: poc.date_start,
                    };
                    const idx = prev.findIndex(item => item.contract_id === poc.contract_id);
                    if (idx === -1) {
                        return [updated, ...prev].slice(0, 20);
                    }
                    const copy = [...prev];
                    copy[idx] = { ...copy[idx], ...updated };
                    return copy;
                });
            }
        });

        // Load any currently open contracts from Deriv portfolio
        api_base.api
            .send({ portfolio: 1 })
            .then((res: any) => {
                if (!active || !Array.isArray(res?.portfolio?.contracts)) return;
                const openItems: TTrackedContract[] = res.portfolio.contracts.map((c: any) => ({
                    contract_id: c.contract_id,
                    contract_type: c.contract_type,
                    symbol: c.symbol || c.underlying_symbol,
                    longcode: c.longcode,
                    buy_price: Number(c.buy_price ?? 0),
                    payout: c.payout !== undefined ? Number(c.payout) : undefined,
                    currency: c.currency || currency,
                    date_start: c.date_start,
                    status: 'open',
                    is_sold: 0,
                }));
                if (openItems.length) {
                    setContracts(prev => {
                        const existingIds = new Set(prev.map(p => p.contract_id));
                        const merged = [...prev, ...openItems.filter(o => !existingIds.has(o.contract_id))];
                        return merged.slice(0, 20);
                    });
                    openItems.forEach(item => trackContractStream(item.contract_id));
                }
            })
            .catch(() => {});

        return () => {
            active = false;
            sub?.unsubscribe?.();
        };
    }, [hasAuthSession, resolvedLoginId, connectionStatus, currency, trackContractStream]);

    // Execute trade purchase for selected direction
    const handlePurchase = async (dir: TDirectionOption) => {
        if (!hasAuthSession) {
            await startLogin();
            return;
        }
        if (isBuyingRef.current) return;
        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) {
            setTradeError(localize('Connection is reconnecting. Please wait a moment and try again.'));
            return;
        }

        const proposalPayload = buildProposalPayload(dir.contractType);
        if (!proposalPayload) {
            setTradeError(localize('Please enter a valid stake and duration before placing a trade.'));
            return;
        }

        isBuyingRef.current = true;
        setBuyingType(dir.contractType);
        setTradeError('');

        try {
            let activeQuote = quotes[dir.contractType];
            const isQuoteFresh =
                activeQuote?.id &&
                !activeQuote.error &&
                activeQuote.askPrice > 0 &&
                Date.now() - activeQuote.createdAt < QUOTE_FRESH_MS;

            if (!isQuoteFresh) {
                const freshRes = await api_base.api.send(proposalPayload);
                if (freshRes?.error) {
                    throw freshRes;
                }
                const p = freshRes?.proposal;
                if (!p?.id) {
                    throw new Error(localize('Unable to obtain a live quote from Deriv.'));
                }
                activeQuote = {
                    id: p.id,
                    askPrice: Number(p.ask_price ?? amount),
                    payout: Number(p.payout ?? 0),
                    longcode: p.longcode || '',
                    createdAt: Date.now(),
                };
            }

            const buyRes = await api_base.api.send({
                buy: activeQuote.id,
                price: activeQuote.askPrice,
            });

            if (buyRes?.error) {
                throw buyRes;
            }

            const bought = buyRes?.buy;
            if (!bought?.contract_id) {
                throw new Error(localize('Deriv did not return a contract ID for the purchase.'));
            }

            const optimisticContract: TTrackedContract = {
                contract_id: bought.contract_id,
                contract_type: dir.contractType,
                symbol,
                longcode: bought.longcode || activeQuote.longcode,
                buy_price: Number(bought.buy_price ?? activeQuote.askPrice),
                payout: Number(bought.payout ?? activeQuote.payout),
                currency,
                status: 'open',
                is_sold: 0,
                date_start: bought.start_time,
            };

            setContracts(prev => [
                optimisticContract,
                ...prev.filter(item => item.contract_id !== bought.contract_id),
            ].slice(0, 20));

            trackContractStream(bought.contract_id);
            refreshQuotes();
        } catch (err: any) {
            setTradeError(extractErrMsg(err));
            refreshQuotes();
        } finally {
            isBuyingRef.current = false;
            setBuyingType(null);
        }
    };

    const handleSellContract = async (contractId: number) => {
        if (!api_base?.api || sellingId) return;
        setSellingId(contractId);
        setTradeError('');
        try {
            const res = await api_base.api.send({ sell: contractId, price: 0 });
            if (res?.error) throw res;
            await api_base.api.send({ proposal_open_contract: 1, contract_id: contractId }).catch(() => {});
        } catch (err: any) {
            setTradeError(extractErrMsg(err));
        } finally {
            setSellingId(null);
        }
    };

    const adjustStake = (delta: number) => {
        const cur = Number(amount) || 0;
        const next = Math.max(0.35, Math.round((cur + delta) * 100) / 100);
        setAmount(String(next));
    };

    // Derived chart & digit statistics
    const latestTick = ticks[ticks.length - 1];
    const latestPriceStr = latestTick ? latestTick.quote.toFixed(decimals) : null;
    const latestDigit = latestPriceStr ? Number(latestPriceStr[latestPriceStr.length - 1]) : null;

    const digitStats = useMemo(() => {
        const counts = Array(10).fill(0);
        if (!ticks.length) {
            return { pcts: counts.map(() => 10), maxDigit: -1, minDigit: -1 };
        }
        ticks.forEach(t => {
            const formatted = t.quote.toFixed(decimals);
            const d = Number(formatted[formatted.length - 1]);
            if (d >= 0 && d <= 9) counts[d] += 1;
        });
        const pcts = counts.map(c => Math.round((c / ticks.length) * 1000) / 10);
        const maxVal = Math.max(...counts);
        const minVal = Math.min(...counts);
        return {
            pcts,
            maxDigit: counts.indexOf(maxVal),
            minDigit: counts.indexOf(minVal),
        };
    }, [ticks, decimals]);

    const chartGeometry = useMemo(() => {
        if (ticks.length < 2) return null;
        const prices = ticks.map(t => t.quote);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const pad = (max - min) * 0.12 || 0.0001;
        const low = min - pad;
        const high = max + pad;
        const span = high - low || 1;
        const width = 640;
        const height = 260;

        const pts = ticks.map((t, idx) => {
            const x = (idx / (ticks.length - 1)) * width;
            const y = height - ((t.quote - low) / span) * height;
            return { x, y };
        });

        const linePath = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
        const lastPt = pts[pts.length - 1];

        return {
            width,
            height,
            linePath,
            areaPath,
            lastPt,
            highLabel: max.toFixed(decimals),
            midLabel: ((max + min) / 2).toFixed(decimals),
            lowLabel: min.toFixed(decimals),
        };
    }, [ticks, decimals]);

    const groupedMarkets = useMemo(() => {
        const groups: Record<string, TMarketItem[]> = {};
        markets.forEach(m => {
            const key = `${m.market_display_name} — ${m.submarket_display_name}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(m);
        });
        return Object.entries(groups);
    }, [markets]);

    const directions = FAMILY_DIRECTIONS[family];

    return (
        <div className={classNames('dtrader-native', { 'dtrader-native--light': !is_dark_mode_on })}>
            {/* Top Market & Account Bar */}
            <div className='dtrader-native__topbar'>
                <div className='dtrader-native__market-bar'>
                    <div className='dtrader-native__market-select-wrap'>
                        <label htmlFor='dtrader-market-select' className='dtrader-native__micro-label'>
                            {localize('Market')}
                        </label>
                        <select
                            id='dtrader-market-select'
                            className='dtrader-native__market-select'
                            value={symbol}
                            onChange={e => setSymbol(e.target.value)}
                        >
                            {groupedMarkets.map(([groupName, groupItems]) => (
                                <optgroup key={groupName} label={groupName}>
                                    {groupItems.map(item => (
                                        <option key={item.symbol} value={item.symbol}>
                                            {item.display_name}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    <div className='dtrader-native__spot-box'>
                        <span className='dtrader-native__micro-label'>{localize('Live Spot')}</span>
                        <div
                            className={classNames('dtrader-native__spot-value', {
                                'is-up': priceFlash === 'up',
                                'is-down': priceFlash === 'down',
                            })}
                        >
                            {latestPriceStr ?? localize('Connecting...')}
                            {latestDigit !== null && (
                                <span className='dtrader-native__last-digit-badge'>{latestDigit}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className='dtrader-native__account-bar'>
                    {hasAuthSession ? (
                        <div className={classNames('dtrader-native__account-pill', isDemo ? 'is-demo' : 'is-real')}>
                            <span className='dtrader-native__account-tag'>
                                {isDemo ? localize('DEMO') : localize('REAL')}
                            </span>
                            <span className='dtrader-native__account-id'>{resolvedLoginId}</span>
                            <strong className='dtrader-native__account-bal'>
                                {formatMoney(client?.balance, currency)}
                            </strong>
                        </div>
                    ) : (
                        <button
                            type='button'
                            className='dtrader-native__login-btn'
                            onClick={() => startLogin()}
                        >
                            {localize('Log in to Trade')}
                        </button>
                    )}
                </div>
            </div>

            {/* Trade Type Selector Strip */}
            <div className='dtrader-native__family-strip' role='tablist' aria-label='Trade types'>
                {TRADE_FAMILIES.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        role='tab'
                        aria-selected={family === item.id}
                        className={classNames('dtrader-native__family-tab', {
                            'is-active': family === item.id,
                        })}
                        onClick={() => setFamily(item.id)}
                    >
                        {localize(item.label)}
                    </button>
                ))}
            </div>

            {/* Main Workspace: Live Chart + Digit Strip on Left, Trade Ticket on Right */}
            <div className='dtrader-native__workspace'>
                <div className='dtrader-native__left-col'>
                    {/* Live Chart Panel */}
                    <section className='dtrader-native__chart-card'>
                        <div className='dtrader-native__chart-header'>
                            <div>
                                <h2 className='dtrader-native__symbol-title'>{currentMarket?.display_name}</h2>
                                <span className='dtrader-native__symbol-sub'>
                                    {currentMarket?.market_display_name} · {currentMarket?.submarket_display_name}
                                </span>
                            </div>
                            <span className={classNames('dtrader-native__stream-badge', { 'is-live': !!latestTick })}>
                                {latestTick ? localize('● LIVE STREAM') : localize('○ CONNECTING')}
                            </span>
                        </div>

                        <div className='dtrader-native__chart-canvas'>
                            {chartGeometry ? (
                                <>
                                    <svg
                                        viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                                        preserveAspectRatio='none'
                                        className='dtrader-native__svg'
                                    >
                                        <defs>
                                            <linearGradient id='dtraderAreaGrad' x1='0' y1='0' x2='0' y2='1'>
                                                <stop offset='0%' stopColor='#14b8a6' stopOpacity='0.34' />
                                                <stop offset='100%' stopColor='#14b8a6' stopOpacity='0.0' />
                                            </linearGradient>
                                        </defs>
                                        <line
                                            x1='0'
                                            y1={chartGeometry.lastPt.y}
                                            x2={chartGeometry.width}
                                            y2={chartGeometry.lastPt.y}
                                            stroke='#14b8a6'
                                            strokeDasharray='4 4'
                                            strokeOpacity='0.5'
                                        />
                                        <path d={chartGeometry.areaPath} fill='url(#dtraderAreaGrad)' />
                                        <path
                                            d={chartGeometry.linePath}
                                            fill='none'
                                            stroke='#14b8a6'
                                            strokeWidth='2.2'
                                            vectorEffect='non-scaling-stroke'
                                        />
                                        <circle
                                            cx={chartGeometry.lastPt.x}
                                            cy={chartGeometry.lastPt.y}
                                            r='4.5'
                                            fill='#14b8a6'
                                        />
                                    </svg>
                                    <div className='dtrader-native__y-axis'>
                                        <span>{chartGeometry.highLabel}</span>
                                        <span>{chartGeometry.midLabel}</span>
                                        <span>{chartGeometry.lowLabel}</span>
                                    </div>
                                </>
                            ) : (
                                <div className='dtrader-native__chart-placeholder'>
                                    {localize('Streaming live ticks from Deriv...')}
                                </div>
                            )}
                        </div>

                        {/* Live 0-9 Digit Distribution Circles */}
                        <div className='dtrader-native__digits-bar'>
                            <div className='dtrader-native__digits-header'>
                                <span>{localize('Last 100 Ticks Digit Distribution')}</span>
                                {needsDigitPrediction && (
                                    <span>
                                        {localize('Selected Prediction')}: <strong>{prediction}</strong>
                                    </span>
                                )}
                            </div>
                            <div className='dtrader-native__digits-grid'>
                                {digitStats.pcts.map((pct, d) => {
                                    const isCurrent = latestDigit === d;
                                    const isSelected = needsDigitPrediction && prediction === d;
                                    return (
                                        <button
                                            key={d}
                                            type='button'
                                            onClick={() => {
                                                if (needsDigitPrediction) setPrediction(d);
                                            }}
                                            className={classNames('dtrader-native__digit-circle', {
                                                'is-current': isCurrent,
                                                'is-selected': isSelected,
                                                'is-hot': digitStats.maxDigit === d,
                                                'is-cold': digitStats.minDigit === d,
                                            })}
                                            title={
                                                needsDigitPrediction
                                                    ? `${localize('Select digit')} ${d} (${pct}%)`
                                                    : `${localize('Digit')} ${d}: ${pct}%`
                                            }
                                        >
                                            <span className='dtrader-native__digit-num'>{d}</span>
                                            <span className='dtrader-native__digit-pct'>{pct.toFixed(1)}%</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    {/* Open & Recent Positions Panel */}
                    <section className='dtrader-native__positions-card'>
                        <div className='dtrader-native__positions-header'>
                            <h3>{localize('Positions & Recent Trades')}</h3>
                            <span>
                                {contracts.length} {contracts.length === 1 ? localize('contract') : localize('contracts')}
                            </span>
                        </div>

                        {!hasAuthSession ? (
                            <p className='dtrader-native__empty-msg'>
                                {localize('Log in to your Deriv account to place trades and track live positions.')}
                            </p>
                        ) : contracts.length === 0 ? (
                            <p className='dtrader-native__empty-msg'>
                                {localize('No contracts in this session yet. Choose your parameters on the right and click a trade button to execute.')}
                            </p>
                        ) : (
                            <div className='dtrader-native__positions-list'>
                                {contracts.map(c => {
                                    const isClosed = Boolean(
                                        c.is_sold || c.status === 'sold' || c.status === 'won' || c.status === 'lost'
                                    );
                                    const profitVal =
                                        c.profit !== undefined
                                            ? c.profit
                                            : c.sell_price !== undefined
                                              ? c.sell_price - c.buy_price
                                              : undefined;
                                    const isWin = profitVal !== undefined && profitVal > 0;
                                    const isLoss = profitVal !== undefined && profitVal < 0;
                                    const canSell = !isClosed && Boolean(c.is_valid_to_sell);

                                    return (
                                        <div key={c.contract_id} className='dtrader-native__position-row'>
                                            <div className='dtrader-native__position-main'>
                                                <div className='dtrader-native__position-top'>
                                                    <span
                                                        className={classNames('dtrader-native__status-pill', {
                                                            'is-open': !isClosed,
                                                            'is-won': isClosed && isWin,
                                                            'is-lost': isClosed && isLoss,
                                                        })}
                                                    >
                                                        {!isClosed
                                                            ? localize('OPEN')
                                                            : isWin
                                                              ? localize('WON')
                                                              : isLoss
                                                                ? localize('LOST')
                                                                : localize('CLOSED')}
                                                    </span>
                                                    <strong className='dtrader-native__position-type'>
                                                        {c.contract_type} · {c.symbol}
                                                    </strong>
                                                    <span className='dtrader-native__position-id'>#{c.contract_id}</span>
                                                </div>
                                                {c.longcode && (
                                                    <p className='dtrader-native__position-desc'>{c.longcode}</p>
                                                )}
                                                <div className='dtrader-native__position-spots'>
                                                    <span>
                                                        {localize('Buy')}: <strong>{formatMoney(c.buy_price, c.currency)}</strong>
                                                    </span>
                                                    {c.entry_spot !== undefined && (
                                                        <span>
                                                            {localize('Entry')}: <strong>{c.entry_spot}</strong>
                                                        </span>
                                                    )}
                                                    {(c.exit_spot ?? c.current_spot) !== undefined && (
                                                        <span>
                                                            {isClosed ? localize('Exit') : localize('Current')}:{' '}
                                                            <strong>{c.exit_spot ?? c.current_spot}</strong>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className='dtrader-native__position-right'>
                                                {profitVal !== undefined && (
                                                    <strong
                                                        className={classNames('dtrader-native__position-pl', {
                                                            'is-pos': profitVal > 0,
                                                            'is-neg': profitVal < 0,
                                                        })}
                                                    >
                                                        {profitVal > 0 ? '+' : ''}
                                                        {formatMoney(profitVal, c.currency)}
                                                    </strong>
                                                )}
                                                {canSell && (
                                                    <button
                                                        type='button'
                                                        className='dtrader-native__sell-btn'
                                                        disabled={sellingId === c.contract_id}
                                                        onClick={() => handleSellContract(c.contract_id)}
                                                    >
                                                        {sellingId === c.contract_id
                                                            ? localize('Selling...')
                                                            : `${localize('Sell')} ${
                                                                  c.bid_price !== undefined
                                                                      ? formatMoney(c.bid_price, c.currency)
                                                                      : ''
                                                              }`}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </div>

                {/* Right Column: Authentic DTrader Trade Ticket */}
                <aside className='dtrader-native__ticket-card'>
                    {/* Duration Section */}
                    <div className='dtrader-native__field-group'>
                        <div className='dtrader-native__label-row'>
                            <label htmlFor='dtrader-duration-input'>{localize('Duration')}</label>
                            {!isDigitFamily ? (
                                <select
                                    className='dtrader-native__unit-select'
                                    value={durationUnit}
                                    onChange={e => {
                                        const nextUnit = e.target.value as TDurationUnit;
                                        setDurationUnit(nextUnit);
                                        if (nextUnit === 't') setDuration('5');
                                        else if (nextUnit === 's') setDuration('15');
                                        else setDuration('1');
                                    }}
                                >
                                    <option value='t'>{localize('Ticks')}</option>
                                    <option value='s'>{localize('Seconds')}</option>
                                    <option value='m'>{localize('Minutes')}</option>
                                </select>
                            ) : (
                                <span className='dtrader-native__unit-fixed'>{localize('Ticks (1 - 10)')}</span>
                            )}
                        </div>

                        {durationUnit === 't' && (
                            <div className='dtrader-native__quick-chips'>
                                {TICK_CHOICES.map(t => (
                                    <button
                                        key={t}
                                        type='button'
                                        className={classNames('dtrader-native__chip', {
                                            'is-active': Number(duration) === t,
                                        })}
                                        onClick={() => setDuration(String(t))}
                                    >
                                        {t}t
                                    </button>
                                ))}
                            </div>
                        )}

                        <input
                            id='dtrader-duration-input'
                            type='number'
                            min={durationUnit === 's' ? 15 : 1}
                            max={durationUnit === 't' ? 10 : 1440}
                            step='1'
                            className='dtrader-native__input'
                            value={duration}
                            onChange={e => setDuration(e.target.value)}
                        />
                    </div>

                    {/* Digit Prediction Selector (Over/Under & Matches/Differs) */}
                    {needsDigitPrediction && (
                        <div className='dtrader-native__field-group'>
                            <label>{localize('Last Digit Prediction')}</label>
                            <div className='dtrader-native__prediction-grid'>
                                {Array.from({ length: 10 }, (_, d) => (
                                    <button
                                        key={d}
                                        type='button'
                                        className={classNames('dtrader-native__pred-btn', {
                                            'is-active': prediction === d,
                                        })}
                                        onClick={() => setPrediction(d)}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Barrier Offset Input (Higher/Lower) */}
                    {needsBarrierOffset && (
                        <div className='dtrader-native__field-group'>
                            <label htmlFor='dtrader-barrier-input'>{localize('Barrier (Offset or Spot)')}</label>
                            <input
                                id='dtrader-barrier-input'
                                type='text'
                                className='dtrader-native__input'
                                value={barrierOffset}
                                placeholder='+0.50'
                                onChange={e => setBarrierOffset(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Stake / Payout Basis & Amount */}
                    <div className='dtrader-native__field-group'>
                        <div className='dtrader-native__basis-tabs'>
                            <button
                                type='button'
                                className={classNames('dtrader-native__basis-btn', { 'is-active': basis === 'stake' })}
                                onClick={() => setBasis('stake')}
                            >
                                {localize('Stake')}
                            </button>
                            <button
                                type='button'
                                className={classNames('dtrader-native__basis-btn', { 'is-active': basis === 'payout' })}
                                onClick={() => setBasis('payout')}
                            >
                                {localize('Payout')}
                            </button>
                        </div>

                        <div className='dtrader-native__stepper'>
                            <button
                                type='button'
                                className='dtrader-native__step-btn'
                                onClick={() => adjustStake(-0.5)}
                                aria-label='Decrease amount'
                            >
                                −
                            </button>
                            <div className='dtrader-native__amount-wrap'>
                                <input
                                    type='number'
                                    min='0.35'
                                    step='0.01'
                                    className='dtrader-native__amount-input'
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                />
                                <span className='dtrader-native__currency-suffix'>{currency}</span>
                            </div>
                            <button
                                type='button'
                                className='dtrader-native__step-btn'
                                onClick={() => adjustStake(0.5)}
                                aria-label='Increase amount'
                            >
                                +
                            </button>
                        </div>

                        <div className='dtrader-native__quick-chips'>
                            {QUICK_STAKES.map(preset => (
                                <button
                                    key={preset}
                                    type='button'
                                    className={classNames('dtrader-native__chip', {
                                        'is-active': Number(amount) === preset,
                                    })}
                                    onClick={() => setAmount(String(preset))}
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>
                    </div>

                    {tradeError && (
                        <div className='dtrader-native__error-banner' role='alert'>
                            {tradeError}
                        </div>
                    )}

                    {/* Dual Purchase Buttons (DTrader style) */}
                    <div className='dtrader-native__purchase-stack'>
                        {directions.map(dir => {
                            const q = quotes[dir.contractType];
                            const hasQuoteError = Boolean(q?.error);
                            const netProfit = q && !hasQuoteError ? q.payout - q.askPrice : 0;
                            const returnPct =
                                q && !hasQuoteError && q.askPrice > 0 ? (netProfit / q.askPrice) * 100 : 0;
                            const isThisBuying = buyingType === dir.contractType;

                            return (
                                <div key={dir.contractType} className='dtrader-native__purchase-card'>
                                    <div className='dtrader-native__quote-meta'>
                                        {hasQuoteError ? (
                                            <span className='dtrader-native__quote-unavail'>{q?.error}</span>
                                        ) : q ? (
                                            <>
                                                <span>
                                                    {localize('Stake')}:{' '}
                                                    <strong>{formatMoney(q.askPrice, currency)}</strong>
                                                </span>
                                                <span>
                                                    {localize('Payout')}:{' '}
                                                    <strong>{formatMoney(q.payout, currency)}</strong> (
                                                    {returnPct.toFixed(1)}%)
                                                </span>
                                            </>
                                        ) : (
                                            <span>
                                                {isQuoting ? localize('Fetching live quote...') : localize('Ready')}
                                            </span>
                                        )}
                                    </div>

                                    <button
                                        type='button'
                                        disabled={Boolean(buyingType) || hasQuoteError}
                                        onClick={() => handlePurchase(dir)}
                                        className={classNames(
                                            'dtrader-native__buy-btn',
                                            dir.variant === 'up' ? 'is-up' : 'is-down'
                                        )}
                                    >
                                        <span className='dtrader-native__buy-label'>
                                            {!hasAuthSession
                                                ? `${localize('Log in to Buy')} ${localize(dir.label)}`
                                                : isThisBuying
                                                  ? localize('Placing Trade...')
                                                  : localize(dir.label)}
                                        </span>
                                        {q && !hasQuoteError && (
                                            <span className='dtrader-native__buy-return'>
                                                +{returnPct.toFixed(1)}%
                                            </span>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
});

export default Dtrader;
