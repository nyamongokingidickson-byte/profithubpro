import { action, makeObservable, observable, runInAction } from 'mobx';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { DigitStatsEngine } from '@/lib/digit-stats-engine';
import RootStore from './root-store';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';
import { isSymbolAvailable } from '@/services/symbol-validator';

type TMarketkillerSubtab = 'matches';

export type TRecoveryStep = {
    id: string;
    symbol: string;
    contract_type: string;
    stake_multiplier: number;
    barrier?: number;
};

export type TMarketState = {
    symbol: string;
    price: string | number;
    digit: number | null;
    is_up: boolean;
};

export default class MarketkillerStore {
    root_store: RootStore;
    stats_engine: DigitStatsEngine;

    @observable accessor active_subtab: TMarketkillerSubtab = 'matches';
    @observable accessor is_connected = false;
    @observable accessor active_symbols: any[] = [];
    @observable accessor symbol = 'R_100';
    @observable accessor current_price: string | number = 0;
    @observable accessor last_digit: number | null = null;
    @observable accessor ticks: number[] = [];
    @observable accessor live_market_ribbon: TMarketState[] = [];

    // Digit Analytics (0-9)
    @observable accessor digit_stats: { digit: number; count: number; percentage: number; rank: number; is_increasing: boolean }[] = Array.from(
        { length: 10 },
        (_, i) => ({ digit: i, count: 0, percentage: 0, rank: i + 1, is_increasing: false })
    );
    @observable accessor digit_power_scores: number[] = Array(10).fill(0);

    // Global Execution State
    @observable accessor is_running = false;
    @observable accessor session_pl = 0;
    @observable accessor wins = 0;
    @observable accessor losses = 0;
    @observable accessor consecutive_losses = 0;
    @observable accessor total_stake_used = 0;
    @observable accessor total_runs = 0;
    @observable accessor trades_journal: any[] = [];

    // Signal Data
    @observable accessor signal_power = 0;
    @observable accessor signal_stability = 0;
    @observable accessor signal_strategy = 'OVER_4';
    @observable accessor use_signals = false;
    @observable accessor entry_point_enabled = false;
    @observable accessor signal_detected = false;

    // --- ONETRADER (HEDGING) SETTINGS ---
    @observable accessor onetrader_settings = {
        contract_type: 'DIGITOVER',
        stake: 0.35,
        duration: 1,
        barrier: 4,
        bulk_count: 1,
        enable_recovery: false,
        recovery_chain: [
            { id: '1', symbol: 'R_100', contract_type: 'DIGITUNDER', stake_multiplier: 2, barrier: 5 },
        ] as TRecoveryStep[],
    };

    // --- MATCHES KILLER SETTINGS ---
    @observable accessor matches_settings = {
        check_ticks: 15,
        predictions: [] as number[],
        is_running: false,
        is_auto: true,
        stake: 0.35,
        duration: 1,
        simultaneous_trades: 1,
        enabled_conditions: [true, true, true, true, false, false],
        c4_op: '>=',
        c4_val: 12,
        c4_ticks: 15,
        c6_count: 5,
        c6_target_rank: 'most' as 'most' | '2nd' | 'least',
        enable_multiple_predictions: true,
        max_predictions: 6,
        martingale_enabled: true,
        martingale_multiplier: 0.5,
    };

    @observable accessor matches_ranks = {
        most: null as number | null,
        second: null as number | null,
        least: null as number | null,
    };

    @observable accessor is_executing = false;

    private tick_subscription: any = null;
    private recent_powers: number[][] = [];
    private ribbon_subscriptions: Map<string, any> = new Map();

    // ── Rate-Limit Guard ──────────────────────────────────────────────────────
    // directBuy fires all trades in parallel (no proposal subscription limit).
    private readonly MAX_RETRIES = 3;

    /** Wait helper */
    private sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /** Extract a clean error string from whatever Deriv throws */
    private extractErrorMsg = (e: any): string => {
        if (!e) return 'Unknown error';
        // Deriv rejects with { error: { code, message } }
        if (e?.error?.message) return `[${e.error.code}] ${e.error.message}`;
        if (e?.message) return e.message;
        try { return JSON.stringify(e); } catch { return String(e); }
    };

    /**
     * Direct Buy — uses Deriv's buy: "1" with inline parameters.
     * This skips the proposal step entirely, eliminating the InvalidContractProposal
     * race condition where 1-tick proposals expire between propose and buy.
     * One API call per trade = half the rate-limit cost + no expiry window.
     */
    private directBuy = async (config: any, attempt = 0): Promise<any> => {
        const safeStake = Number(Math.max(config.stake || 0.35, 0.35).toFixed(2));

        if (!api_base.api || api_base.api.connection?.readyState !== 1) {
            console.warn('[Marketkiller] Buy aborted: WebSocket disconnected.');
            return null;
        }

        let buyRes: any;
        try {
            const req = transformRequest({
                buy: '1',
                price: safeStake,
                parameters: {
                    amount: safeStake,
                    basis: 'stake',
                    contract_type: config.type,
                    currency: 'USD',
                    duration: this.matches_settings.duration || 1,
                    duration_unit: 't',
                    symbol: config.symbol,
                    barrier: String(config.barrier),
                },
            }, 'buy');
            buyRes = await api_base.api.send(req);
        } catch (e: any) {
            const msg = this.extractErrorMsg(e);
            const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('ratelimit') || msg.toLowerCase().includes('rate limit');
            if (isRateLimit && attempt < this.MAX_RETRIES) {
                const backoff = (attempt + 1) * 700;
                console.warn(`[Marketkiller] Buy rate-limited for digit ${config.barrier}. Retrying in ${backoff}ms`);
                await this.sleep(backoff);
                return this.directBuy(config, attempt + 1);
            }
            console.error(`[Marketkiller] Buy exception for digit ${config.barrier}:`, msg);
            return null;
        }

        if (buyRes?.error) {
            const { code, message } = buyRes.error;
            if (code === 'RateLimit' && attempt < this.MAX_RETRIES) {
                const backoff = (attempt + 1) * 700;
                console.warn(`[Marketkiller] Buy RateLimit for digit ${config.barrier}. Retrying in ${backoff}ms`);
                await this.sleep(backoff);
                return this.directBuy(config, attempt + 1);
            }
            console.error(`[Marketkiller] Buy rejected for digit ${config.barrier}: [${code}] ${message}`);
            return null;
        }

        return buyRes;
    };

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;
        this.stats_engine = new DigitStatsEngine();

        // Initial ribbon markets
        const initialMarkets = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V'];
        initialMarkets.forEach(sym => {
            this.live_market_ribbon.push({ symbol: sym, price: '0.00', digit: null, is_up: true });
        });

        // Wait for API to be ready then connect
        this.waitForApiAndConnect();
    }

    @action
    private waitForApiAndConnect = () => {
        const tryConnect = () => {
            if (api_base.api) {
                runInAction(() => {
                    this.is_connected = true;
                });
                this.subscribeToTicks();
                this.subscribeToRibbon();
            } else {
                setTimeout(tryConnect, 1000);
            }
        };
        tryConnect();
    };

    @action
    setActiveSubtab = (tab: TMarketkillerSubtab) => {
        this.active_subtab = tab;
    };

    @action
    setSymbol = (sym: string) => {
        this.symbol = sym;
        this.subscribeToTicks();
    };

    @action
    toggleEngine = () => {
        this.is_running = !this.is_running;
        if (!this.is_running) {
            this.consecutive_losses = 0;
        }
    };

    @action
    addRecoveryStep = () => {
        const id = Math.random().toString(36).substring(2, 9);
        runInAction(() => {
            this.onetrader_settings.recovery_chain.push({
                id,
                symbol: this.symbol,
                contract_type: this.onetrader_settings.contract_type === 'DIGITOVER' ? 'DIGITUNDER' : 'DIGITOVER',
                stake_multiplier: 2,
                barrier: this.onetrader_settings.barrier,
            });
        });
    };

    @action
    removeRecoveryStep = (id: string) => {
        runInAction(() => {
            this.onetrader_settings.recovery_chain = this.onetrader_settings.recovery_chain.filter(s => s.id !== id);
        });
    };

    private tick_listener_sub: any = null;

    @action
    public subscribeToTicks = async () => {
        // Cleanup previous tick subscription ID if exists
        if (this.tick_subscription) {
            try {
                await api_base.unsubscribeById(this.tick_subscription);
            } catch (e) { /* ignore */ }
            this.tick_subscription = null;
        }

        // Cleanup RxJS listener to prevent memory leaks and duplicate ticks
        if (this.tick_listener_sub) {
            try {
                this.tick_listener_sub.unsubscribe();
            } catch(e) { /* ignore */ }
            this.tick_listener_sub = null;
        }

        if (!api_base.api || api_base.api.connection?.readyState !== 1) {
            console.warn('[Marketkiller] Subscribing aborted: WebSocket disconnected.');
            return;
        }

        try {
            console.log('[Marketkiller] Subscribing to ticks for:', this.symbol);
            const ok = await isSymbolAvailable(this.symbol);
            if (!ok) {
                console.warn('[Marketkiller] Symbol not available, aborting subscribe:', this.symbol);
                return;
            }
            const subId = await api_base.subscribeTo({ ticks: this.symbol }, (res: any) => {
                if (res?.tick && res.tick.symbol === this.symbol) {
                    this.onTickArrival(res.tick);
                }
            });
            this.tick_subscription = subId;
        } catch (error: any) {
            console.error('Marketkiller tick sub error:', error?.message || error);
        }
    };

    @action
    private subscribeToRibbon = async () => {
        if (!api_base.api || api_base.api.connection?.readyState !== 1) return;

        this.live_market_ribbon.forEach(async m => {
            try {
                const subId = await api_base.subscribeTo({ ticks: m.symbol }, (res: any) => {
                    if (res?.tick) {
                        const tick = res.tick;
                        const index = this.live_market_ribbon.findIndex(x => x?.symbol === tick.symbol);
                        if (index !== -1) {
                            runInAction(() => {
                                const mm = this.live_market_ribbon[index];
                                if (!mm) return;
                                const price = parseFloat(tick.quote).toFixed(tick.pip_size || 2);
                                mm.is_up = parseFloat(price) >= parseFloat(String(mm.price));
                                mm.price = price;
                                mm.digit = parseInt(price.slice(-1));
                            });
                        }
                    }
                });
                if (subId) this.ribbon_subscriptions.set(m.symbol, subId);
            } catch (e) {
                // ignore
            }
        });
    };

    @action
    private onTickArrival = (tick: any) => {
        const price = parseFloat(tick.quote).toFixed(tick.pip_size || 2);
        const last_digit = parseInt(price.slice(-1));

        runInAction(() => {
            this.current_price = price;
            this.last_digit = last_digit;
            this.ticks = [...this.ticks, last_digit].slice(-120);

            // Feed DigitStatsEngine
            this.stats_engine.updateWithHistory(this.ticks.slice(-this.matches_settings.check_ticks), parseFloat(String(this.current_price)));

            // Track recent power scores for Rule 3
            const currentPowers = this.stats_engine.digit_stats.map(s => s.power);
            this.recent_powers = [...this.recent_powers, currentPowers].slice(-5);

            this.updateDigitAnalytics();

            if (this.is_running && !this.is_executing) {
                this.evaluateLogicEngine();
            }
        });
    };

    @action
    private updateDigitAnalytics = () => {
        const stats = this.stats_engine.digit_stats;
        if (stats.length === 0) return;

        this.digit_stats = stats.map(s => ({
            digit: s.digit,
            count: s.count,
            percentage: s.percentage,
            rank: s.rank,
            is_increasing: s.is_increasing,
        }));

        this.digit_power_scores = stats.map(s => s.power);

        // Update global Signal state
        const percentages = this.stats_engine.getPercentages();
        switch (this.signal_strategy) {
            case 'EVEN':
                this.signal_power = percentages.even;
                break;
            case 'ODD':
                this.signal_power = percentages.odd;
                break;
            case 'RISE':
                this.signal_power = percentages.rise;
                break;
            case 'FALL':
                this.signal_power = percentages.fall;
                break;
            case 'OVER_4':
                this.signal_power = percentages.over;
                break;
            case 'UNDER_5':
                this.signal_power = percentages.under;
                break;
        }

        this.signal_stability = Math.max(20, 100 - Math.abs(50 - this.signal_power) / 2);

        // Calculate Special Ranks for Matches
        if (this.digit_stats.length >= 10) {
            const sorted = [...this.digit_stats].sort((a, b) => b.count - a.count);
            this.matches_ranks = {
                most: sorted[0].digit,
                second: sorted[1].digit,
                least: sorted[9].digit,
            };
        }
    };

    @action
    private evaluateLogicEngine = () => {
        if (this.active_subtab === 'matches') {
            this.evaluateMatchesKiller();
        }
    };

    /**
     * Matches Killer Logic Engine
     * Evaluates 6 configurable conditions against live digit stats to decide
     * whether to fire parallel DIGITMATCH trades via directBuy.
     */
    @action
    private evaluateMatchesKiller = async () => {
        const settings = this.matches_settings;
        const conditions = settings.enabled_conditions;
        const stats = this.digit_stats;
        if (stats.length < 10 || this.ticks.length < settings.check_ticks) return;

        const sorted = [...stats].sort((a, b) => b.count - a.count);
        const most = sorted[0];
        const second = sorted[1];
        const least = sorted[9];

        let passed = 0;
        const required = conditions.filter(Boolean).length;
        if (required === 0) return;

        // C1: Most-frequent digit percentage >= 15%
        if (conditions[0] && most.percentage >= 15) passed++;
        // C2: Gap between most and 2nd >= 3%
        if (conditions[1] && most.percentage - second.percentage >= 3) passed++;
        // C3: Least-frequent digit percentage <= 5%
        if (conditions[2] && least.percentage <= 5) passed++;
        // C4: Most-frequent count compare (configurable operator & value over N ticks)
        if (conditions[3]) {
            const recentSlice = this.ticks.slice(-settings.c4_ticks);
            const c4Count = recentSlice.filter(d => d === most.digit).length;
            const pass4 = settings.c4_op === '>='
                ? c4Count >= settings.c4_val
                : c4Count <= settings.c4_val;
            if (pass4) passed++;
        }
        // C5: Power score of most-frequent digit is top-3
        if (conditions[4]) {
            const powers = this.digit_power_scores;
            const sortedPowers = [...powers].map((p, i) => ({ digit: i, power: p })).sort((a, b) => b.power - a.power);
            if (sortedPowers.slice(0, 3).some(s => s.digit === most.digit)) passed++;
        }
        // C6: Target rank digit appeared c6_count+ times in last check_ticks
        if (conditions[5]) {
            const targetDigit = settings.c6_target_rank === 'most' ? most.digit
                : settings.c6_target_rank === '2nd' ? second.digit
                : least.digit;
            const recentSlice = this.ticks.slice(-settings.check_ticks);
            const rankCount = recentSlice.filter(d => d === (targetDigit ?? -1)).length;
            if (rankCount >= settings.c6_count) passed++;
        }

        if (passed < required) return;

        // All enabled conditions passed — determine prediction targets
        const sortedDigits = sorted.map(s => s.digit);
        const targets: number[] = settings.is_auto
            ? sortedDigits.slice(0, settings.simultaneous_trades || 1)
            : Array.from({ length: settings.simultaneous_trades || 1 }).map((_, i) => settings.predictions[i] ?? 0);

        if (targets.length === 0) return;

        const trades = targets.map(digit => ({
            type: 'DIGITMATCH',
            symbol: this.symbol,
            barrier: digit,
            stake: settings.stake,
        }));

        await this.executeConcurrentTrades(trades);
    };

    /**
     * Fires directBuy for each trade in parallel, then monitors each
     * contract via proposal_open_contract until settlement.
     */
    @action
    private executeConcurrentTrades = async (trades: { type: string; symbol: string; barrier: number; stake: number }[]) => {
        if (trades.length === 0 || !api_base.api) return;

        this.is_executing = true;
        this.total_runs++;

        try {
            const buyResults = await Promise.all(trades.map(t => this.directBuy(t)));

            for (const buyRes of buyResults) {
                if (!buyRes?.buy?.contract_id) continue;

                const contractId = buyRes.buy.contract_id;
                const stake = parseFloat(buyRes.buy.buy_price || '0');

                runInAction(() => {
                    this.total_stake_used += stake;
                });

                try {
                    const pocReq = transformRequest({
                        proposal_open_contract: 1,
                        contract_id: contractId,
                        subscribe: 1,
                    }, 'proposal_open_contract');

                    api_base.api.send(pocReq).then((pocRes: any) => {
                        this.handleContractSettlement(pocRes);
                    });

                    if (api_base.api.onMessage) {
                        const sub = api_base.api.onMessage().subscribe((res: any) => {
                            if (
                                res?.data?.msg_type === 'proposal_open_contract' &&
                                res.data.proposal_open_contract?.contract_id === contractId
                            ) {
                                const transformed = transformResponse(res.data, 'proposal_open_contract');
                                if (transformed?.proposal_open_contract?.is_sold) {
                                    this.handleContractSettlement(transformed);
                                    try { sub.unsubscribe(); } catch (_) { /* ignore */ }
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.error('[Marketkiller] POC subscribe error:', e);
                }
            }
        } catch (e) {
            console.error('[Marketkiller] executeConcurrentTrades error:', e);
        }

        // Release execution lock after a safety buffer
        setTimeout(() => {
            runInAction(() => { this.is_executing = false; });
        }, 1500);
    };

    /** Handle a settled contract — update W/L stats and journal */
    @action
    private handleContractSettlement = (response: any) => {
        const poc = response?.proposal_open_contract;
        if (!poc?.is_sold) return;

        const profit = parseFloat(poc.profit || '0');
        const status = poc.status;

        runInAction(() => {
            if (status === 'won') {
                this.wins++;
                this.consecutive_losses = 0;
            } else {
                this.losses++;
                this.consecutive_losses++;
            }
            this.session_pl += profit;

            this.trades_journal.push({
                contract_id: poc.contract_id,
                type: poc.contract_type,
                symbol: poc.underlying,
                barrier: poc.barrier,
                stake: poc.buy_price,
                payout: poc.payout,
                profit,
                status,
                timestamp: Date.now(),
            });

            // Martingale: increase stake on loss
            if (status !== 'won' && this.matches_settings.martingale_enabled) {
                this.matches_settings.stake = parseFloat(
                    (this.matches_settings.stake * (1 + this.matches_settings.martingale_multiplier)).toFixed(2)
                );
            } else if (status === 'won' && this.matches_settings.martingale_enabled) {
                this.matches_settings.stake = Math.max(0.35, this.matches_settings.stake);
            }
        });
    };

    @action
    public resetStats = () => {
        this.wins = 0;
        this.losses = 0;
        this.session_pl = 0;
        this.total_stake_used = 0;
        this.total_runs = 0;
        this.consecutive_losses = 0;
        this.trades_journal = [];
    };

    @action
    public executeOneShot = async () => {
        const sortedDigits = [...this.digit_stats].sort((a, b) => b.count - a.count).map(s => s.digit);
        
        const targets: number[] = this.matches_settings.is_auto 
            ? sortedDigits.slice(0, this.matches_settings.simultaneous_trades || 1)
            : Array.from({ length: this.matches_settings.simultaneous_trades || 1 }).map((_, i) => this.matches_settings.predictions[i] ?? 0);

        if (targets.length === 0) return;

        const trades = targets.map(digit => ({
            type: 'DIGITMATCH',
            symbol: this.symbol,
            barrier: digit,
            stake: this.matches_settings.stake,
        }));

        await this.executeConcurrentTrades(trades);
    };

    @action
    public executeSingleManualTrade = async (digit: number) => {
        const trade = {
            type: 'DIGITMATCH',
            symbol: this.symbol,
            barrier: digit,
            stake: this.matches_settings.stake,
        };

        await this.executeConcurrentTrades([trade]);
    };
}
