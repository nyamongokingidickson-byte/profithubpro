import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { api_base, ApiHelpers } from '@/external/bot-skeleton';
import { DigitStatsEngine } from '@/lib/digit-stats-engine';
import { DigitTradeEngine } from '@/lib/digit-trade-engine';
import RootStore from './root-store';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';

export type TDigitStat = {
    digit: number;
    count: number;
    percentage: number;
    rank: number;
    power: number;
    is_increasing: boolean;
};

export type TAnalysisHistory = {
    type: 'E' | 'O' | 'U' | 'O_U' | 'M' | 'D' | 'R' | 'F';
    value: string | number;
    color: string;
};

type TTick = {
    symbol: string;
    quote: number | string;
    epoch: number;
};

export default class AnalysisStore {
    root_store: RootStore;
    stats_engine: DigitStatsEngine;
    trade_engine: DigitTradeEngine;

    @observable accessor digit_stats: TDigitStat[] = [];
    @observable accessor ticks: number[] = [];
    @observable accessor symbol = 'R_100';
    @observable accessor current_price: string | number = '0.00';
    @observable accessor last_digit: number | null = null;
    @observable accessor total_ticks = 5000;
    @observable accessor pip = 2;
    private symbol_pips: Map<string, number> = new Map();

    @observable accessor is_connected = false;
    @observable accessor is_loading = false;
    @observable accessor error_message: string | null = null;
    @observable accessor is_subscribing = false;

    @observable accessor percentages = {
        even: 50,
        odd: 50,
        over: 50,
        under: 50,
        match: 10,
        differ: 90,
        rise: 50,
        fall: 50,
    };
    @observable accessor current_streaks = {
        even_odd: { count: 0, type: 'EVEN' },
        over_under: { count: 0, type: 'OVER' },
        match_diff: { count: 0, type: 'MATCH' },
        rise_fall: { count: 0, type: 'RISE' },
    };

    // History (Delegated to engine but observable here for UI)
    @observable accessor even_odd_history: TAnalysisHistory[] = [];
    @observable accessor over_under_history: TAnalysisHistory[] = [];
    @observable accessor matches_differs_history: TAnalysisHistory[] = [];
    @observable accessor rise_fall_history: TAnalysisHistory[] = [];

    // Settings
    @observable accessor match_diff_digit = 6;
    @observable accessor markets: { group: string; items: { value: string; label: string }[] }[] = [];

    // Nexus Strategic States
    @observable accessor is_cycling_enabled = false;
    @observable accessor current_tier: 'balanced' | 'aggressive' | 'pro' | 'extreme' = 'balanced';
    @observable accessor nexus_signal: any = null;
    @observable accessor signal_age = 0; // 0-7 ticks
    @observable accessor run_counter = 0; // 0-7 executions
    @observable accessor is_reanalyzing = false;
    @observable accessor last_cycle_tick = 0;
    @observable accessor cycle_interval = 20; // Switch after 20 dead ticks
    @observable accessor trade_journal: any[] = [];

    // EO Strategic States
    @observable accessor eo_selected_condition: number = 2; // Default to 'The Bounce'
    @observable accessor eo_target_side: 'EVEN' | 'ODD' = 'EVEN';
    @observable accessor eo_intelligence: any = null;
    @observable accessor eo_pattern_streak: { count: number; type: string } = { count: 0, type: '' };
    @observable accessor eo_auto_trade_enabled = false;
    @observable accessor ou_auto_trade_enabled = false;
    @observable accessor eo_run_counter = 0;
    @observable accessor eo_cycle_pause = false;
    @observable accessor eo_cycle_pause_ticks = 0;

    @observable accessor subscription_id: string | null = null;
    @observable accessor over_under_threshold = 5;

    private readonly DEFAULT_MARKETS = [
        {
            group: 'Volatility Indices',
            items: [
                { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
                { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
                { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
                { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
                { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
                { value: 'R_10', label: 'Volatility 10 Index' },
                { value: 'R_25', label: 'Volatility 25 Index' },
                { value: 'R_50', label: 'Volatility 50 Index' },
                { value: 'R_75', label: 'Volatility 75 Index' },
                { value: 'R_100', label: 'Volatility 100 Index' },
            ],
        },
    ];

    private unsubscribe_ticks: (() => void) | null = null;

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;
        this.stats_engine = new DigitStatsEngine();
        this.trade_engine = new DigitTradeEngine();

        // Pre-populate with defaults so dropdown is never empty
        this.markets = this.DEFAULT_MARKETS;

        // Sync engine configs
        this.updateEngineConfig();

        // Wait for API to be ready then connect
        this.waitForApiAndConnect();

        reaction(
            () => this.root_store.common?.is_socket_opened,
            is_socket_opened => {
                this.is_connected = !!is_socket_opened;
                if (is_socket_opened) {
                    this.fetchMarkets();
                    if (!this.unsubscribe_ticks) {
                        this.subscribeToTicks(); // Auto-subscribe if connected and not already
                    }
                } else {
                    this.unsubscribeFromTicks(); // Clean up on disconnect
                }
            }
        );
    }

    @action
    private waitForApiAndConnect = () => {
        const tryConnect = () => {
            if (api_base.api) {
                runInAction(() => {
                    this.is_connected = true;
                });
                this.fetchMarkets();
                this.subscribeToTicks();
            } else {
                setTimeout(tryConnect, 1000);
            }
        };
        tryConnect();
    };

    @action
    updateEngineConfig = () => {
        this.stats_engine.setConfig({
            over_under_threshold: this.over_under_threshold,
            match_diff_digit: this.match_diff_digit,
            total_samples: this.total_ticks,
            pip: this.pip,
        });
        this.refreshStats(); // Update observables from engine
    };

    @action
    init = async () => {
        if (this.is_connected) {
            this.subscribeToTicks();
        }
    };

    @action
    handleTick = (tick: TTick) => {
        console.log(`[AnalysisStore] Received tick for ${tick.symbol}: ${tick.quote}`);
        if (tick.symbol !== this.symbol) {
            console.warn(`[AnalysisStore] Symbol mismatch: ${tick.symbol} !== ${this.symbol}`);
            return;
        }

        const price = Number(tick.quote);
        const new_digit = this.stats_engine.extractLastDigit(price);
        console.log(`[AnalysisStore] Extracted digit: ${new_digit} (pip: ${this.stats_engine.pip})`);

        if (!isNaN(new_digit)) {
            const current_ticks = [...this.ticks, new_digit];
            if (current_ticks.length > this.total_ticks) current_ticks.shift();

            this.ticks = current_ticks;
            this.last_digit = this.stats_engine.extractLastDigit(price);
            this.current_price = price;

            // Push to engine
            this.stats_engine.updateWithHistory(this.ticks, price);
            this.refreshStats();

            // Push to trade engine
            this.trade_engine.processTick(
                new_digit,
                { percentages: this.stats_engine.getPercentages(), digit_stats: this.stats_engine.digit_stats },
                this.symbol,
                this.root_store.client.currency || 'USD'
            );
        }

        this.updateNexusIntelligence();
        this.updateEOIntelligence();
    };

    @action
    updateNexusIntelligence = () => {
        const signal = this.stats_engine.getNexusSignal(this.current_tier);
        if (!signal) return;

        // Check if we already have a strong signal
        const is_under_signal = signal.under.power >= 55;
        const is_over_signal = signal.over.power >= 55;

        runInAction(() => {
            if (is_under_signal || is_over_signal) {
                // If this is a NEW signal (or signal is still active), update it
                if (!this.nexus_signal || (this.nexus_signal && this.signal_age >= 7)) {
                    // Start a NEW 7-tick window if signal is found and no active window exists
                    if (this.signal_age >= 7 || !this.nexus_signal) {
                        this.nexus_signal = signal;
                        this.signal_age = 0;
                        this.run_counter = 0; // Reset runs for new signal
                        this.is_reanalyzing = false;
                    }
                } else {
                    // Signal is active, increment age
                    this.signal_age++;
                }

                this.last_cycle_tick = 0; // Reset cycle counter since we have a signal
            } else {
                // No signal, increment age and potentially cycle
                if (this.nexus_signal) {
                    this.signal_age++;
                }

                if (this.is_cycling_enabled) {
                    this.last_cycle_tick++;
                    if (this.last_cycle_tick >= this.cycle_interval) {
                        this.cycleMarkets();
                    }
                }
            }

            // Check for Automated Trade Trigger (55%+ Power)
            if (this.ou_auto_trade_enabled && !this.is_reanalyzing) {
                if (is_under_signal && signal.under.power >= 55) {
                    console.log(
                        `[Nexus OU] Under ${signal.under.prediction} met (Power: ${signal.under.power.toFixed(1)}%). Executing auto-trade...`
                    );
                    this.recordTrade('UNDER', signal.under.prediction);
                    this.root_store.smart_trading.manualTrade('DIGITUNDER', signal.under.prediction);
                } else if (is_over_signal && signal.over.power >= 55) {
                    console.log(
                        `[Nexus OU] Over ${signal.over.prediction} met (Power: ${signal.over.power.toFixed(1)}%). Executing auto-trade...`
                    );
                    this.recordTrade('OVER', signal.over.prediction);
                    this.root_store.smart_trading.manualTrade('DIGITOVER', signal.over.prediction);
                }
            }

            // Enforce the 7-run limit
            if (this.run_counter >= 7) {
                this.is_reanalyzing = true;
                this.nexus_signal = null; // Kill signal after 7 runs
            }
        });
    };

    @action
    cycleMarkets = () => {
        if (this.markets.length === 0) return;

        // Flatten markets
        const all_symbols = this.markets.flatMap(g => g.items.map(i => i.value));
        const current_index = all_symbols.indexOf(this.symbol);
        const next_index = (current_index + 1) % all_symbols.length;
        const next_symbol = all_symbols[next_index];

        console.log(`[Nexus] Cycling from ${this.symbol} to ${next_symbol}`);
        this.setSymbol(next_symbol);
        this.last_cycle_tick = 0;
    };

    @action
    recordTrade = (type: 'UNDER' | 'OVER', prediction: number) => {
        this.run_counter++;
        const trade = {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            market: this.symbol,
            type,
            prediction,
            last_digit: this.last_digit,
            tier: this.current_tier,
            signal_power: type === 'UNDER' ? this.nexus_signal?.under.power : this.nexus_signal?.over.power,
        };
        this.trade_journal.unshift(trade);
        if (this.trade_journal.length > 50) this.trade_journal.pop();
    };

    @action
    updateEOIntelligence = () => {
        const eo_signal = this.stats_engine.getEOStrategicSignal(this.eo_target_side);
        if (!eo_signal) return;

        runInAction(() => {
            this.eo_intelligence = eo_signal;
            this.eo_pattern_streak = eo_signal.streak;

            // Check if selected condition is met
            const conds = eo_signal.conditions;
            const is_met =
                (this.eo_selected_condition === 1 && conds.c1) ||
                (this.eo_selected_condition === 2 && conds.c2) ||
                (this.eo_selected_condition === 3 && conds.c3) ||
                (this.eo_selected_condition === 4 && conds.c4);

            // Handle Cycle Pause (15-tick re-analysis)
            if (this.eo_cycle_pause) {
                this.eo_cycle_pause_ticks++;
                if (this.eo_cycle_pause_ticks >= 15) {
                    this.eo_cycle_pause = false;
                    this.eo_cycle_pause_ticks = 0;
                    this.eo_run_counter = 0;
                    console.log('[Nexus EO] Cycle Reset - Ready for new signal');
                }
                return;
            }

            if (is_met && this.eo_auto_trade_enabled) {
                console.log(`[Nexus EO] Condition ${this.eo_selected_condition} met! Executing auto-trade...`);
                this.recordEOTrade();
                const contract_type = this.eo_target_side === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
                this.root_store.smart_trading.manualTrade(contract_type);
            }
        });
    };

    @action
    recordEOTrade = () => {
        this.eo_run_counter++;
        if (this.eo_run_counter >= 7) {
            this.eo_cycle_pause = true;
            this.eo_cycle_pause_ticks = 0;
            console.log('[Nexus EO] Cycle Limit (7/7) Reached. Entering Re-analysis mode.');
        }

        const trade = {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            market: this.symbol,
            type: this.eo_target_side,
            prediction: 'N/A',
            last_digit: this.last_digit,
            tier: this.eo_selected_condition, // Use condition ID as tier for UI
            signal_power: this.eo_target_side === 'EVEN' ? this.percentages.even : this.percentages.odd,
        };
        this.trade_journal.unshift(trade);
        if (this.trade_journal.length > 50) this.trade_journal.pop();
    };

    @action
    updateDigitStats = (digits: number[], quotes: (string | number)[]) => {
        this.ticks = digits;
        const prices = Array.isArray(quotes) ? quotes.map(q => Number(q)) : [];
        const last_price = prices.length > 0 ? prices[prices.length - 1] : 0;
        this.current_price = last_price;
        const last_digit = digits[digits.length - 1];
        if (last_digit !== undefined) this.last_digit = last_digit;

        this.stats_engine.update(digits, prices);
        this.refreshStats();
    };

    private active_stream_id: string | null = null;
    @action
    subscribeToTicks = async (retry_count = 0) => {
        if (!this.symbol || this.is_subscribing) return;

        // Ensure we don't exceed API limits
        const safeCount = Math.min(this.total_ticks, 5000);

        this.unsubscribeFromTicks();
        this.is_subscribing = true;
        this.is_loading = true;
        this.error_message = null;

        if (this.active_stream_id && api_base.api) {
            try {
                api_base.api.send(transformRequest({ forget: this.active_stream_id }, 'forget'));
            } catch (e) {
                // Ignore forget errors
            }
            this.active_stream_id = null;
        }

        try {
            if (!api_base.api) {
                throw new Error('API not initialized');
            }

            let response: any;
            try {
                const req = transformRequest({
                    ticks_history: this.symbol,
                    count: safeCount,
                    end: 'latest',
                    style: 'ticks',
                    subscribe: 1,
                }, 'ticks_history');
                response = await api_base.api.send(req);

                if (response?.error?.code === 'AlreadySubscribed') {
                    // If already subscribed, just fetch history once and reuse the existing global listener logic
                    const backupReq = transformRequest({
                        ticks_history: this.symbol,
                        count: safeCount,
                        end: 'latest',
                        style: 'ticks',
                    }, 'ticks_history');
                    response = await api_base.api.send(backupReq);
                } else if (response?.error) {
                    throw new Error(response.error.message);
                }
            } catch (err: any) {
                if (err.error?.code === 'AlreadySubscribed') {
                    const backupReq = transformRequest({
                        ticks_history: this.symbol,
                        count: safeCount,
                        end: 'latest',
                        style: 'ticks',
                    }, 'ticks_history');
                    response = await api_base.api.send(backupReq);
                } else {
                    throw err;
                }
            }

            runInAction(() => {
                if (response.subscription?.id) {
                    this.active_stream_id = response.subscription.id;
                }

                // Handle initial history
                if (response.history || response.ticks_history) {
                    const history = response.history || response.ticks_history;
                    if (history.prices) {
                        const price_numbers = history.prices.map((p: string | number) => Number(p));
                        const last_digits = price_numbers.map((p: number) => this.stats_engine.extractLastDigit(p));

                        this.current_price = price_numbers[price_numbers.length - 1];
                        this.ticks = last_digits;
                        this.last_digit = last_digits[last_digits.length - 1] ?? null;

                        this.stats_engine.update(last_digits, price_numbers);
                        this.refreshStats();
                    }
                }

                this.is_loading = false;
                this.is_subscribing = false;
            });

            // Setup real-time listener (dispose previous one first)
            if (this.unsubscribe_ticks) this.unsubscribe_ticks();

            let subId: string | null = null;
            let cancelled = false;

            const cb = (msg: any) => {
                const data = msg.data || msg;
                if (data.msg_type === 'tick') {
                    const transformed = transformResponse(data, 'tick');
                    if (transformed?.tick && transformed.tick.symbol === this.symbol) {
                        this.handleTick(transformed.tick);
                    }
                }
            };

            (async () => {
                try {
                    subId = await api_base.subscribeTo({ ticks: this.symbol }, cb as any);
                    if (cancelled && subId) await api_base.unsubscribeById(subId);
                    if (subId) this.unsubscribe_ticks = () => api_base.unsubscribeById(subId);
                    console.log(`[AnalysisStore] Subscribed to ${this.symbol} (Depth: ${safeCount})`);
                } catch (e) {
                    console.warn('[AnalysisStore] subscribeTo error', e);
                }
            })();
        } catch (e: unknown) {
            console.error('[AnalysisStore] Subscribe error:', e);
            runInAction(() => {
                this.error_message = (e as Error)?.message || 'Failed to subscribe';
                this.is_loading = false;
                this.is_subscribing = false;
            });

            if (retry_count < 3) {
                setTimeout(() => this.subscribeToTicks(retry_count + 1), 2000);
            }
        }
    };

    @action
    unsubscribeFromTicks = () => {
        if (this.unsubscribe_ticks) {
            this.unsubscribe_ticks();
            this.unsubscribe_ticks = null;
        }

        runInAction(() => {
            this.is_loading = false;
            this.error_message = null;
            this.stats_engine.reset();
            this.refreshStats();
            this.ticks = [];
        });
    };

    @action
    refreshStats = () => {
        // Sync observables from engine state
        this.digit_stats = this.stats_engine.digit_stats;
        this.even_odd_history = this.stats_engine.even_odd_history;
        this.over_under_history = this.stats_engine.over_under_history;
        this.matches_differs_history = this.stats_engine.matches_differs_history;
        this.rise_fall_history = this.stats_engine.rise_fall_history;

        this.percentages = this.stats_engine.getPercentages();

        const getStreak = (history: TAnalysisHistory[]): { count: number; type: string } => {
            if (history.length === 0) return { count: 0, type: '' };
            const type = history[0].type as string; // Assert as string
            let count = 0;
            for (const h of history) {
                if (h.type === type) count++;
                else break;
            }
            return { count, type };
        };

        this.current_streaks = {
            even_odd: getStreak(this.even_odd_history),
            over_under: getStreak(this.over_under_history),
            match_diff: getStreak(this.matches_differs_history),
            rise_fall: getStreak(this.rise_fall_history),
        };
    };

    @action
    setSymbol = (symbol: string) => {
        if (this.symbol === symbol) return;

        this.unsubscribeFromTicks();
        this.symbol = symbol;
        this.pip = this.symbol_pips.get(symbol) || 2;
        this.updateEngineConfig();
        this.subscribeToTicks();
    };

    @action
    fetchMarkets = async () => {
        let symbols: any[] = [];
        try {
            if (api_base.api) {
                const req = transformRequest({ active_symbols: 'brief', product_type: 'basic' }, 'active_symbols');
                const response = await api_base.api.send(req);
                const transformed = transformResponse(response, 'active_symbols');
                if (transformed.active_symbols && transformed.active_symbols.length > 0) {
                    symbols = transformed.active_symbols;
                }
            }
        } catch (error) {
            console.warn('[AnalysisStore] API active_symbols fetch failed:', error);
        }

        if (symbols.length === 0) {
            try {
                if (
                    ApiHelpers.instance &&
                    typeof (ApiHelpers.instance as any).active_symbols?.retrieveActiveSymbols === 'function'
                ) {
                    symbols = await (ApiHelpers.instance as any).active_symbols.retrieveActiveSymbols();
                }
            } catch (e) {
                console.warn('[AnalysisStore] ApiHelpers fetch failed:', e);
            }
        }

        if (!symbols || symbols.length === 0) {
            this.markets = this.DEFAULT_MARKETS;
            return;
        }

        runInAction(() => {
            const groups: Record<string, { group: string; items: { value: string; label: string }[] }> = {};
            symbols.forEach(s => {
                if (s.is_trading_suspended) return;
                const market_name = s.market_display_name || s.market || 'Synthetic Indices';
                if (!groups[market_name]) groups[market_name] = { group: market_name, items: [] };
                groups[market_name].items.push({ value: s.symbol, label: s.display_name });

                const pip = Math.abs(Math.log10(s.pip || 0.01)); // Convert pip to decimals
                this.symbol_pips.set(s.symbol, pip);
                if (s.symbol === this.symbol) {
                    this.pip = pip;
                    this.updateEngineConfig();
                }
            });
            this.markets = Object.values(groups).sort((a, b) => a.group.localeCompare(b.group));
        });
    };

    @action
    setTotalTicks = (count: number) => {
        // API Limit protection
        const safeCount = Math.max(10, Math.min(count, 5000));
        this.total_ticks = safeCount;
        this.updateEngineConfig();
        // Re-subscribe to fetch new history depth
        this.subscribeToTicks();
    };

    @action
    setMatchDiffDigit = (digit: number) => {
        this.match_diff_digit = digit;
        this.updateEngineConfig();
    };

    @action
    setOverUnderThreshold = (threshold: number) => {
        this.over_under_threshold = threshold;
        this.updateEngineConfig();
    };
}
