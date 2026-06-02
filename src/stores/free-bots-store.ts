import { action, makeObservable, observable, runInAction } from 'mobx';
import DerivWS from '@/services/DerivWS';
import { DigitStatsEngine } from '@/lib/digit-stats-engine';
import RootStore from './root-store';

export type TBotConfig = {
    stake: number;
    multiplier: number;
    ticks: number;
    max_loss: number;
    use_max_loss: boolean;
    prediction: number;
    is_running: boolean;
    is_auto: boolean;
    max_runs: number;
    runs_count: number;
    use_switch_on_loss: boolean;
    switch_contract: string; // e.g. 'DIGITEVEN', 'DIGITOVER' etc
    switch_prediction: number;
};

export type TBotLog = {
    time: number;
    msg: string;
    type: 'info' | 'success' | 'error' | 'trade';
};

const makeBotConfig = (overrides: Partial<TBotConfig> = {}): TBotConfig => ({
    stake: 0.35,
    multiplier: 2.1,
    ticks: 1,
    max_loss: 5,
    use_max_loss: true,
    prediction: 4,
    is_running: false,
    is_auto: false,
    max_runs: 12,
    runs_count: 0,
    use_switch_on_loss: false,
    switch_contract: 'DIGITEVEN',
    switch_prediction: 4,
    ...overrides,
});

const DEFAULT_MARKETS = [
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

export default class FreeBotsStore {
    root_store: RootStore;
    private stats_engine: DigitStatsEngine;
    private pip_map: Map<string, number> = new Map();
    private unsubscribe: (() => void) | null = null;
    private consecutive_even = 0;
    private consecutive_odd = 0;
    private consecutive_over = 0;
    private consecutive_under = 0;
    private last_result: 'WIN' | 'LOSS' | null = null;
    private streak = 0;
    private eo_wait_phase = false; // waiting for least digit to appear
    private eo_least_appeared = false;
    private eo_tick_count = 0; // ticks since least digit appeared
    private is_executing = false;

    // Market
    @observable accessor symbol = 'R_100';
    @observable accessor pip = 2;
    @observable accessor markets = DEFAULT_MARKETS;
    @observable accessor is_connected = false;
    @observable accessor is_subscribing = false;

    // Live Stats
    @observable accessor ticks: number[] = [];
    @observable accessor current_price: string | number = '0.00';
    @observable accessor last_digit: number | null = null;
    @observable accessor last_15: number[] = [];
    @observable accessor digit_stats: {
        digit: number;
        count: number;
        percentage: number;
        rank: number;
        power: number;
        is_increasing: boolean;
    }[] = [];
    @observable accessor percentages = { even: 50, odd: 50, over: 50, under: 50 };

    // Bot configs
    @observable accessor even_odd_config: TBotConfig = makeBotConfig({ prediction: 0, switch_contract: 'DIGITOVER' });
    @observable accessor over_under_config: TBotConfig = makeBotConfig({ prediction: 4, switch_contract: 'DIGITEVEN' });
    @observable accessor differs_config: TBotConfig = makeBotConfig({ multiplier: 11, switch_contract: 'DIGITEVEN' });
    @observable accessor matches_config: TBotConfig = makeBotConfig({
        multiplier: 11,
        max_runs: 7,
        switch_contract: 'DIGITEVEN',
    });

    // Bot status
    @observable accessor even_odd_status = 'IDLE';
    @observable accessor over_under_status = 'IDLE';
    @observable accessor differs_status = 'IDLE';
    @observable accessor matches_status = 'IDLE';

    // Logs per bot
    @observable accessor even_odd_logs: TBotLog[] = [];
    @observable accessor over_under_logs: TBotLog[] = [];
    @observable accessor differs_logs: TBotLog[] = [];
    @observable accessor matches_logs: TBotLog[] = [];

    // Profit tracking
    @observable accessor session_profit = 0;

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;
        this.stats_engine = new DigitStatsEngine();
        this.waitAndConnect();
    }

    private waitAndConnect = () => {
        const try_connect = async () => {
            try {
                await DerivWS.connect();
                runInAction(() => {
                    this.is_connected = true;
                });
                this.fetchMarkets();
                this.subscribeToTicks();
            } catch {
                setTimeout(try_connect, 1000);
            }
        };
        try_connect();
    };

    @action
    fetchMarkets = async () => {
        try {
            if (!DerivWS.isConnected) return;
            const res = await DerivWS.send({ active_symbols: 'brief', product_type: 'basic' });
            if (res?.active_symbols?.length) {
                const groups: Record<string, { group: string; items: { value: string; label: string }[] }> = {};
                res.active_symbols.forEach((s: any) => {
                    if (s.is_trading_suspended) return;
                    const g = s.market_display_name || s.market || 'Other';
                    if (!groups[g]) groups[g] = { group: g, items: [] };
                    groups[g].items.push({ value: s.symbol, label: s.display_name });
                    this.pip_map.set(s.symbol, Math.abs(Math.log10(s.pip)));
                    if (s.symbol === this.symbol) this.pip = Math.abs(Math.log10(s.pip));
                });
                const sorted = Object.values(groups).sort((a, b) => a.group.localeCompare(b.group));
                runInAction(() => {
                    this.markets = sorted.length ? sorted : DEFAULT_MARKETS;
                });
            }
        } catch (e) {
            console.error('[FreeBotsStore] fetchMarkets error:', e);
        }
    };

    @action
    setSymbol = (sym: string) => {
        if (this.symbol === sym) return;
        this.symbol = sym;
        this.pip = this.pip_map.get(sym) || 2;
        this.stats_engine.setConfig({
            pip: this.pip,
            total_samples: 200,
            over_under_threshold: 5,
            match_diff_digit: 6,
        });
        this.ticks = [];
        this.last_15 = [];
        this.last_digit = null;
        this.current_price = '0.00';
        this.subscribeToTicks();
    };

    @action
    subscribeToTicks = async (retry_count = 0) => {
        if (!DerivWS.isConnected || this.is_subscribing) return;
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        this.is_subscribing = true;

        try {
            const subscriptionId = DerivWS.subscribe(
                {
                    ticks_history: this.symbol,
                    count: 200,
                    end: 'latest',
                    style: 'ticks',
                },
                (msg: any) => {
                    const data = msg.data || msg;

                    if (data.history || data.ticks_history) {
                        const hist = data.history || data.ticks_history;
                        if (hist?.prices?.length) {
                            runInAction(() => {
                                const prices = hist.prices.map(Number);
                                const digits = prices.map((p: number) => this.stats_engine.extractLastDigit(p));
                                this.ticks = digits.slice(-200);
                                this.last_15 = digits.slice(-15);
                                this.last_digit = digits[digits.length - 1] ?? null;
                                this.current_price = prices[prices.length - 1];
                                this.stats_engine.update(this.ticks, prices);
                                this.refreshStats();
                                this.is_subscribing = false;
                            });
                        }
                        return;
                    }

                    if (data.msg_type === 'tick' && data.tick && data.tick.symbol === this.symbol) {
                        this.processTick(data.tick);
                    }
                }
            );

            this.unsubscribe = () => DerivWS.unsubscribe(subscriptionId);

            runInAction(() => {
                this.is_subscribing = false;
            });
        } catch (e) {
            console.error('[FreeBotsStore] Subscription failed:', e);
            runInAction(() => {
                this.is_subscribing = false;
            });

            if (retry_count < 3) {
                setTimeout(() => this.subscribeToTicks(retry_count + 1), 2000);
            }
        }
    };

    @action
    private processTick = (tick: { quote: number | string; epoch: number }) => {
        const price = Number(tick.quote);
        const digit = this.stats_engine.extractLastDigit(price);
        if (isNaN(digit)) return;

        this.current_price = price;
        this.last_digit = digit;

        const updated = [...this.ticks, digit].slice(-200);
        this.ticks = updated;
        this.last_15 = updated.slice(-15);

        this.stats_engine.updateWithHistory(updated, price);
        this.refreshStats();

        // Update streak counters
        if (digit % 2 === 0) {
            this.consecutive_even++;
            this.consecutive_odd = 0;
        } else {
            this.consecutive_odd++;
            this.consecutive_even = 0;
        }
        if (digit >= 5) {
            this.consecutive_over++;
            this.consecutive_under = 0;
        } else {
            this.consecutive_under++;
            this.consecutive_over = 0;
        }

        // Feed active bots
        if (this.even_odd_config.is_running) this.tickEvenOdd(digit);
        if (this.over_under_config.is_running) this.tickOverUnder(digit);
        if (this.differs_config.is_running) this.tickDiffers();
        if (this.matches_config.is_running) this.tickMatches(digit);
    };

    @action
    private refreshStats = () => {
        this.digit_stats = this.stats_engine.digit_stats;
        this.percentages = {
            even: this.stats_engine.getPercentages().even,
            odd: this.stats_engine.getPercentages().odd,
            over: this.stats_engine.getPercentages().over,
            under: this.stats_engine.getPercentages().under,
        };
    };

    // ─── Even/Odd Bot Logic ────────────────────────────────────────────────────
    @action
    private tickEvenOdd = (digit: number) => {
        const cfg = this.even_odd_config;
        if (!cfg.is_auto) return; // manual = user clicks only
        if (this.is_executing) return;
        if (cfg.runs_count >= cfg.max_runs) {
            this.stopBot('even_odd', 'MAX RUNS');
            return;
        }

        const { even, odd } = this.percentages;
        const dominant = even >= odd ? 'even' : 'odd';
        const dom_pct = Math.max(even, odd);

        if (dom_pct < 55) {
            this.even_odd_status = `WAITING (${dom_pct.toFixed(1)}% < 55%)`;
            this.eo_wait_phase = false;
            this.eo_least_appeared = false;
            return;
        }

        // Find least-appearing digit
        const sorted = [...this.digit_stats].sort((a, b) => a.percentage - b.percentage);
        const least_digit = sorted[0]?.digit;

        if (!this.eo_wait_phase) {
            this.even_odd_status = `READY — Waiting for least digit (${least_digit})`;
            this.eo_wait_phase = true;
            this.eo_least_appeared = false;
            this.eo_tick_count = 0;
        }

        if (!this.eo_least_appeared && digit === least_digit) {
            this.eo_least_appeared = true;
            this.eo_tick_count = 0;
            this.even_odd_status = `PRIMED — Waiting for ${dominant.toUpperCase()} in 3 ticks`;
        }

        if (this.eo_least_appeared) {
            this.eo_tick_count++;
            const is_dominant_type = dominant === 'even' ? digit % 2 === 0 : digit % 2 !== 0;
            if (is_dominant_type) {
                this.even_odd_status = 'FIRING TRADE ⚡';
                this.eo_wait_phase = false;
                this.eo_least_appeared = false;
                const contract = dominant === 'even' ? 'DIGITEVEN' : 'DIGITODD';
                this.executeTrade(contract, 0, cfg, 'even_odd');
            } else if (this.eo_tick_count >= 3) {
                this.eo_wait_phase = false;
                this.eo_least_appeared = false;
                this.even_odd_status = `RESET — Missed window, re-watching`;
            }
        }
    };

    // ─── Over/Under Bot Logic ─────────────────────────────────────────────────
    @action
    private tickOverUnder = (_digit: number) => {
        const cfg = this.over_under_config;
        if (!cfg.is_auto) return;
        if (this.is_executing) return;
        if (cfg.runs_count >= cfg.max_runs) {
            this.stopBot('over_under', 'MAX RUNS');
            return;
        }

        const { over, under } = this.percentages;
        const dominant = over >= under ? 'over' : 'under';
        const dom_pct = Math.max(over, under);

        if (dom_pct < 55) {
            this.over_under_status = `WAITING (${dom_pct.toFixed(1)}% < 55%)`;
            return;
        }

        // Auto-suggest prediction
        let prediction = cfg.prediction;
        if (dominant === 'under') {
            // Under: trade DIGITUNDER, barrier should be 6-9
            prediction = [6, 7, 8, 9].includes(prediction) ? prediction : 8;
        } else {
            // Over: trade DIGITOVER, barrier should be 0-3
            prediction = [0, 1, 2, 3].includes(prediction) ? prediction : 1;
        }

        // Find highest % digit in dominant range
        const range = dominant === 'under' ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
        const best_in_range = [...this.digit_stats]
            .filter(s => range.includes(s.digit))
            .sort((a, b) => b.percentage - a.percentage)[0];

        if (best_in_range?.is_increasing) {
            this.over_under_status = `FIRING — ${dominant.toUpperCase()} ${dom_pct.toFixed(1)}% ⚡`;
            const contract = dominant === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
            this.executeTrade(contract, prediction, cfg, 'over_under');
        } else {
            this.over_under_status = `READY — ${dominant.toUpperCase()} dominant, waiting for increase`;
        }
    };

    // ─── Differs Bot Logic ────────────────────────────────────────────────────
    @action
    private tickDiffers = () => {
        const cfg = this.differs_config;
        if (this.is_executing) return;
        if (cfg.runs_count >= cfg.max_runs) {
            this.stopBot('differs', 'MAX RUNS');
            return;
        }

        const sorted_asc = [...this.digit_stats].sort((a, b) => a.percentage - b.percentage);
        const sorted_desc = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
        const most = sorted_desc[0]?.digit;
        const second_most = sorted_desc[1]?.digit;
        const least = sorted_asc[0]?.digit;

        // Eligible: 2-7, not most/second/least, NOT increasing (decreasing power)
        // User: "should not differ most appearing, 2nd most appearing or least appearing.
        // it should use the digit that is not increasing in power and start trading when digit decreases only"
        const eligible = this.digit_stats.filter(
            s =>
                s.digit >= 2 &&
                s.digit <= 7 &&
                s.digit !== most &&
                s.digit !== second_most &&
                s.digit !== least &&
                !s.is_increasing
        );

        if (eligible.length === 0) {
            this.differs_status = 'SCANNING — No eligible decreasing digit (2-7)...';
            return;
        }

        // Pick the one with highest negative trend or just the first eligible decreasing one
        const target = eligible[0];
        runInAction(() => {
            cfg.prediction = target.digit;
        });
        this.differs_status = `FIRING — DIFFERS ${target.digit} (decreasing power) ⚡`;
        this.executeTrade('DIGITDIFF', target.digit, cfg, 'differs');
    };

    // ─── Matches Bot (HFT) Logic ──────────────────────────────────────────────
    @action
    private tickMatches = (_digit: number) => {
        const cfg = this.matches_config;
        if (this.is_executing) return;
        if (cfg.runs_count >= cfg.max_runs) {
            this.stopBot('matches', 'MAX RUNS REACHED');
            return;
        }

        const sorted_desc = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
        const top3 = sorted_desc.slice(0, 3);

        // Find if we are currently tracking a digit or just pick the best hot one
        const best = top3[0]; // Most appearing

        if (!best || !best.is_increasing) {
            this.matches_status = `WAITING — Most appearing digit not increasing`;
            // If we were running and it stopped increasing, the requirement says stop
            if (cfg.runs_count > 0) {
                this.stopBot('matches', 'POWER DECREASED — Strategy Stopped');
            }
            return;
        }

        // User: "this bot will execute every tick(digit) generated and trade wihtout skipping any"
        runInAction(() => {
            cfg.prediction = best.digit;
        });
        this.matches_status = `HFT ACTIVE — Matching Digit ${best.digit} 🚀`;
        this.executeTrade('DIGITMATCH', best.digit, cfg, 'matches');
    };

    // ─── Shared Trade Executor ────────────────────────────────────────────────
    @action
    executeTrade = async (
        contract_type: string,
        prediction: number,
        cfg: TBotConfig,
        bot_key: 'even_odd' | 'over_under' | 'differs' | 'matches'
    ) => {
        if (this.is_executing) return;
        this.is_executing = true;

        const addLog = (msg: string, type: TBotLog['type']) => {
            const log_key = `${bot_key}_logs` as keyof this;
            const logs = this[log_key] as TBotLog[];
            logs.unshift({ time: Date.now(), msg, type });
            if (logs.length > 60) logs.pop();
        };

        try {
            const api = api_base?.api;
            if (!api) throw new Error('WebSocket not connected');

            const stake = this.calcStake(cfg);
            addLog(`📤 ${contract_type} | $${stake} | ${this.symbol}`, 'trade');

            const proposal_data: Record<string, unknown> = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type,
                currency: this.root_store.client?.currency || 'USD',
                duration: cfg.ticks,
                duration_unit: 't',
                symbol: this.symbol,
            };
            if (!['DIGITEVEN', 'DIGITODD'].includes(contract_type)) {
                proposal_data.barrier = String(prediction);
            }

            const proposal = (await api.send(proposal_data)) as any;
            if (proposal.error) throw new Error(proposal.error.message);
            if (!proposal.proposal?.id) throw new Error('No proposal ID');

            const buy = (await api.send({ buy: proposal.proposal.id, price: stake })) as any;
            if (buy.error) throw new Error(buy.error.message);

            addLog(`✅ Contract: ${buy.buy.contract_id}`, 'info');
            cfg.runs_count++;

            // Poll result
            const check = setInterval(async () => {
                try {
                    const result = (await api.send({
                        proposal_open_contract: 1,
                        contract_id: buy.buy.contract_id,
                    })) as any;
                    const poc = result.proposal_open_contract;
                    if (poc?.is_sold) {
                        clearInterval(check);
                        const profit = Number(poc.profit);
                        this.last_result = profit > 0 ? 'WIN' : 'LOSS';

                        runInAction(() => {
                            this.session_profit += profit;
                            if (profit > 0) {
                                this.streak = 0;
                                addLog(`🏆 WIN +$${profit.toFixed(2)}`, 'success');
                            } else {
                                this.streak++;
                                addLog(`💀 LOSS $${profit.toFixed(2)}`, 'error');

                                // Handle max loss
                                if (cfg.use_max_loss && Math.abs(this.session_profit) >= cfg.max_loss) {
                                    this.stopBot(bot_key, 'MAX LOSS HIT');
                                }

                                // Handle switch on loss
                                if (cfg.use_switch_on_loss && this.streak >= 2) {
                                    addLog(`🔀 Switching to ${cfg.switch_contract}`, 'info');
                                    this.executeTrade(cfg.switch_contract, cfg.switch_prediction, cfg, bot_key);
                                    return;
                                }
                            }
                            this.is_executing = false;
                        });
                    }
                } catch {
                    clearInterval(check);
                    runInAction(() => {
                        this.is_executing = false;
                    });
                }
            }, 1000);
        } catch (e: unknown) {
            const msg = (e as Error).message || 'Unknown error';
            addLog(`❌ ${msg}`, 'error');
            runInAction(() => {
                this.is_executing = false;
            });
        }
    };

    @action
    tradeOnce = (bot_key: 'even_odd' | 'over_under' | 'differs' | 'matches') => {
        const cfgMap = {
            even_odd: this.even_odd_config,
            over_under: this.over_under_config,
            differs: this.differs_config,
            matches: this.matches_config,
        };
        const cfg = cfgMap[bot_key];

        if (bot_key === 'even_odd') {
            const contract = this.percentages.even >= this.percentages.odd ? 'DIGITEVEN' : 'DIGITODD';
            this.executeTrade(contract, cfg.prediction, cfg, bot_key);
        } else if (bot_key === 'over_under') {
            const contract = this.percentages.over >= this.percentages.under ? 'DIGITOVER' : 'DIGITUNDER';
            this.executeTrade(contract, cfg.prediction, cfg, bot_key);
        } else if (bot_key === 'differs') {
            const sorted = [...this.digit_stats].sort((a, b) => a.percentage - b.percentage);
            const most = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
            const eligible = sorted.filter(
                s =>
                    s.digit >= 2 &&
                    s.digit <= 7 &&
                    s.digit !== most[0]?.digit &&
                    s.digit !== most[1]?.digit &&
                    s.digit !== sorted[0]?.digit
            );
            const target = eligible[0]?.digit ?? cfg.prediction;
            this.executeTrade('DIGITDIFF', target, cfg, bot_key);
        } else if (bot_key === 'matches') {
            const best = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage)[0];
            this.executeTrade('DIGITMATCH', best?.digit ?? 0, cfg, bot_key);
        }
    };

    @action
    toggleAutoBot = (bot_key: 'even_odd' | 'over_under' | 'differs' | 'matches') => {
        const cfgMap = {
            even_odd: this.even_odd_config,
            over_under: this.over_under_config,
            differs: this.differs_config,
            matches: this.matches_config,
        };
        const cfg = cfgMap[bot_key];
        cfg.is_auto = !cfg.is_auto;
        cfg.is_running = cfg.is_auto;

        if (cfg.is_running) {
            cfg.runs_count = 0;
            const status_key = `${bot_key}_status` as keyof this;
            (this[status_key] as string) = 'AUTO STARTED — Analyzing...';
        } else {
            this.stopBot(bot_key, 'STOPPED');
        }
    };

    @action
    stopBot = (bot_key: 'even_odd' | 'over_under' | 'differs' | 'matches', reason: string) => {
        const cfgMap = {
            even_odd: this.even_odd_config,
            over_under: this.over_under_config,
            differs: this.differs_config,
            matches: this.matches_config,
        };
        const cfg = cfgMap[bot_key];
        cfg.is_running = false;
        cfg.is_auto = false;
        const status_key = `${bot_key}_status` as keyof this;
        (this[status_key] as string) = `STOPPED: ${reason}`;
    };

    @action
    updateConfig = <K extends keyof TBotConfig>(
        bot_key: 'even_odd' | 'over_under' | 'differs' | 'matches',
        key: K,
        value: TBotConfig[K]
    ) => {
        const cfgMap = {
            even_odd: this.even_odd_config,
            over_under: this.over_under_config,
            differs: this.differs_config,
            matches: this.matches_config,
        };
        cfgMap[bot_key][key] = value;
    };

    private calcStake = (cfg: TBotConfig): number => {
        let stake = cfg.stake;
        if (this.last_result === 'LOSS') {
            stake = stake * Math.pow(cfg.multiplier, this.streak);
        }
        return Number(Math.min(stake, 500).toFixed(2));
    };

    // Computed helpers for UI
    get differs_eligible() {
        const sorted_desc = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
        const sorted_asc = [...this.digit_stats].sort((a, b) => a.percentage - b.percentage);
        const most = sorted_desc[0]?.digit;
        const second = sorted_desc[1]?.digit;
        const least = sorted_asc[0]?.digit;
        return sorted_asc
            .filter(s => s.digit >= 2 && s.digit <= 7 && s.digit !== most && s.digit !== second && s.digit !== least)
            .slice(0, 3);
    }

    get matches_top3() {
        return [...this.digit_stats].sort((a, b) => b.percentage - a.percentage).slice(0, 3);
    }

    get over_stats() {
        return [...this.digit_stats].filter(s => s.digit >= 5).sort((a, b) => b.percentage - a.percentage);
    }

    get under_stats() {
        return [...this.digit_stats].filter(s => s.digit <= 4).sort((a, b) => b.percentage - a.percentage);
    }

    dispose = () => {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    };
}
