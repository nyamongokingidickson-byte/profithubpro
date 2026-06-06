import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken, getLoginId } from '@/external/bot-skeleton/services/api/appId';
import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import { historyToTicks } from '@/external/bot-skeleton/utils/binary-utils';
// import { tradeOptionToBuy } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

// Extended trade types including Matches and Rise/Fall
const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over' },
    { value: 'DIGITUNDER', label: 'Digits Under' },
    { value: 'DIGITEVEN', label: 'Even/Odd' },
    { value: 'DIGITMATCH', label: 'Digits Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
    { value: 'RISEFALL', label: 'Rise / Fall' },
];

// Safe version of tradeOptionToBuy without Blockly dependencies
const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis,
            contract_type,
            currency: trade_option.currency,
            duration: trade_option.duration,
            duration_unit: trade_option.duration_unit,
            symbol: trade_option.symbol,
        },
    };
    if (trade_option.prediction !== undefined) {
        buy.parameters.selected_tick = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
};

const isWebSocketOpen = (api: any) => api?.connection?.readyState === WebSocket.OPEN;

const waitForApiConnection = async (api: any, timeoutMs = 15000, retries = 3) => {
    if (!api) throw new Error('API not initialized');
    let currentApi = api;
    const appId = getAppId();

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        const socketUrl = currentApi.connection?.url || getSocketURL();
        const readyState = currentApi.connection?.readyState;

        console.debug('[SmartTrader] waitForApiConnection attempt', {
            attempt,
            readyState,
            socketUrl,
            appId,
        });

        if (isWebSocketOpen(currentApi)) return currentApi;

        if (readyState > WebSocket.CONNECTING && api_base?.init) {
            console.debug('[SmartTrader] WebSocket closed/errored, reinitializing central API');
            await api_base.init(true);
            currentApi = api_base.api ?? currentApi;
        }

        if (isWebSocketOpen(currentApi)) return currentApi;

        try {
            await new Promise<void>((resolve, reject) => {
                const onOpen = () => {
                    cleanup();
                    resolve();
                };

                const onCloseOrError = (event: Event) => {
                    cleanup();
                    reject(new Error(`WebSocket closed or errored before open: ${event.type}`));
                };

                const onTimeout = () => {
                    cleanup();
                    reject(new Error('WebSocket connection timeout'));
                };

                const cleanup = () => {
                    window.clearTimeout(timeoutId);
                    currentApi.connection?.removeEventListener('open', onOpen);
                    currentApi.connection?.removeEventListener('close', onCloseOrError);
                    currentApi.connection?.removeEventListener('error', onCloseOrError);
                };

                const timeoutId = window.setTimeout(onTimeout, timeoutMs);
                currentApi.connection?.addEventListener('open', onOpen);
                currentApi.connection?.addEventListener('close', onCloseOrError);
                currentApi.connection?.addEventListener('error', onCloseOrError);
            });
        } catch (error) {
            console.warn('[SmartTrader] waitForApiConnection attempt failed', { attempt, error });
            if (attempt === retries) {
                throw error;
            }
            if (api_base?.init) {
                await api_base.init(true);
                currentApi = api_base.api ?? currentApi;
            }
            continue;
        }

        if (isWebSocketOpen(currentApi)) return currentApi;

        if (attempt === retries) {
            throw new Error('WebSocket failed to open within timeout');
        }
    }

    throw new Error('WebSocket connection could not be established');
};

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const contractMessageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const lastAuthorizedTokenRef = useRef<string | null>(null);

    const lastOutcomeWasLossRef = useRef(false);
    const usedPostLossPredictionRef = useRef(false);
    const botModeRef = useRef<'normal' | 'speed' | null>(null);
    const ticksProcessedRef = useRef<number>(0);
    const purchaseInProgressRef = useRef<boolean>(false);
    const lossStreakRef = useRef<number>(0);
    const stepRef = useRef<number>(0);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    // Form state
    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [baseStake, setBaseStake] = useState<number>(0.5);
    // Predictions
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(5);
    const [eoPredPreLoss, setEoPredPreLoss] = useState<number>(0);
    const [eoPredPostLoss, setEoPredPostLoss] = useState<number>(0);
    // const [mdPrediction, setMdPrediction] = useState<number>(5); // for match/diff
    const [mdPredPreLoss, setMdPredPreLoss] = useState<number>(5);
    const [mdPredPostLoss, setMdPredPostLoss] = useState<number>(4);
    // Martingale/recovery
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(2.0);
    // Trading parameters
    const [takeProfit, setTakeProfit] = useState<number>(10);
    const [stopLoss, setStopLoss] = useState<number>(10);

    // Live digits state
    // const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [lastPrice, setLastPrice] = useState<string>('');
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [scannerIsScanning, setScannerIsScanning] = useState<boolean>(false);
    const [scannerStatus, setScannerStatus] = useState<string>('');
    const [scanRecommendations, setScanRecommendations] = useState<Array<{
        symbol: string;
        display_name: string;
        recommendation: string;
        signalType: 'over' | 'under' | 'even' | 'odd' | 'differs' | 'matches' | 'rise' | 'fall';
        overPct?: number;
        underPct?: number;
        evenPct?: number;
        oddPct?: number;
        recovery: string;
        beforeLoss: number;
        afterLoss: number;
        score: number;
        dominance?: number;
    }>>([]);
    const [loadedSignal, setLoadedSignal] = useState<{
        symbol: string;
        display_name: string;
        recommendation: string;
        signalType: 'over' | 'under' | 'even' | 'odd' | 'differs' | 'matches' | 'rise' | 'fall';
        beforeLoss: number;
        afterLoss: number;
        predictions?: number[];
        confirmationRate?: number;
    } | null>(null);
    const [loadedSignalCountdown, setLoadedSignalCountdown] = useState<number>(0);
    const [scanAllMarkets, setScanAllMarkets] = useState<boolean>(true);
    const [scannerProgress, setScannerProgress] = useState<number>(0);
    const [predictionInput, setPredictionInput] = useState<string>('');
    const [riseFallPrediction, setRiseFallPrediction] = useState<'rise' | 'fall'>('rise');
    const [marketStats, setMarketStats] = useState<Array<{ symbol: string; display_name: string; score: number; strategy: string; confirmation: string }>>([]);
    // UI toggles and counters
    const [consecWins, setConsecWins] = useState<number>(0);
    const [consecLosses, setConsecLosses] = useState<number>(0);
    const [isAutoTrading, setIsAutoTrading] = useState<boolean>(false);
    const [showTradingParams, setShowTradingParams] = useState<boolean>(false);
    const [showEngineSelection, setShowEngineSelection] = useState<boolean>(false);
    const [showTradingOptions, setShowTradingOptions] = useState<boolean>(false);
    // const [selectedEngine, setSelectedEngine] = useState<'normal' | 'speed' | null>(null);
    // const [tradingMode, setTradingMode] = useState<'normal' | 'speed'>('normal');
    const [showStopBot, setShowStopBot] = useState<boolean>(false);
    const [resultMessage, setResultMessage] = useState<string>('');
    const [resultAmount, setResultAmount] = useState<number>(0);
    const [showResultCard, setShowResultCard] = useState<boolean>(false);

    // Check for deep scan signal on mount
    useEffect(() => {
        const deepScanSignal = sessionStorage.getItem('deepScanSignal');
        const deepScanSettings = sessionStorage.getItem('deepScanSettings');

        if (deepScanSignal && deepScanSettings) {
            try {
                const signal = JSON.parse(deepScanSignal);
                const settings = JSON.parse(deepScanSettings);

                // Apply trading settings
                setTakeProfit(settings.takeProfit);
                setStopLoss(settings.stopLoss);
                setMartingaleMultiplier(settings.martingaleMultiplier);
                setStake(settings.stake);
                setBaseStake(settings.stake);

                // Clear the session storage
                sessionStorage.removeItem('deepScanSignal');
                sessionStorage.removeItem('deepScanSettings');

                loadDeepScanSignal(signal);
                setStatus(localize('Deep scan signal loaded. Select Normal Trading or Speed Bot to start.'));

            } catch (error) {
                console.error('Error loading deep scan signal:', error);
                setStatus('Error loading deep scan signal. Please check your settings and try again.');
            }
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Signal pattern tracking for alternating signals
    // const [signalHistory, setSignalHistory] = useState<Array<{
    //     type: 'over' | 'under' | 'even' | 'odd';
    //     symbol: string;
    //     timestamp: number;
    // }>>([]);
    // const [currentPattern, setCurrentPattern] = useState<{
    //     type: 'over_under' | 'even_odd';
    //     sequence: number[];
    //     currentIndex: number;
    // } | null>(null);

    const [is_running, setIsRunning] = useState(false);

    const parsePredictionDigits = (input: string): number[] => {
        return input
            .split(/[ ,;]+/)
            .map(item => Number(item.trim()))
            .filter(num => Number.isInteger(num) && num >= 0 && num <= 9);
    };

    const predictionDigits = parsePredictionDigits(predictionInput);
    const stopFlagRef = useRef<boolean>(false);
    const lastPurchaseTickRef = useRef<number>(-1);

    React.useEffect(() => {
        if (!loadedSignal) {
            setLoadedSignalCountdown(0);
            return;
        }

        setLoadedSignalCountdown(60);
        const timer = window.setInterval(() => {
            setLoadedSignalCountdown(prev => {
                if (prev <= 1) {
                    setLoadedSignal(null);
                    setScannerStatus(localize('Signal expired. Ready for next scan.'));
                    window.clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [loadedSignal]);

    // const getHintClass = (d: number) => {
    //     if (tradeType === 'DIGITEVEN') {
    //         const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
    //         return activePred === 0 ? (d % 2 === 0 ? 'is-green' : 'is-red') : (d % 2 !== 0 ? 'is-green' : 'is-red');
    //     }
    //     if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
    //         const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
    //         if (tradeType === 'DIGITOVER') {
    //             if (activePred <= 4) {
    //                 if (d > activePred) return 'is-green';
    //                 if (d < activePred) return 'is-red';
    //                 return 'is-neutral';
    //             }
    //             if (d < activePred) return 'is-green';
    //             if (d > activePred) return 'is-red';
    //             return 'is-neutral';
    //         }
    //         if (tradeType === 'DIGITUNDER') {
    //             if (d < activePred) return 'is-green';
    //             if (d > activePred) return 'is-red';
    //             return 'is-neutral';
    //         }
    //     }
    //     if (tradeType === 'DIGITDIFF') {
    //         const activePred = lastOutcomeWasLossRef.current ? mdPredPostLoss : mdPredPreLoss;
    //         return d === activePred ? 'is-red' : 'is-green';
    //     }
    //     return '';
    // };

    const applySignalSettings = (signalItem: {
        symbol: string;
        display_name: string;
        recommendation: string;
        beforeLoss: number;
        afterLoss: number;
        signalType: 'over' | 'under' | 'even' | 'odd' | 'differs';
    }) => {
        setSymbol(signalItem.symbol);
        startTicks(signalItem.symbol);

        let nextTradeType = 'DIGITOVER';
        if (signalItem.signalType === 'under') {
            nextTradeType = 'DIGITUNDER';
        } else if (signalItem.signalType === 'even' || signalItem.signalType === 'odd') {
            nextTradeType = 'DIGITEVEN';
        } else if (signalItem.signalType === 'differs') {
            nextTradeType = 'DIGITDIFF';
        }
        setTradeType(nextTradeType);

        if (nextTradeType === 'DIGITEVEN') {
            const evenOddValue = signalItem.signalType === 'even' ? 0 : 1;
            setEoPredPreLoss(evenOddValue);
            setEoPredPostLoss(evenOddValue === 0 ? 1 : 0);
        } else if (nextTradeType === 'DIGITDIFF') {
            setMdPredPreLoss(signalItem.beforeLoss);
            setMdPredPostLoss(signalItem.afterLoss);
        } else if (nextTradeType === 'DIGITOVER' || nextTradeType === 'DIGITUNDER') {
            setOuPredPreLoss(signalItem.beforeLoss);
            setOuPredPostLoss(signalItem.afterLoss);
        } else if (nextTradeType === 'DIGITMATCH') {
            setMdPredPreLoss(signalItem.predictions?.[0] ?? signalItem.beforeLoss);
            setPredictionInput(signalItem.predictions?.join(', ') ?? String(signalItem.beforeLoss));
        } else if (nextTradeType === 'RISEFALL') {
            setRiseFallPrediction(signalItem.signalType === 'fall' ? 'fall' : 'rise');
            setPredictionInput(signalItem.predictions?.join(', ') ?? '');
        }

        if (signalItem.predictions?.length) {
            setPredictionInput(signalItem.predictions.join(', '));
        }

        setLoadedSignal(signalItem);
    };

    const loadBestSignal = async () => {
        if (scanRecommendations.length === 0) {
            await scanAllVolatilitySymbols();
        }
        if (scanRecommendations.length > 0) {
            const bestSignal = scanRecommendations.sort((a, b) => b.score - a.score)[0];
            applySignalSettings(bestSignal);
            setScanRecommendations([]);
            setScannerStatus(localize('Best signal loaded automatically.'));
        }
    };

    const loadDeepScanSignal = (signalItem: {
        symbol: string;
        display_name: string;
        recommendation: string;
        beforeLoss: number;
        afterLoss: number;
        signalType: 'over' | 'under' | 'even' | 'odd' | 'differs';
    }) => {
        applySignalSettings(signalItem);
        setScanRecommendations([]);
        setScannerStatus(localize('Deep scan signal loaded. Select Normal Trading or Speed Bot to start.'));
    };

    useEffect(() => {
        // Initialize API connection and fetch active symbols
        const api = api_base.api ?? generateDerivApiInstance();
        apiRef.current = api;

        const fetchActiveSymbols = async (socketApi: any) => {
            const payload = { active_symbols: 'brief' };
            const socketUrl = socketApi.connection?.url || getSocketURL();
            const appId = getAppId();

            console.debug('[SmartTrader] active_symbols request payload', {
                payload,
                socketUrl,
                appId,
                readyState: socketApi.connection?.readyState,
            });

            const response = await socketApi.send(payload);
            console.debug('[SmartTrader] active_symbols response', response);

            if (!response) {
                throw new Error('No response received from active_symbols request');
            }
            if (response.error) {
                throw response.error;
            }
            if (!Array.isArray(response.active_symbols)) {
                throw new Error(`Unexpected active_symbols response: ${JSON.stringify(response)}`);
            }

            return response.active_symbols;
        };

        const init = async () => {
            try {
                let socketApi = api_base.api ?? api;
                socketApi = await waitForApiConnection(socketApi);
                apiRef.current = socketApi;

                // Authorize if token exists
                const token = V2GetActiveToken();
                if (token) {
                    try {
                        const { authorize, error } = await socketApi.authorize(token);
                        if (error) {
                            console.error('Authorization error:', error);
                            setStatus('Please log in to start trading.');
                        } else {
                            setIsAuthorized(true);
                            lastAuthorizedTokenRef.current = token;
                            const loginid = getLoginId() || authorize?.loginid || V2GetActiveClientId();
                            setAccountCurrency(authorize?.currency || 'USD');
                            store?.client?.setLoginId?.(loginid || '');
                            store?.client?.setCurrency?.(authorize?.currency || 'USD');
                            store?.client?.setIsLoggedIn?.(true);
                        }
                    } catch (authError) {
                        console.error('Auth error:', authError);
                        setStatus('Please log in to start trading.');
                    }
                } else {
                    setStatus('Please log in to start trading.');
                }

                const activeSymbols = await fetchActiveSymbols(socketApi);
                const syn = activeSymbols
                    .filter((s: any) => /synthetic/i.test(s.market))
                    .filter((s: any) => /^Volatility\s+\d+(?:\s|\(|$)/i.test(s.display_name))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }))
                    .sort((a: any, b: any) => {
                        const valueA = Number(a.display_name.match(/Volatility\s+(\d+)/i)?.[1] ?? 0);
                        const valueB = Number(b.display_name.match(/Volatility\s+(\d+)/i)?.[1] ?? 0);
                        return valueA - valueB || a.display_name.localeCompare(b.display_name);
                    });

                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) setSymbol(syn[0].symbol);
                if (syn[0]?.symbol) startTicks(syn[0].symbol);
            } catch (e: any) {
                console.error('SmartTrader init error', e);
                const errorMessage = e?.message || JSON.stringify(e) || 'Failed to load symbols';
                setStatus(errorMessage);
            }
        };

        init();

        return () => {
            // Clean up streams and socket
            try {
                if (tickStreamIdRef.current) {
                    apiRef.current?.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current) {
                    apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                if (contractMessageHandlerRef.current) {
                    apiRef.current?.connection?.removeEventListener('message', contractMessageHandlerRef.current);
                    contractMessageHandlerRef.current = null;
                }
                if (api && api !== api_base.api) {
                    api.disconnect?.();
                }
            } catch { /* noop */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const authorizeIfNeeded = async () => {
        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }

        if (is_authorized && lastAuthorizedTokenRef.current === token) {
            return; // Already authorized
        }

        // If we get here, we need to authorize
        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            setStatus(`Authorization error: ${error.message || error.code}`);
            setIsAuthorized(false);
            lastAuthorizedTokenRef.current = null;
            throw error;
        }

        setIsAuthorized(true);
        lastAuthorizedTokenRef.current = token;

        const loginid = getLoginId() || authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');
        try {
            // Sync Smart Trader auth state into shared ClientStore so Transactions store keys correctly by account
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {
            // Ignore errors when syncing client store state
        }
    };

    const stopTicks = () => {
        try {
            if (tickStreamIdRef.current) {
                apiRef.current?.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current) {
                apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
        } catch {
            // Ignore cleanup errors
        }
    };

    const purchaseOnTick = async (currentTickCount: number) => {
        if (!botModeRef.current || stopFlagRef.current || purchaseInProgressRef.current) return;
        const lastPurchaseTick = lastPurchaseTickRef.current;
        const shouldPurchase = botModeRef.current === 'speed'
            ? currentTickCount !== lastPurchaseTick
            : currentTickCount - lastPurchaseTick >= 2;

        if (!(shouldPurchase && currentTickCount > lastPurchaseTick)) {
            return;
        }

        purchaseInProgressRef.current = true;
        try {
            const effectiveStake = stepRef.current > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, stepRef.current)).toFixed(2)) : stake;
            setStake(effectiveStake);
            const purchaseType = tradeType;
            const isOU = purchaseType === 'DIGITOVER' || purchaseType === 'DIGITUNDER';
            if (isOU) {
                lastOutcomeWasLossRef.current = lossStreakRef.current > 0;
            }
            const buy = await purchaseOnce(purchaseType, effectiveStake);
            lastPurchaseTickRef.current = currentTickCount;
            // After using post-loss prediction once, return to pre-loss for next trade
            if (usedPostLossPredictionRef.current) {
                lastOutcomeWasLossRef.current = false;
            }

            try {
                const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                transactions.onBotContractEvent({
                    contract_id: buy?.contract_id,
                    transaction_ids: { buy: buy?.transaction_id },
                    buy_price: buy?.buy_price,
                    currency: account_currency,
                    contract_type: purchaseType as any,
                    underlying: symbol,
                    display_name: symbol_display,
                    date_start: Math.floor(Date.now() / 1000),
                    status: 'open',
                } as any);
            } catch {}

            run_panel.setHasOpenContract(true);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            try {
                const res = await apiRef.current.send({
                    proposal_open_contract: 1,
                    contract_id: buy?.contract_id,
                    subscribe: 1,
                });
                const { error, proposal_open_contract: pocInit, subscription } = res || {};
                if (error) throw error;

                let pocSubId: string | null = subscription?.id || null;
                const targetId = String(buy?.contract_id || '');

                if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                    transactions.onBotContractEvent(pocInit);
                    run_panel.setHasOpenContract(true);
                }

                const onMsg = (evt: MessageEvent) => {
                    try {
                        const data = JSON.parse(evt.data as any);
                        if (data?.msg_type === 'proposal_open_contract') {
                            const poc = data.proposal_open_contract;
                            if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                            if (String(poc?.contract_id || '') === targetId) {
                                transactions.onBotContractEvent(poc);
                                run_panel.setHasOpenContract(true);
                                if (poc?.is_sold || poc?.status === 'sold') {
                                    run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                    run_panel.setHasOpenContract(false);
                                    if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                    apiRef.current?.connection?.removeEventListener('message', onMsg);
                                    contractMessageHandlerRef.current = null;
                                    const profit = Number(poc?.profit || 0);
                                    if (profit > 0) {
                                        lastOutcomeWasLossRef.current = false;
                                        usedPostLossPredictionRef.current = false;
                                        lossStreakRef.current = 0;
                                        stepRef.current = 0;
                                        setStake(baseStake);
                                        setConsecWins(prev => prev + 1);
                                        setConsecLosses(0);
                                    } else {
                                        lastOutcomeWasLossRef.current = true;
                                        usedPostLossPredictionRef.current = false;
                                        lossStreakRef.current++;
                                        stepRef.current = Math.min(stepRef.current + 1, 50);
                                        setConsecLosses(prev => prev + 1);
                                        setConsecWins(0);
                                    }
                                }
                            }
                        }
                    } catch {
                        // noop
                    }
                };
                contractMessageHandlerRef.current = onMsg;
                apiRef.current?.connection?.addEventListener('message', onMsg);
            } catch (subErr) {
                // eslint-disable-next-line no-console
                console.error('subscribe poc error', subErr);
            }
        } catch (error: any) {
            setStatus(`Purchase failed: ${error?.message || error}`);
        } finally {
            purchaseInProgressRef.current = false;
        }
    };

    const startTicks = async (sym: string) => {
        stopTicks();
        setLastDigit(null);
        ticksProcessedRef.current = 0;
        setTicksProcessed(0);
        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;
            // Listen for streaming ticks on the raw websocket
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = data.tick.quote;
                        const quoteStr = String(quote);
                        const digit = Number(quoteStr.slice(-1));
                        setLastPrice(quoteStr);
                        setLastDigit(digit);
                        ticksProcessedRef.current += 1;
                        const currentTickCount = ticksProcessedRef.current;
                        setTicksProcessed(currentTickCount);
                        if (botModeRef.current && !stopFlagRef.current) {
                            purchaseOnTick(currentTickCount);
                        }
                    }
                    if (data?.forget?.id && data?.forget?.id === tickStreamIdRef.current) {
                        // stopped
                    }
                } catch {}
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);

        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('startTicks error', e);
        }
    };

    const purchaseOnce = async (activeTradeType: string = tradeType, explicitStake?: number) => {
        await authorizeIfNeeded();

        const effectiveStake = explicitStake !== undefined ? explicitStake : stake;
        const purchaseType = activeTradeType === 'RISEFALL'
            ? riseFallPrediction === 'fall'
                ? 'TICKLOW'
                : 'TICKHIGH'
            : activeTradeType;

        const trade_option: any = {
            amount: Number(effectiveStake),
            basis: 'stake',
            contractTypes: [purchaseType],
            currency: account_currency,
            duration: Number(ticks),
            duration_unit: 't',
            symbol,
        };

        const selectedPrediction = predictionDigits.length ? predictionDigits[0] : undefined;

        if (activeTradeType === 'DIGITOVER' || activeTradeType === 'DIGITUNDER') {
            const defaultPrediction = lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current
                ? ouPredPostLoss
                : ouPredPreLoss;
            trade_option.prediction = Number(selectedPrediction ?? defaultPrediction);
            if (lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current) {
                usedPostLossPredictionRef.current = true;
            }
        } else if (activeTradeType === 'DIGITEVEN') {
            const defaultPrediction = lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current
                ? eoPredPostLoss
                : eoPredPreLoss;
            trade_option.prediction = Number(selectedPrediction ?? defaultPrediction);
            if (lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current) {
                usedPostLossPredictionRef.current = true;
            }
        } else if (activeTradeType === 'DIGITMATCH' || activeTradeType === 'DIGITDIFF') {
            const defaultPrediction = activeTradeType === 'DIGITDIFF'
                ? (lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current ? mdPredPostLoss : mdPredPreLoss)
                : (selectedPrediction ?? mdPredPreLoss);
            trade_option.prediction = Number(defaultPrediction);
            if (activeTradeType === 'DIGITDIFF' && lastOutcomeWasLossRef.current && !usedPostLossPredictionRef.current) {
                usedPostLossPredictionRef.current = true;
            }
        }

        const buy_req = tradeOptionToBuy(purchaseType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);
        return buy;
    };

    const onRun = async (mode: 'normal' | 'speed') => {
        // Set default values if not set
        if (!stopLoss) setStopLoss(10); // Default stop loss of 10 units
        if (!takeProfit) setTakeProfit(10); // Default take profit of 10 units

        botModeRef.current = mode;
        setIsAutoTrading(true);
        setShowStopBot(true);
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1); // Transactions tab index in run panel tabs
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            lossStreakRef.current = 0;
            stepRef.current = 0;
            baseStake !== stake && setBaseStake(stake);
            setConsecWins(0);
            setConsecLosses(0);
            lastOutcomeWasLossRef.current = false;
            usedPostLossPredictionRef.current = false;
            lastPurchaseTickRef.current = -1;

            // Purchase immediately when starting
            if (lastDigit !== null) {
                const buy = await purchaseOnce(tradeType);
                lastPurchaseTickRef.current = ticksProcessedRef.current;

                // Seed an initial transaction row
                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any,
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                // Subscribe to contract updates
                try {
                    const res = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy?.contract_id,
                        subscribe: 1,
                    });
                    const { error, proposal_open_contract: pocInit, subscription } = res || {};
                    if (error) throw error;

                    let pocSubId: string | null = subscription?.id || null;
                    const targetId = String(buy?.contract_id || '');

                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                if (String(poc?.contract_id || '') === targetId) {
                                    transactions.onBotContractEvent(poc);
                                    run_panel.setHasOpenContract(true);
                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        contractMessageHandlerRef.current = null;
                                        const profit = Number(poc?.profit || 0);
                                        if (profit > 0) {
                                            lastOutcomeWasLossRef.current = false;
                                            lossStreakRef.current = 0;
                                            stepRef.current = 0;
                                            setStake(baseStake);
                                            setConsecWins(prev => prev + 1);
                                            setConsecLosses(0);
                                        } else {
                                            lastOutcomeWasLossRef.current = true;
                                            lossStreakRef.current++;
                                            stepRef.current = Math.min(stepRef.current + 1, 50);
                                            setConsecLosses(prev => prev + 1);
                                            setConsecWins(0);
                                        }
                                    }
                                }
                            }
                        } catch {
                            // noop
                        }
                    };
                    contractMessageHandlerRef.current = onMsg;
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    // eslint-disable-next-line no-console
                    console.error('subscribe poc error', subErr);
                }
            }

            while (!stopFlagRef.current) {
                // Check profit/loss conditions
                const currentProfit = Number(store?.summary_card?.profit || 0);
                if (currentProfit >= takeProfit) {
                    setResultMessage('Congratulations! You hit your Take Profit target!');
                    setResultAmount(currentProfit);
                    setShowResultCard(true);
                    stopFlagRef.current = true;
                    break;
                }
                if (currentProfit <= -Math.abs(stopLoss)) {
                    setResultMessage('Sorry, you hit your Stop Loss. Better luck next time!');
                    setResultAmount(currentProfit);
                    setShowResultCard(true);
                    stopFlagRef.current = true;
                    break;
                }

                // Continuous purchase is handled by tick events in purchaseOnTick.
                await new Promise(res => setTimeout(res, 100));
            }
        } catch (e: unknown) {
            // eslint-disable-next-line no-console
            console.error('SmartTrader run loop error', e);
            const msg = (e as any)?.message || (e as any)?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            setIsAutoTrading(false);
            setShowStopBot(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const scanAllVolatilitySymbols = async () => {
        if (!apiRef.current) return;
        if (!symbols.length) {
            setScannerStatus(localize('No volatility symbols available to scan.'));
            return;
        }

        const scanSymbols = scanAllMarkets ? symbols : symbols.filter(s => s.symbol === symbol);
        if (!scanSymbols.length) {
            setScannerStatus(localize('Selected market is not available for scanning.'));
            return;
        }

        setScannerIsScanning(true);
        setScannerStatus(localize('Scanning markets and analyzing strategy statistics...'));
        setScanRecommendations([]);
        setMarketStats([]);
        setScannerProgress(0);

        const totalSymbols = scanSymbols.length;
        let completedSymbols = 0;

        const buildStrategySignals = (symbolInfo: { symbol: string; display_name: string }, quotes: number[]) => {
            const digits = quotes
                .map(quote => Number(String(quote).slice(-1)))
                .filter(d => Number.isFinite(d));
            if (digits.length < 15) {
                return [];
            }

            const totalCount = digits.length;
            const counts = Array(10).fill(0);
            digits.forEach(d => counts[d] += 1);
            const sortedDigits = counts
                .map((count, digit) => ({ digit, count }))
                .sort((a, b) => b.count - a.count);
            const hottest = sortedDigits[0];
            const secondHottest = sortedDigits[1];
            const coldest = sortedDigits[9];

            const last15Quotes = quotes.slice(-15);
            const last15Digits = last15Quotes.map(q => Number(String(q).slice(-1))).filter(Number.isFinite);
            const last15Counts = Array(10).fill(0);
            last15Digits.forEach(d => last15Counts[d] += 1);
            const last15Even = last15Digits.filter(d => d % 2 === 0).length;
            const last15Odd = last15Digits.filter(d => d % 2 !== 0).length;
            const last15Over = last15Digits.filter(d => d >= 5).length;
            const last15Under = last15Digits.filter(d => d <= 4).length;
            const last15Rise = last15Quotes.slice(1).filter((q, idx) => q > last15Quotes[idx]).length;
            const last15Fall = last15Quotes.slice(1).filter((q, idx) => q < last15Quotes[idx]).length;

            const evenCount = digits.filter(d => d % 2 === 0).length;
            const oddCount = digits.filter(d => d % 2 !== 0).length;
            const overCount = digits.filter(d => d >= 5).length;
            const underCount = digits.filter(d => d <= 4).length;
            const evenPct = (evenCount / totalCount) * 100;
            const oddPct = (oddCount / totalCount) * 100;
            const overPct = (overCount / totalCount) * 100;
            const underPct = (underCount / totalCount) * 100;
            const risePct = (last15Rise / Math.max(last15Quotes.length - 1, 1)) * 100;
            const fallPct = (last15Fall / Math.max(last15Quotes.length - 1, 1)) * 100;
            const hottestPct = (hottest.count / totalCount) * 100;
            const coldestPct = (coldest.count / totalCount) * 100;
            const predictionSet = predictionDigits.length > 0 ? predictionDigits : [hottest.digit];
            const confirmationText = `Last 15 ticks: ${last15Digits.join(', ')}`;

            const signals: Array<any> = [];

            if (tradeType === 'DIGITOVER') {
                if (overPct >= 55 && last15Over >= 9) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('OVER signal — Over is strong at {{pct}}%', { pct: overPct.toFixed(1) }),
                        signalType: 'over',
                        beforeLoss: 3,
                        afterLoss: 5,
                        predictions: [5],
                        confirmationRate: overPct,
                        score: Math.min(100, overPct + last15Over * 2),
                    });
                } else if (overPct >= 52) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('OVER watch — Over trending above 52% with recent confirmation'),
                        signalType: 'over',
                        beforeLoss: 3,
                        afterLoss: 5,
                        predictions: predictionSet,
                        confirmationRate: overPct,
                        score: Math.min(100, overPct + last15Over * 1.2),
                    });
                }
            }

            if (tradeType === 'DIGITUNDER') {
                if (underPct >= 55 && last15Under >= 9) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('UNDER signal — Under is strong at {{pct}}%', { pct: underPct.toFixed(1) }),
                        signalType: 'under',
                        beforeLoss: 6,
                        afterLoss: 4,
                        predictions: [4],
                        confirmationRate: underPct,
                        score: Math.min(100, underPct + last15Under * 2),
                    });
                } else if (underPct >= 52) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('UNDER watch — Under trending above 52% with recent confirmation'),
                        signalType: 'under',
                        beforeLoss: 6,
                        afterLoss: 4,
                        predictions: predictionSet,
                        confirmationRate: underPct,
                        score: Math.min(100, underPct + last15Under * 1.2),
                    });
                }
            }

            if (tradeType === 'DIGITEVEN') {
                if (evenPct >= 55 && last15Even >= 9) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('EVEN signal — Even dominance at {{pct}}%', { pct: evenPct.toFixed(1) }),
                        signalType: 'even',
                        beforeLoss: 0,
                        afterLoss: 0,
                        predictions: [0],
                        confirmationRate: evenPct,
                        score: Math.min(100, evenPct + last15Even * 1.5),
                    });
                }
                if (oddPct >= 55 && last15Odd >= 9) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('ODD signal — Odd dominance at {{pct}}%', { pct: oddPct.toFixed(1) }),
                        signalType: 'odd',
                        beforeLoss: 1,
                        afterLoss: 1,
                        predictions: [1],
                        confirmationRate: oddPct,
                        score: Math.min(100, oddPct + last15Odd * 1.5),
                    });
                }
            }

            if (tradeType === 'DIGITMATCH') {
                if (hottestPct >= 55) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('MATCHES signal — Digit {{digit}} is hottest at {{pct}}%', { digit: hottest.digit, pct: hottestPct.toFixed(1) }),
                        signalType: 'matches',
                        beforeLoss: hottest.digit,
                        afterLoss: secondHottest.digit,
                        predictions: [hottest.digit],
                        confirmationRate: hottestPct,
                        score: Math.min(100, hottestPct + last15Counts[hottest.digit] * 3),
                    });
                }
            }

            if (tradeType === 'DIGITDIFF') {
                if (coldestPct <= 10) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('DIFFERS signal — Cold digit {{digit}} at {{pct}}%', { digit: coldest.digit, pct: coldestPct.toFixed(1) }),
                        signalType: 'differs',
                        beforeLoss: coldest.digit,
                        afterLoss: (coldest.digit + 1) % 10,
                        predictions: [coldest.digit],
                        confirmationRate: 100 - coldestPct,
                        score: Math.min(100, 70 + (10 - coldestPct) * 3),
                    });
                }
            }

            if (tradeType === 'RISEFALL') {
                if (risePct >= 58) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('RISE signal — Up trend confirmed at {{pct}}%', { pct: risePct.toFixed(1) }),
                        signalType: 'rise',
                        beforeLoss: 0,
                        afterLoss: 0,
                        predictions: [0],
                        confirmationRate: risePct,
                        score: Math.min(100, risePct + last15Rise * 3),
                    });
                }
                if (fallPct >= 58) {
                    signals.push({
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        recommendation: localize('FALL signal — Down trend confirmed at {{pct}}%', { pct: fallPct.toFixed(1) }),
                        signalType: 'fall',
                        beforeLoss: 0,
                        afterLoss: 0,
                        predictions: [0],
                        confirmationRate: fallPct,
                        score: Math.min(100, fallPct + last15Fall * 3),
                    });
                }
            }

            return signals.map(signal => ({
                ...signal,
                strategy: tradeType,
                confirmation: confirmationText,
            }));
        };

        const fetchSymbol = async (symbolInfo: { symbol: string; display_name: string }) => {
            try {
                const response = await apiRef.current.send({
                    ticks_history: symbolInfo.symbol,
                    count: 1000,
                    end: 'latest',
                    subscribe: 0,
                });
                if (response?.error || !response?.history) {
                    return null;
                }
                const ticks = historyToTicks(response.history || {});
                const quotes = ticks
                    .map(t => Number((t as any).quote))
                    .filter(quote => Number.isFinite(quote));
                if (quotes.length < 15) {
                    return null;
                }

                const signals = buildStrategySignals(symbolInfo, quotes);
                completedSymbols += 1;
                setScannerProgress(Math.round((completedSymbols / totalSymbols) * 100));
                setMarketStats(prev => [
                    ...prev,
                    {
                        symbol: symbolInfo.symbol,
                        display_name: symbolInfo.display_name,
                        score: signals.reduce((sum, item) => sum + item.score, 0),
                        strategy: tradeType,
                        confirmation: signals.map(item => item.recommendation).join(' | '),
                    },
                ]);

                return signals.length ? signals : null;
            } catch {
                completedSymbols += 1;
                setScannerProgress(Math.round((completedSymbols / totalSymbols) * 100));
                return null;
            }
        };

        const results = await Promise.all(scanSymbols.map(fetchSymbol));
        const minScanTime = 8000;
        await new Promise(resolve => setTimeout(resolve, minScanTime));

        const validResults = (results as Array<any>).filter(Boolean).flat();
        const sortedResults = validResults.sort((a, b) => b.score - a.score).slice(0, 8);

        setScanRecommendations(sortedResults);
        setScannerStatus(localize('Analysis complete — {{count}} strong signals found.', { count: sortedResults.length }));
        setScannerIsScanning(false);
    };

    const onStop = () => {
        stopFlagRef.current = true;
        botModeRef.current = null;
        setIsRunning(false);
        setIsAutoTrading(false);
        setShowStopBot(false);
    };

    const handleTradingParamsSubmit = async () => {
        if (stopLoss > 0 && takeProfit > 0) {
            setShowTradingParams(false);
            if (!loadedSignal) {
                await loadBestSignal();
            }
            setShowTradingOptions(true);
        }
    };



    const handleResultCardClose = () => {
        setShowResultCard(false);
        setResultMessage('');
        setResultAmount(0);
    };

    return (
        <div className='smart-trader'>
            <div className='smart-trader__container'>


                <div className='smart-trader__content'>
                    <div className='smart-trader__card'>
                        <div className='smart-trader__scanner'>
                            <div className='smart-trader__scanner-inner'>
                                <div className='smart-trader__scanner-title'>
                                    <span className='smart-trader__scanner-icon'><strong>AI</strong></span> {localize('AI strategy tool — All Markets scanner')}
                                </div>
                                <div className='smart-trader__scanner-meta'>
                                    {localize('Trade type')}: {TRADE_TYPES.find(t => t.value === tradeType)?.label}
                                </div>
                                <div className='smart-trader__scanner-meta'>
                                    {localize('Scan to find the strongest volatility signal and load its top prediction settings.')}
                                </div>
                                <div className='smart-trader__scanner-meta smart-trader__scanner-meta--inline'>
                                    <label className='smart-trader__checkbox-label'>
                                        <input
                                            type='checkbox'
                                            checked={scanAllMarkets}
                                            onChange={() => setScanAllMarkets(prev => !prev)}
                                        />
                                        <span>{localize('Multi market scan')}</span>
                                    </label>
                                    <span>{localize('Trade type')}: {TRADE_TYPES.find(t => t.value === tradeType)?.label}</span>
                                </div>
                                {(tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF' || tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') && (
                                    <div className='smart-trader__scanner-meta'>
                                        <label htmlFor='st-predictions'>{localize('Predictions (comma-separated)')}</label>
                                        <input
                                            id='st-predictions'
                                            type='text'
                                            value={predictionInput}
                                            onChange={e => setPredictionInput(e.target.value)}
                                            placeholder='4, 7, 8'
                                        />
                                    </div>
                                )}
                                {tradeType === 'RISEFALL' && (
                                    <div className='smart-trader__scanner-meta smart-trader__scanner-meta--inline'>
                                        <label>
                                            <input
                                                type='radio'
                                                name='riseFall'
                                                checked={riseFallPrediction === 'rise'}
                                                onChange={() => setRiseFallPrediction('rise')}
                                            />
                                            {localize('Rise')}
                                        </label>
                                        <label>
                                            <input
                                                type='radio'
                                                name='riseFall'
                                                checked={riseFallPrediction === 'fall'}
                                                onChange={() => setRiseFallPrediction('fall')}
                                            />
                                            {localize('Fall')}
                                        </label>
                                    </div>
                                )}
                                <div className='smart-trader__scanner-progress-bar'>
                                    <div className={`smart-trader__scanner-progress smart-trader__scanner-progress--${Math.min(100, Math.floor(scannerProgress / 10) * 10)}`} />
                                </div>
                                <div className='smart-trader__scanner-actions'>
                                    <button
                                        className='smart-trader__scanner-button'
                                        onClick={scanAllVolatilitySymbols}
                                        disabled={scannerIsScanning || !symbols.length}
                                    >
                                        {scannerIsScanning ? localize('Scanning...') : localize('SCAN')}
                                    </button>
                                </div>
                                <div className='smart-trader__scanner-status'>
                                    {scannerStatus || localize('Ready to scan all available volatility markets.')}
                                </div>
                                {loadedSignalCountdown > 0 && (
                                    <div className='smart-trader__scanner-status'>
                                        {localize('Loaded signal expires in {{count}} seconds.', { count: loadedSignalCountdown })}
                                    </div>
                                )}
                                {scanRecommendations.length > 0 && (
                                    <div className='smart-trader__scanner-results'>
                                        {scanRecommendations.map(item => (
                                            <div key={item.symbol} className='smart-trader__scanner-result'>
                                                <div className='smart-trader__scanner-symbol'>{item.display_name}</div>
                                                <div className='smart-trader__scanner-recommendation'>{item.recommendation}</div>
                                                <div className='smart-trader__scanner-details'>
                                                    {(tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') && (
                                                        <>Over: {item.overPct}% • Under: {item.underPct}% • </>
                                                    )}
                                                    {tradeType === 'DIGITEVEN' && (
                                                        <>Even: {item.evenPct}% • Odd: {item.oddPct}% • </>
                                                    )}
                                                    {localize('Before loss:')} {item.beforeLoss} • {localize('After loss:')} {item.afterLoss}
                                                </div>
                                                <button
                                                    type='button'
                                                    className='smart-trader__signal-button'
                                                    onClick={() => loadDeepScanSignal(item)}
                                                >
                                                    {localize('Load Deep Scan Signal')}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className='smart-trader__row smart-trader__row--two smart-trader__top-row'>
                            <div className='smart-trader__field'>
                                <label htmlFor='st-symbol'>{localize('Volatility')}</label>
                                <select
                                    id='st-symbol'
                                    value={symbol}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setSymbol(v);
                                        startTicks(v);
                                    }}
                                >
                                    {symbols.map(s => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.display_name}
                                        </option>
                                    ))}
                                </select>
                                <div className='smart-trader__field smart-trader__field--nested'>
                                    <label htmlFor='st-ticks'>{localize('Ticks')}</label>
                                    <input
                                        id='st-ticks'
                                        type='number'
                                        min={1}
                                        max={10}
                                        value={ticks}
                                        onChange={e => setTicks(Number(e.target.value))}
                                    />
                                </div>
                                {(tradeType === 'DIGITOVER') && (
                                    <div className='smart-trader__field smart-trader__field--nested'>
                                        <label htmlFor='st-ou-pred-pre'>{localize('Prediction before loss')}</label>
                                        <input
                                            id='st-ou-pred-pre'
                                            type='number'
                                            min={0}
                                            max={9}
                                            value={ouPredPreLoss}
                                            onChange={e => setOuPredPreLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                        />
                                    </div>
                                )}
                                {(tradeType === 'DIGITEVEN') && (
                                    <div className='smart-trader__field smart-trader__field--nested'>
                                        <label htmlFor='st-eo-pred-pre'>{localize('Even/Odd prediction before loss')}</label>
                                        <select
                                            id='st-eo-pred-pre'
                                            value={eoPredPreLoss}
                                            onChange={e => setEoPredPreLoss(Number(e.target.value))}
                                        >
                                            <option value={0}>Even</option>
                                            <option value={1}>Odd</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className='smart-trader__field smart-trader__field--right'>
                                <label htmlFor='st-tradeType'>{localize('Trade type')}</label>
                                <select
                                    id='st-tradeType'
                                    value={tradeType}
                                    onChange={e => setTradeType(e.target.value)}
                                >
                                    {TRADE_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                                <div className='smart-trader__field smart-trader__field--nested'>
                                    <label htmlFor='st-stake'>{localize('Stake')}</label>
                                    <input
                                        id='st-stake'
                                        type='number'
                                        step='0.01'
                                        min={0.35}
                                        value={stake}
                                        onChange={e => setStake(Number(e.target.value))}
                                    />
                                </div>
                                {(tradeType === 'DIGITOVER') && (
                                    <div className='smart-trader__field smart-trader__field--nested'>
                                        <label htmlFor='st-ou-pred-post'>{localize('Prediction after loss')}</label>
                                        <input
                                            id='st-ou-pred-post'
                                            type='number'
                                            min={0}
                                            max={9}
                                            value={ouPredPostLoss}
                                            onChange={e => setOuPredPostLoss(Math.max(0, Math.min(9, Number(e.target.value))))}
                                        />
                                    </div>
                                )}
                                {(tradeType === 'DIGITEVEN') && (
                                    <div className='smart-trader__field smart-trader__field--nested'>
                                        <label htmlFor='st-eo-pred-post'>{localize('Even/Odd prediction after loss')}</label>
                                        <select
                                            id='st-eo-pred-post'
                                            value={eoPredPostLoss}
                                            onChange={e => setEoPredPostLoss(Number(e.target.value))}
                                        >
                                            <option value={0}>Even</option>
                                            <option value={1}>Odd</option>
                                        </select>
                                    </div>
                                )}
                                {tradeType === 'DIGITDIFF' && (
                                    <>
                                        <div className='smart-trader__field smart-trader__field--nested'>
                                            <label htmlFor='st-md-pred-pre'>{localize('Match/Diff prediction before loss')}</label>
                                            <input id='st-md-pred-pre' type='number' min={0} max={9} value={mdPredPreLoss}
                                                onChange={e => { const v = Math.max(0, Math.min(9, Number(e.target.value))); setMdPredPreLoss(v); }} />
                                        </div>
                                        <div className='smart-trader__field smart-trader__field--nested'>
                                            <label htmlFor='st-md-pred-post'>{localize('Match/Diff prediction after loss')}</label>
                                            <input id='st-md-pred-post' type='number' min={0} max={9} value={mdPredPostLoss}
                                                onChange={e => { const v = Math.max(0, Math.min(9, Number(e.target.value))); setMdPredPostLoss(v); }} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>


                        {/* Strategy controls */}
                            {tradeType === 'DIGITDIFF' ? (
                                <div className='smart-trader__row smart-trader__row--two'>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-martingale'>{localize('Martingale multiplier')}</label>
                                        <input id='st-martingale' type='number' min={1} step='0.1' value={martingaleMultiplier}
                                            onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))} />
                                    </div>
                                </div>
                            ) : (
                                <div className='smart-trader__row smart-trader__row--compact'>
                                    <div className='smart-trader__field'>
                                        <label htmlFor='st-martingale'>{localize('Martingale multiplier')}</label>
                                        <input id='st-martingale' type='number' min={1} step='0.1' value={martingaleMultiplier}
                                            onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))} />
                                    </div>
                                </div>
                            )}

                        <div className='smart-trader__current-price'>
                            <div className='smart-trader__current-price-label'>
                                {localize('Current Market Price')}
                            </div>
                            <div className='smart-trader__current-price-value'>
                                <span className='smart-trader__current-price-base'>
                                    {lastPrice ? lastPrice.slice(0, -1) : '-'}
                                </span>
                                <span className='smart-trader__current-price-last-digit'>
                                    {lastPrice ? lastPrice.slice(-1) : '-'}
                                </span>
                            </div>
                        </div>
                        <div className='smart-trader__footer-bar'>
                            <div className='smart-trader__footer-item'>
                                {localize('Total Profit/Loss:')} {Number(store?.summary_card?.profit || 0).toFixed(2)}
                            </div>
                            <div className='smart-trader__footer-item'>
                                {localize('Last Digit:')} {lastDigit ?? '-'}
                            </div>
                            <div className='smart-trader__footer-item'>
                                {localize('Consecutive Wins:')} {consecWins} {localize('Consecutive Losses:')} {consecLosses}
                            </div>
                        </div>

                        {status && (
                            <div className='smart-trader__status'>
                                <Text size='xs' color={/error|fail/i.test(status) ? 'loss-danger' : 'prominent'}>
                                    {status}
                                </Text>
                            </div>
                        )}

                        {/* Trading Buttons */}
                        {loadedSignal && (
                            <div className='smart-trader__trading-buttons'>
                                <button
                                    className='smart-trader__trading-button smart-trader__trading-normal'
                                    onClick={() => onRun('normal')}
                                    disabled={!is_authorized || is_running}
                                >
                                    {localize('Normal Trading (slow)')}
                                </button>
                                <button
                                    className='smart-trader__trading-button smart-trader__trading-speed'
                                    onClick={() => onRun('speed')}
                                    disabled={!is_authorized || is_running}
                                >
                                    {localize('Speed Bot (Each Tick Trading)')}
                                </button>
                            </div>
                        )}

                        {/* Trading Parameters Modal */}
                        {showTradingParams && (
                            <div className='smart-trader__modal-overlay'>
                                <div className='smart-trader__modal'>
                                    <h3>{localize('Set Trading Parameters')}</h3>
                                    {loadedSignal && (
                                        <div className='smart-trader__modal-note'>
                                            <strong>{localize('Loaded deep scan signal:')}</strong> {loadedSignal.display_name} • {loadedSignal.recommendation}
                                        </div>
                                    )}
                                    <div className='smart-trader__modal-content'>
                                        <div className='smart-trader__field'>
                                            <label htmlFor='st-stake-modal'>{localize('Stake')}</label>
                                            <input
                                                id='st-stake-modal'
                                                type='number'
                                                min={0.35}
                                                step='0.01'
                                                value={stake}
                                                onChange={e => setStake(Number(e.target.value))}
                                                placeholder={localize('Enter stake amount')}
                                            />
                                        </div>
                                        <div className='smart-trader__field'>
                                            <label htmlFor='st-martingale-modal'>{localize('Martingale multiplier')}</label>
                                            <input
                                                id='st-martingale-modal'
                                                type='number'
                                                min={1}
                                                step='0.1'
                                                value={martingaleMultiplier}
                                                onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))}
                                                placeholder={localize('Enter martingale multiplier')}
                                            />
                                        </div>
                                        <div className='smart-trader__field'>
                                            <label htmlFor='stop-loss'>{localize('Stop Loss')}</label>
                                            <input
                                                id='stop-loss'
                                                type='number'
                                                min={0}
                                                step='0.01'
                                                value={stopLoss}
                                                onChange={e => setStopLoss(Number(e.target.value))}
                                                placeholder={localize('Enter stop loss amount')}
                                            />
                                        </div>
                                        <div className='smart-trader__field'>
                                            <label htmlFor='take-profit'>{localize('Take Profit')}</label>
                                            <input
                                                id='take-profit'
                                                type='number'
                                                min={0}
                                                step='0.01'
                                                value={takeProfit}
                                                onChange={e => setTakeProfit(Number(e.target.value))}
                                                placeholder={localize('Enter take profit amount')}
                                            />
                                        </div>
                                    </div>
                                    <div className='smart-trader__modal-actions'>
                                        <button 
                                            className='smart-trader__modal-cancel'
                                            onClick={() => {
                                                setShowTradingParams(false);
                                                setShowEngineSelection(false);
                                            }}
                                        >
                                            {localize('Cancel')}
                                        </button>
                                        <button 
                                            className='smart-trader__modal-submit'
                                            onClick={handleTradingParamsSubmit}
                                            disabled={!stopLoss || !takeProfit}
                                        >
                                            {localize('Start Trading')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trading Options Modal */}
                        {showTradingOptions && (
                            <div className='smart-trader__modal-overlay'>
                                <div className='smart-trader__modal'>
                                    <h3>{localize('Start Trading')}</h3>
                                    {loadedSignal && (
                                        <div className='smart-trader__modal-note'>
                                            <strong>{localize('Signal loaded:')}</strong> {loadedSignal.display_name} • {loadedSignal.recommendation}
                                        </div>
                                    )}
                                    <div className='smart-trader__modal-content'>
                                        <p>{localize('Choose your trading mode:')}</p>
                                        <div className='smart-trader__engine-selection'>
                                            <button
                                                className='smart-trader__engine-button smart-trader__engine-normal'
                                                onClick={() => {
                                                    setShowTradingOptions(false);
                                                    onRun('normal');
                                                }}
                                            >
                                                <div className='smart-trader__engine-title'>{localize('Normal Trading (slow)')}</div>
                                                <div className='smart-trader__engine-desc'>{localize('Purchases contracts after every 2 ticks')}</div>
                                            </button>
                                            <button
                                                className='smart-trader__engine-button smart-trader__engine-speed'
                                                onClick={() => {
                                                    setShowTradingOptions(false);
                                                    onRun('speed');
                                                }}
                                            >
                                                <div className='smart-trader__engine-title'>{localize('Speed Bot (Each Tick Trader)')}</div>
                                                <div className='smart-trader__engine-desc'>{localize('Purchases contracts on each tick')}</div>
                                            </button>
                                        </div>
                                    </div>
                                    <div className='smart-trader__modal-actions'>
                                        <button
                                            className='smart-trader__modal-cancel'
                                            onClick={() => {
                                                setShowTradingOptions(false);
                                                setShowTradingParams(true);
                                            }}
                                        >
                                            {localize('Back')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Result Card */}
                        {showResultCard && (
                            <div className='smart-trader__result-overlay'>
                                <div className='smart-trader__result-card'>
                                    <div className='smart-trader__result-content'>
                                        <h3>{resultMessage.includes('Congratulations') ? '🎉' : '😔'}</h3>
                                        <p>{resultMessage}</p>
                                        <p className='smart-trader__result-amount'>
                                            {resultMessage.includes('Congratulations') ? 'Profit Secured:' : 'Loss Amount:'} 
                                            <span className={resultAmount >= 0 ? 'profit' : 'loss'}>
                                                {resultAmount >= 0 ? '+' : ''}{resultAmount.toFixed(2)} {account_currency}
                                            </span>
                                        </p>
                                        {resultMessage.includes('Congratulations') && (
                                            <p className='smart-trader__result-hope'>Keep up the great trading! 🚀</p>
                                        )}
                                        {!resultMessage.includes('Congratulations') && (
                                            <p className='smart-trader__result-hope'>Don't give up! Better opportunities ahead. 💪</p>
                                        )}
                                    </div>
                                    <button 
                                        className='smart-trader__result-close'
                                        onClick={handleResultCardClose}
                                    >
                                        {localize('Close')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Floating Stop Bot Button */}
                        {showStopBot && (
                            <div className='smart-trader__stop-bot'>
                                <button 
                                    className='smart-trader__stop-bot-button'
                                    onClick={onStop}
                                >
                                    🛑 StopBot
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default SmartTrader;
