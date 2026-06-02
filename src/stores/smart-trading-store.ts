import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { DBOT_TABS } from '@/constants/bot-contents';
import { contract_stages } from '@/constants/contract-stage';
import { api_base, ApiHelpers, observer as globalObserver } from '@/external/bot-skeleton';
import { transformRequest, transformProposalRequest, transformBuyRequest, transformProposalOpenContractRequest, transformSellRequest } from '@/utils/api-migration-adapter';
import {
    HotColdData,
    PredictionResult,
    RiskMetrics,
    SmartPredictor,
    TradingSignal,
} from '@/lib/analysis/smart-predictions';
import { VSenseEngine, VSenseSignal } from '@/lib/analysis/v-sense-engine';
import AnalysisEngine from '@/lib/analysis-engine';
import RootStore from './root-store';

type TDerivResponse = {
    proposal_open_contract?: {
        is_sold?: boolean;
        status?: string;
        profit?: string;
        contract_id?: number | string;
    };
    subscription?: { id: string };
    error?: { message: string; code: string };
    buy?: { contract_id: string | number };
    proposal?: { id: string };
};

export type TSmartSubtab =
    | 'speed'
    | 'bulk'
    | 'automated'
    | 'analysis'
    | 'turbo'
    | 'vsense_turbo'
    | 'money_maker_ultra'
    | 'scp'
    | 'digit_cracker'
    | 'signal_centre'
    | 'pro_tool';

export type TProToolSubtab = 'hedging' | 'matches' | 'differs' | 'hyperbot' | 'speedbot';

export type TSmartDigitStat = {
    digit: number;
    count: number;
    percentage: number;
};

export interface TStrategy {
    id: string;
    name: string;
    contractTypes: string[];
    defaultMultiplier?: number;
    payout: number;
    minConfidence: number;
    description: string;
    is_active: boolean; // For automated triggers
    is_running: boolean; // For Auto24 independent run state
    status: 'idle' | 'waiting' | 'trading' | 'error';
    stake: number;
    martingale: number;
    current_stake: number;
    ticks: number;
    barrier?: { over: number; under: number } | number;
    check_last_x?: number;
    target_pattern?: string;
    target_side?: string;
    threshold_pct?: number;
    condition?: string;
    threshold_val?: number;
    target_type?: string;
    target_digit?: number;
    trade_type?: string;
    prediction?: number;
    // Risk Management per bot
    take_profit: number;
    stop_loss: number;
    max_consecutive_losses: number;
    enable_tp_sl: boolean;
    is_max_loss_enabled: boolean;
    // Stats per bot
    total_wins: number;
    total_losses: number;
    profit_loss: number;
    consecutive_losses: number;
    // Advanced Logic Fields
    market_message?: string;
    is_unstable?: boolean;
    suggested_prediction?: string | number;
    power_history?: number[][]; // Array of digit percentages history
    // Per-Bot Market Selection and Auto-Trade
    selected_symbol?: string;
    current_price?: string | number;
    last_digit?: number | null;
    auto_trade_enabled?: boolean;
    // Per-Bot Digit Stats
    bot_digit_stats?: TSmartDigitStat[];
}

export type TTradeHistory = {
    timestamp: number;
    contractType: string;
    stake: number;
    result: 'WON' | 'LOST';
    profitLoss: number;
};

export default class SmartTradingStore {
    root_store: RootStore;

    @observable accessor is_speedbot_running = false;
    @observable accessor speedbot_contract_type: string = 'DIGITEVEN';
    @observable accessor speedbot_prediction: number = 0;
    @observable accessor speedbot_stake: number = 0.5;

    // Martingale Settings
    @observable accessor use_martingale = false;
    @observable accessor use_compounding = false;
    @observable accessor martingale_multiplier = 2.0;
    @observable accessor max_stake_limit = 100;
    @observable accessor is_max_stake_enabled = false;

    // TP/SL Settings
    @observable accessor enable_tp_sl = false;
    @observable accessor take_profit = 10;
    @observable accessor stop_loss = 10;
    @observable accessor max_consecutive_losses = 5;
    @observable accessor is_max_loss_enabled = false;

    // Notifications
    @observable accessor sound_notifications = true;

    // Bot Logic (Toggles)
    @observable accessor alternate_even_odd = false;
    @observable accessor alternate_on_loss = false;
    @observable accessor recovery_mode = false;

    // Session Stats
    @observable accessor ticks_processed = 0;
    @observable accessor wins = 0;
    @observable accessor losses = 0;
    @observable accessor session_pl = 0;
    @observable accessor current_streak = 0;
    @observable accessor current_stake = 0.5;
    @observable accessor consecutive_losses = 0;
    @observable accessor max_drawdown = 0;
    @observable accessor trade_history: TTradeHistory[] = [];
    @observable accessor manual_trade_history: TTradeHistory[] = [];
    @observable accessor is_smart_auto24_running = false;
    @observable accessor smart_auto24_strategy: string = 'EVENODD';

    @observable accessor digit_stats: TSmartDigitStat[] = Array.from({ length: 10 }, (_, i) => ({
        digit: i,
        count: 0,
        percentage: 0,
    }));

    @observable accessor first_digit_stats: TSmartDigitStat[] = Array.from({ length: 10 }, (_, i) => ({
        digit: i,
        count: 0,
        percentage: 0,
    }));

    @observable accessor ticks: number[] = [];
    @observable accessor tick_count = 1; // Number of ticks to wait before trade
    @observable accessor symbol = 'R_100';
    @observable accessor current_price: string | number = '0.00';
    @observable accessor last_digit: number | null = null;
    @observable accessor is_connected = false;
    @observable accessor markets: { group: string; items: { value: string; label: string }[] }[] = [];
    @observable accessor active_symbols_data: Record<string, { pip: number; symbol: string; display_name: string }> =
        {};

    // V-SENSE™ TurboExec Bot State
    @observable accessor is_turbo_bot_running: boolean = false;
    @observable accessor turbo_bot_state: 'STOPPED' | 'LISTENING' | 'SETUP' | 'CONFIRMING' | 'EXECUTING' | 'COOLDOWN' =
        'STOPPED';
    @observable accessor turbo_settings = {
        max_risk: 0.05,
        is_bulk_enabled: false,
        min_confidence: 60,
        selected_strategy: 'DIFFERS' as 'DIFFERS' | 'EVEN_ODD' | 'OVER_UNDER',
    };
    @observable accessor turbo_cooldown_ticks: number = 0;
    @observable accessor turbo_last_signal: string = '';

    // Bulk Trading Enhancement
    @observable accessor bulk_market: string = 'R_100';
    @observable accessor bulk_contract_type: string = 'DIGITEVEN';
    @observable accessor bulk_prediction: number = 0;
    @observable accessor bulk_stake: number = 0.5;
    @observable accessor bulk_count_per_run: number = 1;
    @observable accessor bulk_mode: 'once' | 'auto' = 'once';
    @observable accessor is_bulk_auto_running: boolean = false;

    // Money Maker Ultra States
    @observable accessor is_money_maker_ultra_running = false;
    @observable accessor ultra_volatility_threshold = 1.5; // σ multiplier
    @observable accessor ultra_momentum_mode: 'shadow_scalper' | 'flash_overunder' | 'momentum_pulse' =
        'shadow_scalper';
    @observable accessor ultra_heartbeat_count = 0;
    @observable accessor ultra_alpha_score = 0; // 0-100 health score
    @observable accessor ultra_session_trades = 0;
    @observable accessor ultra_circuit_breaker_active = false;
    @observable accessor ultra_circuit_breaker_until: number | null = null;
    @observable accessor ultra_last_losses: number[] = []; // Timestamps of recent losses
    @observable accessor ultra_volatility_sigma = 0; // Current standard deviation
    @observable accessor ultra_momentum_velocity = 0; // 0-100 market speed
    @observable accessor ultra_start_balance = 0;
    @observable accessor is_ultra_loop_processing = false;
    @observable accessor ultra_console_logs: Array<{
        timestamp: number;
        message: string;
        type: 'info' | 'success' | 'error';
    }> = [];

    @observable accessor scp_start_balance: number = 0;
    @observable accessor scp_analysis_timer: number = 0;
    @observable accessor scp_analysis_progress: number = 0;
    @observable accessor scp_status: 'idle' | 'analyzing' | 'trading' | 'completed' = 'idle';
    @observable accessor scp_analysis_log: Array<{
        timestamp: number;
        message: string;
        type: 'info' | 'success' | 'error';
    }> = [];
    @observable accessor scp_trading_journal: Array<{
        timestamp: number;
        market: string;
        strategy: string;
        stake: number;
        payout: number;
        profit: number;
        result: 'WIN' | 'LOSS';
        entry_price: string;
        exit_price: string;
        digit: number;
    }> = [];

    @observable accessor active_subtab: TSmartSubtab = 'speed';
    @observable accessor v_sense_signals: VSenseSignal[] = [];
    @observable accessor number_of_contracts = 1;
    @observable accessor is_bulk_trading = false;

    // Smart Analysis State
    @observable accessor smart_analysis_data: {
        predictions: PredictionResult[];
        hotCold: HotColdData;
        risk: RiskMetrics;
        signal: TradingSignal;
    } | null = null;

    // Market Scanning State
    @observable accessor is_scanning = false;
    @observable accessor is_scan_expanded = false; // New state for expanded view
    @observable accessor best_market = '';
    @observable accessor market_fit_score = 0;
    @observable accessor scan_results: { symbol: string; score: number; reason: string }[] = [];

    // Comprehensive Market Scanner Results
    @observable accessor all_markets_stats: Array<{
        symbol: string;
        price: string;
        last_digit: number;
        even_pct: number;
        odd_pct: number;
        over_pct: number;
        under_pct: number;
        top_matches: number[];
        differs_targets: number[];
        timestamp: number;
        score: number;
        reason: string;
    }> = [];

    // Stats Visualization State
    @observable accessor stats_sample_size = 5000;

    // Pro Tool State
    @observable accessor is_pro_tool_running = false;
    @observable accessor pro_tool_active_subtab: TProToolSubtab = 'hedging';
    @observable accessor pro_tool_matches_settings = {
        check_ticks: 25,
        predictions: [] as number[],
        is_multiple_predictions_enabled: false,
        is_power_increase_enabled: false,
        is_double_increase_enabled: false,
        threshold_enabled: false,
        threshold_settings: {
            trade_type: 'DIGITMATCH',
            prediction: 0,
            op: '>' as '>' | '<' | '==',
            val: 10,
            ticks: 25,
        },
        use_rank_matching: false,
        stop_on_win: true,
    };

    @observable accessor pro_tool_hedging_settings = {
        recovery_market: 'R_100',
        alternate_after_losses: 3,
        recovery_chain: [] as string[],
        is_recovery_enabled: false,
        bulk_purchase_count: 1,
    };

    // Signal Centre Advanced Settings
    @observable accessor signals_settings = {
        bulk_count: 1,
        use_compounding: false,
        compounding_multiplier: 2.0,
        use_alternate_market: false,
        alternate_market: 'R_100',
        alternate_after_losses: 3,
    };

    @observable accessor pro_tool_differs_settings = {
        min_gap: 10,
        max_freq: 8,
        safe_digit: 0,
        auto_digit_select: true,
        is_running: false,
    };

    @observable accessor pro_tool_hyperbot_settings = {
        scan_interval: 1000,
        contracts_per_pulse: 3,
        min_confidence: 75,
        is_running: false,
    };

    @observable accessor pro_tool_speedbot_settings = {
        velocity_threshold: 0.5,
        direction: 'both' as 'both' | 'rise' | 'fall',
        is_running: false,
    };

    // Digit Power monitoring (history of counts for last 10 ticks to detect slope)
    @observable accessor digit_power_history: number[][] = Array.from({ length: 10 }, () => []);
    @observable accessor digit_power_scores: number[] = new Array(10).fill(0);

    get last_20_digits() {
        return this.ticks.slice(-20);
    }

    get stats_on_sample() {
        const slice = this.ticks.slice(-this.stats_sample_size);
        const even = slice.filter(d => d % 2 === 0).length;
        const odd = slice.length - even;
        const over = slice.filter(d => d > 4).length; // 5,6,7,8,9
        const under = slice.length - over; // 0,1,2,3,4

        // Calculate Rise/Fall based on price movement
        // We need price ticks for this, not just last digits
        // Assuming we might need a separate price_ticks array if 'ticks' only stores digits
        // But for now, let's use a simple heuristic if 'ticks' is digits or just provide the data structure

        let rises = 0;
        let falls = 0;
        for (let i = 1; i < slice.length; i++) {
            if (slice[i] > slice[i - 1]) rises++;
            else if (slice[i] < slice[i - 1]) falls++;
        }
        const trend_total = rises + falls || 1;

        return {
            total: slice.length,
            even,
            odd,
            over,
            under,
            evenProb: slice.length ? (even / slice.length) * 100 : 0,
            oddProb: slice.length ? (odd / slice.length) * 100 : 0,
            overProb: slice.length ? (over / slice.length) * 100 : 0,
            underProb: slice.length ? (under / slice.length) * 100 : 0,
            riseProb: (rises / trend_total) * 100,
            fallProb: (falls / trend_total) * 100,
        };
    }

    @action
    setStatsSampleSize = (size: number) => {
        this.stats_sample_size = size;
    };

    private analysis_engine = new AnalysisEngine(100);

    // Automated Strategies State
    @observable accessor strategies: Record<string, TStrategy> = {
        EVENODD: {
            id: 'EVENODD',
            name: 'Even/Odd',
            contractTypes: ['DIGITEVEN', 'DIGITODD'],
            defaultMultiplier: 2.1,
            payout: 1.95,
            minConfidence: 55,
            description: 'Trade even vs odd digits',
            is_active: false,
            is_running: false,
            status: 'idle',
            stake: 1.0,
            martingale: 2.1,
            current_stake: 1.0,
            ticks: 1,
            take_profit: 10,
            stop_loss: 10,
            max_consecutive_losses: 5,
            enable_tp_sl: false,
            is_max_loss_enabled: false,
            total_wins: 0,
            total_losses: 0,
            profit_loss: 0,
            consecutive_losses: 0,
            market_message: 'Waiting for signal...',
            is_unstable: false,
            power_history: [],
            selected_symbol: 'R_100',
            auto_trade_enabled: false,
            bot_digit_stats: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
        },
        OVER3UNDER6: {
            id: 'OVER3UNDER6',
            name: 'Over 3 / Under 6',
            contractTypes: ['DIGITOVER', 'DIGITUNDER'],
            defaultMultiplier: 2.6,
            payout: 2.5,
            minConfidence: 52,
            barrier: { over: 3, under: 6 },
            description: 'Trade digits over 3 or under 6',
            is_active: false,
            is_running: false,
            status: 'idle',
            stake: 1.0,
            martingale: 2.6,
            current_stake: 1.0,
            ticks: 1,
            take_profit: 10,
            stop_loss: 10,
            max_consecutive_losses: 5,
            enable_tp_sl: false,
            is_max_loss_enabled: false,
            total_wins: 0,
            total_losses: 0,
            profit_loss: 0,
            consecutive_losses: 0,
            market_message: 'Waiting for signal...',
            is_unstable: false,
            power_history: [],
            selected_symbol: 'R_100',
            auto_trade_enabled: false,
            bot_digit_stats: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
        },
        OVER2UNDER7: {
            id: 'OVER2UNDER7',
            name: 'Over 2 / Under 7',
            contractTypes: ['DIGITOVER', 'DIGITUNDER'],
            defaultMultiplier: 3.5,
            payout: 3.2,
            minConfidence: 48,
            barrier: { over: 2, under: 7 },
            description: 'Trade digits over 2 or under 7',
            is_active: false,
            is_running: false,
            status: 'idle',
            stake: 1.0,
            martingale: 3.5,
            current_stake: 1.0,
            ticks: 1,
            take_profit: 10,
            stop_loss: 10,
            max_consecutive_losses: 5,
            enable_tp_sl: false,
            is_max_loss_enabled: false,
            total_wins: 0,
            total_losses: 0,
            profit_loss: 0,
            consecutive_losses: 0,
            market_message: 'Waiting for signal...',
            is_unstable: false,
            power_history: [],
            selected_symbol: 'R_100',
            auto_trade_enabled: false,
            bot_digit_stats: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
        },
        MATCHES: {
            id: 'MATCHES',
            name: 'Digit Matches',
            contractTypes: ['DIGITMATCH'],
            defaultMultiplier: 10,
            payout: 9.5,
            minConfidence: 15,
            description: 'Predict exact digit match',
            is_active: false,
            is_running: false,
            status: 'idle',
            stake: 1.0,
            martingale: 10,
            current_stake: 1.0,
            ticks: 1,
            take_profit: 10,
            stop_loss: 10,
            max_consecutive_losses: 5,
            enable_tp_sl: false,
            is_max_loss_enabled: false,
            total_wins: 0,
            total_losses: 0,
            profit_loss: 0,
            consecutive_losses: 0,
            market_message: 'Waiting for signal...',
            is_unstable: false,
            power_history: [],
            selected_symbol: 'R_100',
            auto_trade_enabled: false,
            bot_digit_stats: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
        },
        DIFFERS: {
            id: 'DIFFERS',
            name: 'Digit Differs',
            contractTypes: ['DIGITDIFF'],
            defaultMultiplier: 1.1,
            payout: 1.08,
            minConfidence: 85,
            description: 'Predict digit will NOT match',
            is_active: false,
            is_running: false,
            status: 'idle',
            stake: 1.0,
            martingale: 1.1,
            current_stake: 1.0,
            ticks: 1,
            take_profit: 10,
            stop_loss: 10,
            max_consecutive_losses: 5,
            enable_tp_sl: false,
            is_max_loss_enabled: false,
            total_wins: 0,
            total_losses: 0,
            profit_loss: 0,
            consecutive_losses: 0,
            market_message: 'Waiting for signal...',
            is_unstable: false,
            power_history: [],
            selected_symbol: 'R_100',
            auto_trade_enabled: false,
            bot_digit_stats: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
        },
    };

    // Strategy States
    @observable accessor consecutive_even = 0;
    @observable accessor consecutive_odd = 0;
    @observable accessor dominance: 'EVEN' | 'ODD' | 'NEUTRAL' = 'NEUTRAL';
    @observable accessor is_executing = false;

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;

        reaction(
            () => this.root_store.common?.is_socket_opened,
            is_socket_opened => {
                this.is_connected = !!is_socket_opened;
                if (is_socket_opened) {
                    this.fetchMarkets();
                    this.subscribeToActiveSymbol();
                }
            },
            { fireImmediately: true }
        );

        reaction(
            () => this.root_store.dashboard.active_tab,
            active_tab => {
                if (active_tab === DBOT_TABS.SMART_AUTO24) {
                    this.setActiveSubtab('automated');
                } else if (active_tab === DBOT_TABS.SMART_TRADING && this.active_subtab === 'automated') {
                    this.setActiveSubtab('speed');
                }
            }
        );
    }

    @action
    updateDigitStats = (last_digits: number[], price?: string | number) => {
        if (!last_digits || last_digits.length === 0) return;

        const stats = Array.from({ length: 10 }, (_, i) => ({
            digit: i,
            count: 0,
            percentage: 0,
        }));

        last_digits.forEach(digit => {
            if (digit >= 0 && digit <= 9) stats[digit].count++;
        });

        const total = last_digits.length;
        if (total > 0) {
            stats.forEach(stat => {
                stat.percentage = (stat.count / total) * 100;
            });
        }

        this.digit_stats = stats;
        this.ticks = last_digits;
        this.updateFirstDigitStats(last_digits);

        if (price !== undefined && price !== null) {
            runInAction(() => {
                this.current_price = price;
                const price_str = String(price);
                const last_char = price_str[price_str.length - 1];
                const current_digit = parseInt(last_char);
                if (!isNaN(current_digit)) {
                    // Use the last digit from the input array which comes from the source of truth
                    // avoiding string parsing issues (e.g. "1.50" -> "1.5" -> 5 instead of 0)
                    const safe_last_digit = last_digits[last_digits.length - 1];
                    this.last_digit = safe_last_digit !== undefined ? safe_last_digit : current_digit;

                    if (this.last_digit % 2 === 0) {
                        this.consecutive_even++;
                        this.consecutive_odd = 0;
                    } else {
                        this.consecutive_odd++;
                        this.consecutive_even = 0;
                    }
                }
            });
        }

        this.calculateDominance();

        if (this.is_speedbot_running) {
            this.executeSpeedTrade();
        }

        // Update Smart Analysis
        const predictor = new SmartPredictor(last_digits);
        runInAction(() => {
            if (price !== undefined) {
                if (this.analysis_engine) {
                    this.analysis_engine.addTick(Number(price));
                }

                if (this.root_store.auto_trader) {
                    this.root_store.auto_trader.updateDigitStats(last_digits, price);
                }
            }

            this.smart_analysis_data = {
                predictions: predictor.predict(),
                hotCold: predictor.getHotCold(),
                risk: predictor.getRiskMetrics(),
                signal: predictor.getTradingSignal(),
            };

            // Update VSense
            const vsense = new VSenseEngine(this.ticks, this.symbol);
            this.v_sense_signals = vsense.analyze();

            if (this.is_turbo_bot_running) {
                this.processTurboBot();
            }
        });

        this.updatePowerHistory(stats);
        this.updateDigitPowers();

        if (this.is_pro_tool_running) {
            this.evaluateProToolConditions();
        }

        // Loop with concurrency guard
        this.runMoneyMakerUltraLoop();

        this.checkStrategyTriggers();
    };

    @action
    updateDigitPowers = () => {
        const { check_ticks } = this.pro_tool_matches_settings;
        const slice = this.ticks.slice(-check_ticks);
        if (slice.length < 5) return;

        const currentCounts = new Array(10).fill(0);
        slice.forEach(d => currentCounts[d]++);

        const mid = Math.floor(slice.length / 2);
        const recentHalf = slice.slice(-mid);
        const olderHalf = slice.slice(0, mid);

        const recentCounts = new Array(10).fill(0);
        recentHalf.forEach(d => recentCounts[d]++);

        const olderCounts = new Array(10).fill(0);
        olderHalf.forEach(d => olderCounts[d]++);

        runInAction(() => {
            for (let i = 0; i < 10; i++) {
                // Power is the difference in frequency between recent and older half
                const score = recentCounts[i] - olderCounts[i];
                this.digit_power_scores[i] = score;

                // Track history for visualization
                if (!this.digit_power_history[i]) this.digit_power_history[i] = [];
                this.digit_power_history[i].push(currentCounts[i]);
                if (this.digit_power_history[i].length > 20) this.digit_power_history[i].shift();
            }
        });
    };

    @action
    updatePowerHistory = (current_stats: TSmartDigitStat[]) => {
        Object.values(this.strategies).forEach(strategy => {
            if (!strategy.is_running) return;

            const percentages = current_stats.map(s => s.percentage);
            const history = [...(strategy.power_history || [])];
            history.push(percentages);
            if (history.length > 5) history.shift();
            strategy.power_history = history;
        });
    };

    @action
    updateFirstDigitStats = (last_digits: number[]) => {
        const stats = Array.from({ length: 10 }, (_, i) => ({
            digit: i,
            count: 0,
            percentage: 0,
        }));

        last_digits.forEach(digit => {
            const firstDigit = (digit + 1) % 10;
            if (firstDigit > 0) stats[firstDigit].count++;
        });

        const total = last_digits.filter(d => (d + 1) % 10 > 0).length;
        if (total > 0) {
            stats.forEach(stat => {
                stat.percentage = (stat.count / total) * 100;
            });
        }
        this.first_digit_stats = stats;
    };

    @action
    calculateDominance = () => {
        let evenCount = 0;
        let oddCount = 0;
        this.digit_stats.forEach(s => {
            if (s.digit % 2 === 0) evenCount += s.count;
            else oddCount += s.count;
        });

        if (evenCount > oddCount + 5) this.dominance = 'EVEN';
        else if (oddCount > evenCount + 5) this.dominance = 'ODD';
        else this.dominance = 'NEUTRAL';
    };

    calculateProbabilities = () => {
        let even = 0;
        let odd = 0;
        let over = 0;
        let under = 0;
        let middle = 0;
        let total = 0;

        const counts = this.digit_stats.map(s => s.count);
        const maxCount = Math.max(...counts, 0);
        const minCount = Math.min(...counts, 1000000);

        this.digit_stats.forEach(stat => {
            total += stat.count;
            if (stat.digit % 2 === 0) even += stat.count;
            else odd += stat.count;

            if (stat.digit >= 5) over += stat.count;
            if (stat.digit <= 4) under += stat.count;
            if (stat.digit >= 3 && stat.digit <= 6) middle += stat.count;
        });

        const slice = this.ticks.slice(-50);
        let rises = 0;
        let falls = 0;
        for (let i = 1; i < slice.length; i++) {
            if (slice[i] > slice[i - 1]) rises++;
            else if (slice[i] < slice[i - 1]) falls++;
        }
        const trend_total = rises + falls || 1;

        const safeDiv = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

        return {
            even: safeDiv(even, total),
            odd: safeDiv(odd, total),
            over: safeDiv(over, total),
            under: safeDiv(under, total),
            middle: safeDiv(middle, total),
            matches: safeDiv(maxCount, total),
            differs: safeDiv(total - minCount, total),
            riseProb: (rises / trend_total) * 100,
            fallProb: (falls / trend_total) * 100,
            total,
        };
    };

    @action
    fetchMarkets = async () => {
        let symbols: any[] = [];
        try {
            if (api_base.api) {
                const response = await api_base.api.send({ active_symbols: 'brief', product_type: 'basic' });
                if (response.active_symbols && response.active_symbols.length > 0) {
                    symbols = response.active_symbols;
                }
            }
        } catch (error) {
            console.warn('[SmartTradingStore] API active_symbols fetch failed:', error);
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
                console.warn('[SmartTradingStore] ApiHelpers fetch failed:', e);
            }
        }

        if (!symbols || symbols.length === 0) {
            symbols = [
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: 'R_100',
                    display_name: 'Volatility 100 Index',
                    pip: 0.01,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: 'R_10',
                    display_name: 'Volatility 10 Index',
                    pip: 0.001,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: 'R_25',
                    display_name: 'Volatility 25 Index',
                    pip: 0.001,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: 'R_50',
                    display_name: 'Volatility 50 Index',
                    pip: 0.0001,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: 'R_75',
                    display_name: 'Volatility 75 Index',
                    pip: 0.0001,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: '1HZ100V',
                    display_name: 'Volatility 100 (1s) Index',
                    pip: 0.01,
                },
                {
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    symbol: '1HZ10V',
                    display_name: 'Volatility 10 (1s) Index',
                    pip: 0.001,
                },
            ];
        }

        runInAction(() => {
            const groups: Record<string, { group: string; items: { value: string; label: string }[] }> = {};
            const symbolData: Record<string, { pip: number; symbol: string; display_name: string }> = {};

            symbols.forEach((s: any) => {
                if (s.is_trading_suspended) return;
                const market_name = s.market_display_name || s.market || 'Synthetic Indices';
                if (!groups[market_name]) groups[market_name] = { group: market_name, items: [] };
                groups[market_name].items.push({ value: s.symbol, label: s.display_name });
                symbolData[s.symbol] = { pip: s.pip || 0.01, symbol: s.symbol, display_name: s.display_name };
            });
            this.markets = Object.values(groups).sort((a, b) => a.group.localeCompare(b.group));
            this.active_symbols_data = symbolData;
        });
    };

    @action
    setSymbol = (symbol: string) => {
        if (this.symbol !== symbol) {
            this.symbol = symbol;
            this.resetStats();
            this.root_store.analysis.setSymbol(symbol);
            this.root_store.auto_trader.setSymbol(symbol);
            // Re-subscribe to new symbol
            this.subscribeToActiveSymbol();
        }
    };

    private unsubscribeTicks: (() => void) | null = null;
    private active_stream_id: string | null = null;

    @action
    subscribeToActiveSymbol = async (retry_count = 0) => {
        // Clear existing subscription
        if (this.unsubscribeTicks) {
            this.unsubscribeTicks();
            this.unsubscribeTicks = null;
        }

        if (this.active_stream_id && api_base.api) {
            try {
                api_base.api.send({ forget: this.active_stream_id });
            } catch (e) {
                // Ignore forget errors
            }
            this.active_stream_id = null;
        }

        if (!this.symbol || !this.is_connected) return;

        try {
            if (!api_base.api) {
                throw new Error('API not initialized');
            }

            let response: any;
            try {
                response = await api_base.api.send({
                    ticks_history: this.symbol,
                    count: 1000,
                    end: 'latest',
                    style: 'ticks',
                    subscribe: 1,
                });
            } catch (err: any) {
                if (err.error?.code === 'AlreadySubscribed') {
                    // Fallback: fetch history without subscribing
                    response = await api_base.api.send({
                        ticks_history: this.symbol,
                        count: 1000,
                        end: 'latest',
                        style: 'ticks',
                    });
                } else {
                    throw err;
                }
            }

            if (response.subscription?.id) {
                this.active_stream_id = response.subscription.id;
            }

            if (response.error) {
                throw new Error(response.error.message);
            }

            // Handle initial history
            if (response.history || response.ticks_history) {
                const history = response.history || response.ticks_history;
                if (history.prices) {
                    const digits = history.prices.map((p: any) => {
                        const s = String(p);
                        return parseInt(s[s.length - 1]);
                    });
                    this.updateDigitStats(digits, history.prices[history.prices.length - 1]);
                }
            }

            // Setup real-time listener
            const subscription = api_base.api.onMessage().subscribe((msg: any) => {
                if (msg.msg_type === 'tick' && msg.tick && msg.tick.symbol === this.symbol) {
                    const quote = msg.tick.quote;
                    const price_str = String(quote);
                    const last_char = price_str[price_str.length - 1];
                    const digit = parseInt(last_char);

                    if (!isNaN(digit)) {
                        const new_ticks = [...this.ticks, digit].slice(-1000);
                        this.updateDigitStats(new_ticks, quote);
                    }
                }
            });

            this.unsubscribeTicks = () => subscription.unsubscribe();

            console.log(`[SmartTrading] Subscribed to ${this.symbol} via direct API`);
        } catch (error) {
            console.error('[SmartTrading] Tick subscription failed:', JSON.stringify(error, null, 2));
            if (retry_count < 3) {
                setTimeout(() => this.subscribeToActiveSymbol(retry_count + 1), 2000);
            }
        }
    };

    @action
    setSpeedbotContractType = action((type: string) => {
        this.speedbot_contract_type = type;
    });

    setSpeedbotPrediction = action((prediction: number) => {
        this.speedbot_prediction = prediction;
    });

    setSpeedbotStake = action((stake: number) => {
        this.speedbot_stake = stake;
    });

    setAlternateEvenOdd = action((value: boolean) => {
        this.alternate_even_odd = value;
    });

    setAlternateOnLoss = action((value: boolean) => {
        this.alternate_on_loss = value;
    });

    setRecoveryMode = action((value: boolean) => {
        this.recovery_mode = value;
    });

    @action
    setActiveSubtab = (tab: TSmartSubtab) => {
        // Modified existing method
        this.active_subtab = tab;
    };

    @action
    setProToolActiveSubtab = (tab: TProToolSubtab) => {
        this.pro_tool_active_subtab = tab;
    };

    @action
    setProToolMatchesSettings = (settings: Partial<typeof this.pro_tool_matches_settings>) => {
        this.pro_tool_matches_settings = { ...this.pro_tool_matches_settings, ...settings };
    };

    @action
    setProToolHedgingSettings = (settings: Partial<typeof this.pro_tool_hedging_settings>) => {
        this.pro_tool_hedging_settings = { ...this.pro_tool_hedging_settings, ...settings };
    };

    @action
    setProToolDiffersSettings = (settings: Partial<typeof this.pro_tool_differs_settings>) => {
        this.pro_tool_differs_settings = { ...this.pro_tool_differs_settings, ...settings };
    };

    @action
    setProToolHyperbotSettings = (settings: Partial<typeof this.pro_tool_hyperbot_settings>) => {
        this.pro_tool_hyperbot_settings = { ...this.pro_tool_hyperbot_settings, ...settings };
    };

    @action
    setProToolSpeedbotSettings = (settings: Partial<typeof this.pro_tool_speedbot_settings>) => {
        this.pro_tool_speedbot_settings = { ...this.pro_tool_speedbot_settings, ...settings };
    };

    @action
    toggleProTool = () => {
        this.is_pro_tool_running = !this.is_pro_tool_running;
        if (this.is_pro_tool_running) {
            this.addConsoleLog('Pro Tool Engine Activated', 'success');
        } else {
            this.addConsoleLog('Pro Tool Engine Deactivated', 'info');
        }
    };

    @action
    evaluateProToolConditions = () => {
        if (!this.is_pro_tool_running) return;

        if (this.pro_tool_active_subtab === 'matches') {
            this.evaluateMatchesProLogic();
        } else if (this.pro_tool_active_subtab === 'differs') {
            this.evaluateDiffersProLogic();
        } else if (this.pro_tool_active_subtab === 'hyperbot') {
            this.evaluateHyperbotProLogic();
        } else if (this.pro_tool_active_subtab === 'hedging') {
            this.evaluateHedgingProLogic();
        }
    };

    @action
    evaluateHedgingProLogic = () => {
        if (!this.is_pro_tool_running || this.is_executing) return;

        const probs = this.calculateProbabilities();
        const contractType = probs.over > probs.under ? 'DIGITOVER' : 'DIGITUNDER';
        const prediction = this.speedbot_prediction ?? (contractType === 'DIGITOVER' ? 4 : 5);

        const { bulk_purchase_count } = this.pro_tool_hedging_settings;

        const trades = Array(bulk_purchase_count).fill({ type: contractType, barrier: prediction });
        this.executeConcurrentTrades(trades);
    };

    @action
    evaluateMatchesProLogic = () => {
        const {
            predictions,
            is_power_increase_enabled,
            is_double_increase_enabled,
            threshold_enabled,
            threshold_settings,
            use_rank_matching,
        } = this.pro_tool_matches_settings;

        let targetDigits: number[] = [];

        if (use_rank_matching) {
            const sorted = [...this.digit_stats].sort((a, b) => b.count - a.count);
            targetDigits = [sorted[0].digit, sorted[1].digit, sorted[sorted.length - 1].digit];
        } else {
            targetDigits = predictions;
        }

        const validTrades: { type: string; barrier?: number }[] = [];

        targetDigits.forEach(digit => {
            let shouldTrade = true;

            // Condition 2: Power Increase
            if (is_power_increase_enabled && this.digit_power_scores[digit] <= 0) {
                shouldTrade = false;
            }

            // Condition 3: Double Increase (using history)
            if (is_double_increase_enabled) {
                const powerHistory = this.digit_power_history[digit] || [];
                if (powerHistory.length >= 2) {
                    const last = powerHistory[powerHistory.length - 1];
                    const prev = powerHistory[powerHistory.length - 2];
                    const pprev = powerHistory.length >= 3 ? powerHistory[powerHistory.length - 3] : prev;
                    if (!(last > prev && prev > pprev)) shouldTrade = false;
                } else {
                    shouldTrade = false;
                }
            }

            // Condition 4: Threshold
            if (threshold_enabled) {
                const { op, val, ticks: tCount } = threshold_settings;
                const slice = this.ticks.slice(-tCount);
                const count = slice.filter(d => d === digit).length;
                const pct = (count / (slice.length || 1)) * 100;

                if (op === '>' && !(pct > val)) shouldTrade = false;
                if (op === '<' && !(pct < val)) shouldTrade = false;
                if (op === '==' && !(Math.abs(pct - val) < 0.1)) shouldTrade = false;
            }

            if (shouldTrade) {
                validTrades.push({ type: 'DIGITMATCH', barrier: digit });
            }
        });

        if (validTrades.length > 0 && !this.is_executing) {
            this.executeConcurrentTrades(validTrades);
        }
    };

    @action
    executeConcurrentTrades = async (trades: { type: string; barrier?: number }[]) => {
        if (!this.root_store.common.is_socket_opened || trades.length === 0) return;

        this.is_executing = true;
        this.ticks_processed++;
        this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_SENT);

        try {
            if (!api_base.api) return;

            const executeSingle = async (trade: { type: string; barrier?: number }) => {
                const proposal_request = {
                    proposal: 1,
                    amount: this.current_stake,
                    basis: 'stake',
                    contract_type: trade.type,
                    currency: this.root_store.client.currency || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol: this.symbol,
                    ...(trade.barrier !== undefined && { barrier: trade.barrier }),
                };

                const transformedProposal = transformProposalRequest(proposal_request);
                const proposal_response = await api_base.api.send(transformedProposal);
                if (proposal_response.error || !proposal_response.proposal?.id) return;

                const buy_request = {
                    buy: proposal_response.proposal.id,
                    price: this.current_stake,
                };
                const transformedBuy = transformBuyRequest(buy_request);
                const buy_response = await api_base.api.send(transformedBuy);

                if (buy_response.error || !buy_response.buy?.contract_id) return;

                const poc_request = { proposal_open_contract: 1, contract_id: buy_response.buy.contract_id };
                const transformedPOC = transformProposalOpenContractRequest(poc_request);
                api_base.api.subscribe(
                    transformedPOC,
                    (response: any) => {
                        if (response.proposal_open_contract?.is_sold) {
                            const status = response.proposal_open_contract.status;
                            const profit = parseFloat(response.proposal_open_contract.profit || '0');

                            runInAction(() => {
                                if (status === 'won') {
                                    this.wins++;
                                    this.consecutive_losses = 0;
                                    if (
                                        this.pro_tool_active_subtab === 'matches' &&
                                        this.pro_tool_matches_settings.stop_on_win
                                    ) {
                                        this.is_pro_tool_running = false;
                                        this.addConsoleLog('Pro Tool: Goal reached. Engine Stopped.', 'success');
                                    }
                                } else {
                                    this.losses++;
                                    this.consecutive_losses++;
                                    if (
                                        this.pro_tool_active_subtab === 'hedging' &&
                                        this.pro_tool_hedging_settings.is_recovery_enabled
                                    ) {
                                        if (
                                            this.consecutive_losses >=
                                            this.pro_tool_hedging_settings.alternate_after_losses
                                        ) {
                                            const { recovery_chain } = this.pro_tool_hedging_settings;
                                            if (recovery_chain.length > 0) {
                                                const currentIndex = recovery_chain.indexOf(this.symbol);
                                                const nextIndex = (currentIndex + 1) % recovery_chain.length;
                                                this.symbol = recovery_chain[nextIndex];
                                                this.consecutive_losses = 0;
                                            }
                                        }
                                    }
                                }
                                this.session_pl += profit;
                            });
                        }
                    }
                );
            };

            await Promise.all(trades.map(t => executeSingle(t)));

            runInAction(() => {
                this.is_executing = false;
                this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
            });
        } catch (error) {
            console.error('Concurrent trade error:', error);
            runInAction(() => {
                this.is_executing = false;
            });
        }
    };

    @action
    evaluateDiffersProLogic = () => {
        const { min_gap, max_freq, safe_digit, auto_digit_select } = this.pro_tool_differs_settings;

        let target = safe_digit;
        if (auto_digit_select) {
            const predictor = new SmartPredictor(this.ticks);
            const freq = predictor.getHotCold().cold;
            if (freq.length > 0) target = freq[0].digit;
        }

        const slice = this.ticks.slice(-20);
        const lastSeen = slice.lastIndexOf(target);
        const gap = lastSeen === -1 ? slice.length : slice.length - 1 - lastSeen;
        const currentFreq = this.digit_stats[target]?.percentage || 0;

        if (gap >= min_gap && currentFreq <= max_freq) {
            this.executeProToolTrade('DIGITDIFF', target);
        }
    };

    @action
    evaluateHyperbotProLogic = () => {
        const { min_confidence } = this.pro_tool_hyperbot_settings;
        const predictor = new SmartPredictor(this.ticks);
        const signal = predictor.getTradingSignal();

        if (signal.action === 'BUY' && signal.confidence >= min_confidence) {
            this.executeProToolTrade('DIGITMATCH', signal.targetDigit);
        }
    };

    @action
    evaluateSpeedbotProLogic = () => {
        const { velocity_threshold } = this.pro_tool_speedbot_settings;
        const velocity = Math.abs(this.ultra_momentum_velocity); // Simplified reuse

        if (velocity >= velocity_threshold * 100) {
            const last = this.last_digit ?? 0;
            const type = last % 2 === 0 ? 'DIGITEVEN' : 'DIGITODD';
            this.executeProToolTrade(type, 0);
        }
    };

    @action
    executeProToolTrade = async (type: string, prediction: number) => {
        const count =
            this.pro_tool_active_subtab === 'hedging' ? this.pro_tool_hedging_settings.bulk_purchase_count : 1;

        for (let i = 0; i < count; i++) {
            await this.executeSpeedTrade(type, prediction);
        }

        if (this.pro_tool_matches_settings.stop_on_win && this.pro_tool_active_subtab === 'matches') {
            // Logic to stop will be handled in onContractResult
        }
    };

    @action
    resetStats = () => {
        runInAction(() => {
            this.digit_stats.forEach(s => {
                s.count = 0;
                s.percentage = 0;
            });
            this.ticks = [];
            this.last_digit = null;
            this.ticks_processed = 0;
            this.wins = 0;
            this.losses = 0;
            this.session_pl = 0;
            this.current_streak = 0;
            this.consecutive_losses = 0;
            this.current_stake = this.speedbot_stake;

            Object.values(this.strategies).forEach(s => {
                s.current_stake = s.stake;
                s.status = s.is_active ? 'waiting' : 'idle';
            });
        });
    };

    @action
    toggleSpeedbot = () => {
        this.is_speedbot_running = !this.is_speedbot_running;
        if (this.is_speedbot_running) {
            this.resetStats();
            this.root_store.run_panel.setIsRunning(true);
            this.root_store.run_panel.setContractStage(contract_stages.STARTING);
        } else {
            this.root_store.run_panel.setIsRunning(false);
            this.root_store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    @action
    executeSpeedTrade = async (custom_type?: string, custom_prediction?: number) => {
        if (!this.root_store.common.is_socket_opened || !this.is_speedbot_running || this.is_executing) return;

        if (!this.root_store.client.is_logged_in) {
            this.toggleSpeedbot();
            this.root_store.run_panel.showLoginDialog();
            return;
        }

        // Check TP/SL
        if (this.enable_tp_sl) {
            if (this.session_pl >= this.take_profit || this.session_pl <= -this.stop_loss) {
                this.toggleSpeedbot();
                return;
            }
        }

        // Check Max Consecutive Losses
        if (this.is_max_loss_enabled && this.consecutive_losses >= this.max_consecutive_losses) {
            this.toggleSpeedbot();
            return;
        }

        this.is_executing = true;
        this.ticks_processed++;
        this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_SENT);
        globalObserver.emit('contract.status', { id: 'contract.purchase_sent' });

        const contract_type = custom_type || this.speedbot_contract_type;
        const stake = this.current_stake;
        const symbol = this.symbol;
        const barrier = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contract_type)
            ? custom_prediction !== undefined
                ? custom_prediction
                : this.speedbot_prediction
            : undefined;

        try {
            if (!api_base.api) return;

            type TProposalRequest = {
                proposal: number;
                amount: number;
                basis: string;
                contract_type: string;
                currency: string;
                duration: number;
                duration_unit: string;
                symbol: string;
                barrier?: number;
            };

            const proposal_request: TProposalRequest = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol,
            };

            if (barrier !== undefined) {
                proposal_request.barrier = barrier;
            }

            const transformedProposal = transformProposalRequest(proposal_request);
            const proposal_response = await api_base.api.send(transformedProposal);

            if (proposal_response.error) {
                console.error('SmartTrading Speedbot Proposal Error:', proposal_response.error);
                this.is_executing = false;
                return;
            }

            const proposal_id = proposal_response.proposal?.id;
            if (!proposal_id) {
                this.is_executing = false;
                return;
            }

            const buy_request = {
                buy: proposal_id,
                price: stake,
            };
            const transformedBuy = transformBuyRequest(buy_request);
            const buy_response = await api_base.api.send(transformedBuy);

            if (buy_response.error) {
                console.error('SmartTrading Speedbot Buy Error:', buy_response.error);
                this.is_executing = false;
                return;
            }

            const contract_id = buy_response.buy?.contract_id;

            if (contract_id) {
                this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase_received',
                    buy: buy_response.buy,
                });

                // Track result
                const unsubscribe = api_base.api.subscribe(
                    {
                        proposal_open_contract: 1,
                        contract_id,
                    },
                    (response: TDerivResponse) => {
                        if (response.proposal_open_contract?.is_sold) {
                            const status = response.proposal_open_contract?.status;
                            const profit = parseFloat(response.proposal_open_contract?.profit || '0');

                            globalObserver.emit('bot.contract', response.proposal_open_contract);
                            globalObserver.emit('contract.status', {
                                id: 'contract.sold',
                                contract: response.proposal_open_contract,
                            });

                            runInAction(() => {
                                if (status === 'won') {
                                    this.wins++;
                                    this.consecutive_losses = 0;
                                    this.current_stake = this.speedbot_stake; // Reset stake
                                    if (this.current_streak < 0) this.current_streak = 1;
                                    else this.current_streak++;

                                    // Reset contract type if alternating on loss was enabled
                                    // (Actually, usually we keep alternating or reset based on user preference)
                                } else {
                                    this.losses++;
                                    this.consecutive_losses++;

                                    if (this.current_streak > 0) this.current_streak = -1;
                                    else this.current_streak--;

                                    // Martingale
                                    if (this.use_martingale) {
                                        this.current_stake = this.current_stake * this.martingale_multiplier;
                                        if (this.is_max_stake_enabled && this.current_stake > this.max_stake_limit) {
                                            this.current_stake = this.max_stake_limit;
                                        }
                                    }

                                    // Alternates
                                    if (this.alternate_on_loss || this.alternate_even_odd) {
                                        const alternates: Record<string, string> = {
                                            DIGITEVEN: 'DIGITODD',
                                            DIGITODD: 'DIGITEVEN',
                                            DIGITOVER: 'DIGITUNDER',
                                            DIGITUNDER: 'DIGITOVER',
                                            DIGITMATCH: 'DIGITDIFF',
                                            DIGITDIFF: 'DIGITMATCH',
                                        };

                                        if (alternates[this.speedbot_contract_type]) {
                                            // Specific Even/Odd check for alternate_even_odd toggle
                                            if (
                                                this.alternate_even_odd &&
                                                !['DIGITEVEN', 'DIGITODD'].includes(this.speedbot_contract_type)
                                            ) {
                                                // Do nothing or switch to even?
                                            } else {
                                                this.speedbot_contract_type = alternates[this.speedbot_contract_type];
                                            }
                                        }
                                    }
                                }

                                // Pro Tool Specific Post-Trade Logic
                                if (this.is_pro_tool_running) {
                                    if (
                                        status === 'won' &&
                                        this.pro_tool_active_subtab === 'matches' &&
                                        this.pro_tool_matches_settings.stop_on_win
                                    ) {
                                        this.toggleProTool();
                                        this.addConsoleLog('Pro Tool: Goal reached. Engine Stopped.', 'success');
                                    }

                                    if (
                                        status === 'lost' &&
                                        this.pro_tool_active_subtab === 'hedging' &&
                                        this.pro_tool_hedging_settings.is_recovery_enabled
                                    ) {
                                        if (
                                            this.consecutive_losses >=
                                            this.pro_tool_hedging_settings.alternate_after_losses
                                        ) {
                                            const { recovery_chain } = this.pro_tool_hedging_settings;
                                            if (recovery_chain.length > 0) {
                                                const currentMarket = this.symbol;
                                                const currentIndex = recovery_chain.indexOf(currentMarket);
                                                const nextIndex = (currentIndex + 1) % recovery_chain.length;
                                                this.symbol = recovery_chain[nextIndex];
                                                this.addConsoleLog(
                                                    `Pro Tool: Recovery triggered. Switched to ${this.symbol}`,
                                                    'info'
                                                );
                                                this.consecutive_losses = 0; // Reset for the new market
                                            }
                                        }
                                    }
                                }

                                this.session_pl += profit;
                                this.is_executing = false;
                            });

                            // Close subscription
                            if (unsubscribe && typeof unsubscribe === 'function') {
                                unsubscribe();
                            } else {
                                api_base.api.send({ forget: response.subscription?.id });
                            }
                        }
                    }
                );
            } else {
                this.is_executing = false;
            }
        } catch (error) {
            console.error('SmartTrading Speedbot execution error:', error);
            this.is_executing = false;
        }
    };

    @action
    executeBulkTrade = async () => {
        if (!this.root_store.common.is_socket_opened || this.is_bulk_trading) return;

        if (!this.root_store.client.is_logged_in) {
            this.root_store.run_panel.showLoginDialog();
            return;
        }

        runInAction(() => {
            this.is_bulk_trading = true;
            this.is_speedbot_running = true; // Visual feedback
        });

        const count = this.number_of_contracts;
        const promises = [];

        for (let i = 0; i < count; i++) {
            // Wait slightly between trades to avoid rate limiting or overlap issues if needed
            // But usually, user wants "speed", so we can fire them off almost simultaneously
            promises.push(this.executeSpeedTrade());
            // Small delay to ensure order in some contexts
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await Promise.all(promises);

        runInAction(() => {
            this.is_bulk_trading = false;
        });
    };

    @action
    toggleStrategy = (id: string) => {
        const strategy = this.strategies[id];
        if (!strategy) return;

        strategy.is_active = !strategy.is_active;
        if (!strategy.is_active) {
            strategy.status = 'idle';
            strategy.current_stake = strategy.stake;
        } else {
            strategy.status = 'waiting';
        }
    };

    @action
    checkStrategyTriggers = () => {
        // 1. Run Auto-Trading bots (independent states)
        Object.values(this.strategies).forEach(strategy => {
            if (strategy.is_running) {
                this.runStrategyLoop(strategy.id);
            }
        });

        // 2. Run Automated Trigger bots (only if tab is active)
        if (this.active_subtab === 'automated') {
            Object.values(this.strategies).forEach(strategy => {
                if (!strategy.is_active || strategy.status !== 'waiting' || strategy.is_running) return;

                let triggered = false;
                const probs = this.calculateProbabilities();

                switch (strategy.id) {
                    case 'even_odd_digits': {
                        const last_digits = this.ticks.slice(-(strategy.check_last_x || 5));
                        const target = strategy.target_pattern === 'Even' ? 0 : 1;
                        triggered =
                            last_digits.length === (strategy.check_last_x || 5) &&
                            last_digits.every(d => d % 2 === target);
                        break;
                    }
                    case 'even_odd_percentages': {
                        const val = strategy.target_side === 'Even' ? probs.even : probs.odd;
                        triggered = val >= strategy.threshold_pct!;
                        break;
                    }
                    case 'over_under_digits': {
                        const last_digits = this.ticks.slice(-(strategy.check_last_x || 3));
                        const is_greater = strategy.condition === 'Greater than';
                        triggered =
                            last_digits.length === (strategy.check_last_x || 3) &&
                            last_digits.every(d =>
                                is_greater ? d > strategy.threshold_val! : d < strategy.threshold_val!
                            );
                        break;
                    }
                    case 'over_under_percentages': {
                        const val = strategy.target_type === 'Over %' ? probs.over : probs.under;
                        triggered = val >= strategy.threshold_pct!;
                        break;
                    }
                    case 'rise_fall': {
                        const rise_pct =
                            (this.consecutive_even / (this.consecutive_even + this.consecutive_odd || 1)) * 100;
                        const val = strategy.target_side === 'Rise' ? rise_pct : 100 - rise_pct;
                        triggered = val >= strategy.threshold_pct!;
                        break;
                    }
                    case 'matches_differs': {
                        const digit_stat = this.digit_stats.find(s => s.digit === strategy.target_digit);
                        const val =
                            strategy.target_type === 'Matches %'
                                ? digit_stat?.percentage || 0
                                : 100 - (digit_stat?.percentage || 0);
                        triggered = val >= strategy.threshold_pct!;
                        break;
                    }
                }

                if (triggered) {
                    this.executeStrategyTrade(strategy.id);
                }
            });
        }
    };

    @action
    runStrategyLoop = async (strategy_id: string) => {
        const strategy = this.strategies[strategy_id];
        if (!strategy || strategy.status === 'trading' || !api_base.api || !strategy.is_running) return;

        if (!this.checkRiskLimits(strategy)) {
            runInAction(() => {
                strategy.is_running = false;
                strategy.status = 'idle';
            });
            return;
        }

        const signal = this.analyzeMarket(strategy_id);
        if (signal.action === 'TRADE') {
            await this.executeStrategyTrade(strategy_id, signal.contractType, signal.prediction);
        }
    };

    @action
    toggleBot = (strategy_id: string) => {
        const strategy = this.strategies[strategy_id];
        if (strategy) {
            strategy.is_running = !strategy.is_running;
            if (strategy.is_running) {
                strategy.status = 'waiting';
            } else {
                strategy.status = 'idle';
            }
        }
    };

    @action
    updateStrategySetting = (strategy_id: string, key: keyof TStrategy, value: any) => {
        const strategy = this.strategies[strategy_id];
        if (strategy) {
            (strategy as any)[key] = value;
        }
    };

    @action
    runSmartAuto24Loop = async () => {
        // This is legacy now, but keeping for compatibility if referenced elsewhere
        await this.runStrategyLoop(this.smart_auto24_strategy);
    };

    analyzeMarket = (strategy_id: string) => {
        const digits = this.ticks;
        const strategy = this.strategies[strategy_id];
        if (!strategy || !this.digit_stats) return { action: 'WAIT' };

        const sorted_stats = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
        const most_appearing = sorted_stats[0].digit;
        const second_most = sorted_stats[1].digit;
        const least_appearing = sorted_stats[sorted_stats.length - 1].digit;

        const getPowerTrend = (digit: number) => {
            const history = strategy.power_history || [];
            if (history.length < 2) return 'neutral';
            const current = history[history.length - 1][digit];
            const previous = history[history.length - 2][digit];
            if (current > previous) return 'increasing';
            if (current < previous) return 'decreasing';
            return 'neutral';
        };

        switch (strategy_id) {
            case 'EVENODD': {
                const is_even = (d: number) => d % 2 === 0;
                const most_is_even = is_even(most_appearing);
                const second_is_even = is_even(second_most);
                const least_is_even = is_even(least_appearing);

                const even_pct = this.digit_stats
                    .filter(s => is_even(s.digit))
                    .reduce((acc, s) => acc + s.percentage, 0);
                const odd_pct = 100 - even_pct;

                // Check for unstable market (decreasing power)
                const history = strategy.power_history || [];
                if (history.length >= 2) {
                    const current_dominant_pct = Math.max(even_pct, odd_pct);
                    const prev_even = history[history.length - 2]
                        .filter((_, i) => is_even(i))
                        .reduce((a, b) => a + b, 0);
                    const prev_odd = 100 - prev_even;
                    const prev_dominant_pct = Math.max(prev_even, prev_odd);

                    if (current_dominant_pct < prev_dominant_pct) {
                        strategy.is_unstable = true;
                        strategy.market_message = 'UNSTABLE MARKET - Power Decreasing';
                        return { action: 'WAIT' };
                    }
                }
                strategy.is_unstable = false;

                if (most_is_even && second_is_even && least_is_even && even_pct >= 55) {
                    strategy.market_message = `Strong EVEN market (${even_pct.toFixed(1)}%) - Waiting for entry...`;

                    // Entry: 2+ consecutive odd numbers, then top even appears and trend is rising
                    const last_two = digits.slice(-2);
                    const last_digit = digits[digits.length - 1];
                    if (last_two.every(d => !is_even(d)) && is_even(last_digit)) {
                        const entry_digit_power = getPowerTrend(last_digit);
                        const most_power = getPowerTrend(most_appearing);
                        const least_power = getPowerTrend(least_appearing);

                        if (
                            entry_digit_power === 'increasing' ||
                            most_power === 'increasing' ||
                            least_power === 'increasing'
                        ) {
                            return { action: 'TRADE', contractType: 'DIGITEVEN', confidence: even_pct };
                        }
                    }
                } else if (!most_is_even && !second_is_even && !least_is_even && odd_pct >= 55) {
                    strategy.market_message = `Strong ODD market (${odd_pct.toFixed(1)}%) - Waiting for entry...`;

                    const last_two = digits.slice(-2);
                    const last_digit = digits[digits.length - 1];
                    if (last_two.every(d => is_even(d)) && !is_even(last_digit)) {
                        const entry_digit_power = getPowerTrend(last_digit);
                        const most_power = getPowerTrend(most_appearing);
                        const least_power = getPowerTrend(least_appearing);

                        if (
                            entry_digit_power === 'increasing' ||
                            most_power === 'increasing' ||
                            least_power === 'increasing'
                        ) {
                            return { action: 'TRADE', contractType: 'DIGITODD', confidence: odd_pct };
                        }
                    }
                } else {
                    strategy.market_message = 'Neutral Market - Waiting for parity alignment';
                }
                return { action: 'WAIT' };
            }
            case 'OVER3UNDER6':
            case 'OVER2UNDER7': {
                const over_pct = this.digit_stats.filter(s => s.digit > 4).reduce((acc, s) => acc + s.percentage, 0);
                const under_pct = 100 - over_pct;

                const is_over = over_pct >= under_pct;
                const best_bias_pct = Math.max(over_pct, under_pct);

                // Track aggregate power trend
                const history = strategy.power_history || [];
                const prev_pct =
                    history.length >= 2
                        ? is_over
                            ? history[history.length - 2].slice(5).reduce((a, b) => a + b, 0)
                            : history[history.length - 2].slice(0, 5).reduce((a, b) => a + b, 0)
                        : best_bias_pct;

                const power_increasing = best_bias_pct > prev_pct;
                const power_decreasing = best_bias_pct < prev_pct;

                if (power_decreasing) {
                    strategy.is_unstable = true;
                    strategy.market_message = 'UNSTABLE MARKET - Power Decreasing';
                    return { action: 'WAIT' };
                }

                strategy.is_unstable = false;

                // Suggestions
                if (is_over) {
                    const sorted_over = [5, 6, 7, 8, 9].sort(
                        (a, b) => this.digit_stats[b].percentage - this.digit_stats[a].percentage
                    );
                    strategy.suggested_prediction = `OVER ${Math.min(sorted_over[0], sorted_over[1])}`;
                } else {
                    const sorted_under = [0, 1, 2, 3, 4].sort(
                        (a, b) => this.digit_stats[b].percentage - this.digit_stats[a].percentage
                    );
                    strategy.suggested_prediction = `UNDER ${Math.max(sorted_under[0], sorted_under[1])}`;
                }

                if (best_bias_pct >= 55 && power_increasing) {
                    // Entry point: use highest power digit in the range
                    const last_digit = digits[digits.length - 1];
                    let should_enter = false;

                    if (is_over) {
                        // Find highest power digit in over range (5-9)
                        const over_digits = this.digit_stats
                            .filter(s => s.digit > 4)
                            .sort((a, b) => b.percentage - a.percentage);
                        const highest_over_digit = over_digits[0]?.digit;
                        if (last_digit === highest_over_digit && getPowerTrend(highest_over_digit) === 'increasing') {
                            should_enter = true;
                        }
                    } else {
                        // Find highest power digit in under range (0-4)
                        const under_digits = this.digit_stats
                            .filter(s => s.digit <= 4)
                            .sort((a, b) => b.percentage - a.percentage);
                        const highest_under_digit = under_digits[0]?.digit;
                        if (last_digit === highest_under_digit && getPowerTrend(highest_under_digit) === 'increasing') {
                            should_enter = true;
                        }
                    }

                    if (should_enter) {
                        strategy.market_message = `TRADING ${is_over ? 'OVER' : 'UNDER'}...`;
                        return {
                            action: 'TRADE',
                            contractType: is_over ? 'DIGITOVER' : 'DIGITUNDER',
                            prediction: strategy.prediction || (is_over ? 4 : 5),
                            confidence: best_bias_pct,
                        };
                    } else {
                        strategy.market_message = `WAIT - Entry signal pending (${best_bias_pct.toFixed(1)}%)`;
                    }
                } else if (best_bias_pct > 52) {
                    strategy.market_message = `WAIT - Market warming up (${best_bias_pct.toFixed(1)}%)`;
                } else {
                    strategy.market_message = 'Analyzing market bias...';
                }

                return { action: 'WAIT' };
            }
            case 'DIFFERS': {
                // Check for unstable market (general power decrease)
                const history = strategy.power_history || [];
                if (history.length >= 2) {
                    const current_total = this.digit_stats.reduce((acc, s) => acc + Math.abs(s.percentage - 10), 0);
                    const prev_total = history[history.length - 2].reduce((acc, p) => acc + Math.abs(p - 10), 0);

                    if (current_total < prev_total) {
                        strategy.is_unstable = true;
                        strategy.market_message = 'UNSTABLE MARKET - Power Decreasing';
                        return { action: 'WAIT' };
                    }
                }
                strategy.is_unstable = false;

                // selected digit should NOT be most, 2nd most, or least.
                // digit to differ should be below 10% and decreasingly.
                const valid_digits = [2, 3, 4, 5, 6, 7].filter(
                    d => d !== most_appearing && d !== second_most && d !== least_appearing
                );

                const stats_2_7 = this.digit_stats.filter(s => valid_digits.includes(s.digit));
                const target = stats_2_7.find(s => s.percentage < 10 && getPowerTrend(s.digit) === 'decreasing');

                if (target) {
                    // Entry point: when least or most appearing digit appears
                    const last_digit = digits[digits.length - 1];
                    if (last_digit === most_appearing || last_digit === least_appearing) {
                        strategy.market_message = `TRADING DIFFERS ${target.digit}...`;
                        return { action: 'TRADE', contractType: 'DIGITDIFF', prediction: target.digit, confidence: 90 };
                    }
                    strategy.market_message = `Signal Lock: Digit ${target.digit} - Waiting for entry...`;
                } else {
                    strategy.market_message = 'Scanning for low-power digits (2-7)...';
                }
                return { action: 'WAIT' };
            }
            case 'MATCHES': {
                // MATCHES uses 1s markets ONLY
                if (strategy.ticks !== 1) {
                    strategy.market_message = 'MATCHES requires 1-tick duration';
                    return { action: 'WAIT' };
                }

                // Entry: highest or least or 2nd most digit increases in power
                const targets = [most_appearing, second_most, least_appearing];
                const increasing_target = targets.find(d => getPowerTrend(d) === 'increasing');

                if (increasing_target !== undefined) {
                    strategy.market_message = `TRADING MATCHES ${increasing_target}...`;
                    return {
                        action: 'TRADE',
                        contractType: 'DIGITMATCH',
                        prediction: increasing_target,
                        confidence: 20,
                    };
                }
                strategy.market_message = 'Waiting for power surge...';
                return { action: 'WAIT' };
            }
            default:
                return { action: 'WAIT' };
        }
    };

    checkRiskLimits = (strategy: TStrategy): boolean => {
        // Individual bot loss limit (Stop Loss)
        if (strategy.enable_tp_sl && strategy.profit_loss <= -strategy.stop_loss) return false;

        // Individual bot Take Profit
        if (strategy.enable_tp_sl && strategy.profit_loss >= strategy.take_profit) return false;

        // Individual bot Max Consecutive Losses
        if (strategy.is_max_loss_enabled && strategy.consecutive_losses >= strategy.max_consecutive_losses)
            return false;

        // Global Max Stake Limit (still useful as a safety)
        if (this.is_max_stake_enabled && strategy.current_stake > this.max_stake_limit) return false;

        // Global Session P/L (Safety fallback)
        if (this.session_pl <= -500) return false;

        return true;
    };

    @action
    executeStrategyTrade = async (id: string, override_type?: string, override_prediction?: number) => {
        const strategy = this.strategies[id];
        if (!strategy || strategy.status === 'trading' || !api_base.api) return;

        strategy.status = 'trading';
        const trade_type = override_type || strategy.trade_type;
        const prediction = override_prediction !== undefined ? override_prediction : strategy.prediction;

        this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_SENT);
        globalObserver.emit('contract.status', { id: 'contract.purchase_sent' });

        // Helper for timeouts
        const timeoutPromise = (ms: number, msg: string) =>
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

        try {
            // PROPOSAL Step with Timeout
            const proposal = await Promise.race([
                api_base.api.send({
                    proposal: 1,
                    amount: strategy.current_stake,
                    basis: 'stake',
                    contract_type: trade_type,
                    currency: this.root_store.client.currency || 'USD',
                    duration: strategy.ticks,
                    duration_unit: 't',
                    symbol: this.symbol,
                    ...(['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(trade_type || '') &&
                    prediction !== undefined
                        ? { barrier: String(prediction) }
                        : {}),
                }),
                timeoutPromise(10000, 'Proposal timed out'),
            ]);

            if (proposal.error) {
                console.warn('Strategy Proposal Error:', proposal.error.message);
                runInAction(() => {
                    strategy.status = 'waiting';
                });
                return;
            }

            // BUY Step with Timeout
            const buy = await Promise.race([
                api_base.api.send({
                    buy: proposal.proposal.id,
                    price: strategy.current_stake,
                }),
                timeoutPromise(10000, 'Buy timed out'),
            ]);

            if (buy.error) {
                console.warn('Strategy Buy Error:', buy.error.message);
                runInAction(() => {
                    strategy.status = 'waiting';
                });
                return;
            }

            const contract_id = buy.buy.contract_id;

            runInAction(() => {
                this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
            });
            globalObserver.emit('contract.status', {
                id: 'contract.purchase_received',
                buy: buy.buy,
            });

            // Subscription doesn't block the next tick loop directly, but let's ensure we catch errors
            const unsubscribe = api_base.api.subscribe(
                {
                    proposal_open_contract: 1,
                    contract_id,
                },
                (response: TDerivResponse) => {
                    if (response.proposal_open_contract?.is_sold) {
                        const status = response.proposal_open_contract?.status || 'lost';
                        const profit = parseFloat(response.proposal_open_contract?.profit || '0');

                        globalObserver.emit('bot.contract', response.proposal_open_contract);
                        globalObserver.emit('contract.status', {
                            id: 'contract.sold',
                            contract: response.proposal_open_contract,
                        });

                        runInAction(() => {
                            const trade_result = {
                                timestamp: Date.now(),
                                contractType: trade_type || 'Unknown',
                                stake: strategy.current_stake,
                                result: status.toUpperCase(),
                                profitLoss: profit,
                            };
                            this.trade_history.push(trade_result as TTradeHistory);

                            // Update global stats
                            if (status === 'won') {
                                this.wins++;
                                this.consecutive_losses = 0;
                            } else {
                                this.losses++;
                                this.consecutive_losses++;
                            }
                            this.session_pl += profit;
                            this.max_drawdown = Math.min(this.max_drawdown, this.session_pl);

                            // Update per-strategy stats
                            if (status === 'won') {
                                strategy.total_wins++;
                                strategy.consecutive_losses = 0;
                                strategy.current_stake = strategy.stake;
                            } else {
                                strategy.total_losses++;
                                strategy.consecutive_losses++;
                                strategy.current_stake *= strategy.martingale;
                            }
                            strategy.profit_loss += profit;
                            strategy.status = 'waiting';
                        });

                        if (unsubscribe && typeof unsubscribe === 'function') unsubscribe();
                    }
                }
            );
        } catch (error: any) {
            console.error('ExecuteStrategyTrade Timeout/Error:', error.message);
            runInAction(() => {
                strategy.status = 'waiting';
                // Optionally add a small delay before retry to avoid spamming a bad connection
            });
        }
    };
    @action
    manualTrade = async (contract_type: string, prediction?: number) => {
        if (!this.root_store.common.is_socket_opened || this.is_executing) return;

        if (!this.root_store.client.is_logged_in) {
            this.root_store.run_panel.showLoginDialog();
            return;
        }

        this.is_executing = true;
        this.root_store.run_panel.setIsRunning(true);
        this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_SENT);
        globalObserver.emit('contract.status', { id: 'contract.purchase_sent' });

        const stake = this.current_stake;
        const symbol = this.symbol;

        try {
            if (!api_base.api) {
                this.is_executing = false;
                this.root_store.run_panel.setIsRunning(false);
                return;
            }

            const proposal_request: any = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol,
            };

            if (prediction !== undefined) {
                proposal_request.barrier = String(prediction);
            }

            const transformedProposal = transformProposalRequest(proposal_request);
            const proposal_response = await api_base.api.send(transformedProposal);

            if (proposal_response.error) {
                console.error('SmartTrading Manual Proposal Error:', proposal_response.error);
                this.is_executing = false;
                this.root_store.run_panel.setIsRunning(false);
                return;
            }

            const proposal_id = proposal_response.proposal?.id;
            const buy_request = {
                buy: proposal_id,
                price: stake,
            };
            const transformedBuy = transformBuyRequest(buy_request);
            const buy_response = await api_base.api.send(transformedBuy);

            if (buy_response.error) {
                console.error('SmartTrading Manual Buy Error:', buy_response.error);
                this.is_executing = false;
                this.root_store.run_panel.setIsRunning(false);
                return;
            }

            const contract_id = buy_response.buy?.contract_id;
            if (contract_id) {
                this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
                globalObserver.emit('contract.status', {
                    id: 'contract.purchase_received',
                    buy: buy_response.buy,
                });

                const unsubscribe = api_base.api.subscribe(
                    { proposal_open_contract: 1, contract_id },
                    (response: TDerivResponse) => {
                        if (response.proposal_open_contract?.is_sold) {
                            const status = response.proposal_open_contract?.status;
                            const profit = parseFloat(response.proposal_open_contract?.profit || '0');

                            globalObserver.emit('bot.contract', response.proposal_open_contract);
                            globalObserver.emit('contract.status', {
                                id: 'contract.sold',
                                contract: response.proposal_open_contract,
                            });

                            runInAction(() => {
                                if (status === 'won') {
                                    this.wins++;
                                    this.consecutive_losses = 0;
                                    this.current_stake = this.speedbot_stake;
                                    this.current_streak = this.current_streak < 0 ? 1 : this.current_streak + 1;
                                } else {
                                    this.losses++;
                                    this.consecutive_losses++;
                                    this.current_streak = this.current_streak > 0 ? -1 : this.current_streak - 1;

                                    if (this.use_martingale) {
                                        this.current_stake = this.current_stake * this.martingale_multiplier;
                                        if (this.is_max_stake_enabled && this.current_stake > this.max_stake_limit) {
                                            this.current_stake = this.max_stake_limit;
                                        }
                                    }
                                }
                                this.session_pl += profit;
                                this.is_executing = false;
                            });

                            if (unsubscribe && typeof unsubscribe === 'function') {
                                unsubscribe();
                            } else {
                                api_base.api.send({ forget: response.subscription?.id });
                            }
                        }
                    }
                );
            } else {
                this.is_executing = false;
                this.root_store.run_panel.setIsRunning(false);
            }
        } catch (error) {
            console.error('SmartTrading Manual execution error:', error);
            this.is_executing = false;
            this.root_store.run_panel.setIsRunning(false);
        }
    };

    @action
    toggleTurboBot = () => {
        this.is_turbo_bot_running = !this.is_turbo_bot_running;
        if (this.is_turbo_bot_running) {
            this.turbo_bot_state = 'LISTENING';
            this.wins = 0;
            this.losses = 0;
            this.session_pl = 0;
        } else {
            this.turbo_bot_state = 'STOPPED';
        }
    };

    @action
    processTurboBot = () => {
        if (!this.is_turbo_bot_running || this.turbo_bot_state === 'STOPPED') return;

        if (this.turbo_bot_state === 'COOLDOWN') {
            this.turbo_cooldown_ticks--;
            if (this.turbo_cooldown_ticks <= 0) {
                this.turbo_bot_state = 'LISTENING';
            }
            return;
        }

        if (this.turbo_bot_state === 'LISTENING') {
            const valid_signals = this.v_sense_signals.filter(
                s => s.confidence >= this.turbo_settings.min_confidence && s.status === 'SAFE'
            );

            if (valid_signals.length > 0) {
                const best_signal = valid_signals.reduce((prev, current) =>
                    prev.confidence > current.confidence ? prev : current
                );

                this.executeTurboTrade(best_signal);
            }
        }
    };

    @action
    executeTurboTrade = async (signal: VSenseSignal) => {
        this.turbo_bot_state = 'SETUP';

        const balance = parseFloat(this.root_store.client.balance) || 1000;
        const risk_pct = signal.confidence >= 75 ? 0.05 : 0.02;
        let stake = balance * risk_pct;
        if (stake < 0.35) stake = 0.35;
        stake = Math.round(stake * 100) / 100;

        let bulk_size = 1;
        if (this.turbo_settings.is_bulk_enabled) {
            if (signal.strategy === 'DIFFERS' && signal.confidence >= 85) bulk_size = 3;
            else if (signal.strategy === 'DIFFERS') bulk_size = 2;
            else if (signal.confidence >= 80) bulk_size = 2;
        }

        this.turbo_bot_state = 'EXECUTING';
        this.turbo_last_signal = `${signal.strategy} @ ${signal.confidence}% [${signal.targetDigit || signal.targetSide}]`;

        const type = this.getTurboContractType(signal);
        const duration = signal.strategy === 'DIFFERS' ? 1 : 5;
        const prediction = signal.targetDigit;

        for (let i = 0; i < bulk_size; i++) {
            this.fireTurboContract(type, stake, duration, prediction);
        }

        this.turbo_bot_state = 'COOLDOWN';
        this.turbo_cooldown_ticks = signal.strategy === 'DIFFERS' ? 10 : 15;
    };

    getTurboContractType = (signal: VSenseSignal) => {
        switch (signal.strategy) {
            case 'DIFFERS':
                return 'DIGITDIFF';
            case 'EVEN_ODD':
                return signal.targetSide === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
            case 'OVER_UNDER':
                return signal.targetSide === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
            default:
                return 'DIGITDIFF';
        }
    };

    @action
    scanBestMarkets = async () => {
        if (!this.root_store.common.is_socket_opened || this.is_scanning || !api_base.api) return;

        this.is_scanning = true;
        this.scan_results = [];
        this.all_markets_stats = [];

        try {
            // Get all synthetic indices symbols
            const symbols = Object.values(this.active_symbols_data)
                .filter(s => s.symbol.startsWith('1HZ') || s.symbol.startsWith('R_') || s.symbol.startsWith('JD'))
                .map(s => s.symbol);

            const analysis_promises = symbols.map(async symbol => {
                try {
                    const response = await api_base.api.send({
                        ticks_history: symbol,
                        adjust_start_time: 1,
                        count: 100,
                        end: 'latest',
                        style: 'ticks',
                    });

                    if (response.error || !response.history?.prices) return null;

                    const prices = response.history.prices;
                    const current_price = prices[prices.length - 1];
                    const digits = prices.map((p: number | string) => {
                        const s = String(p);
                        return parseInt(s[s.length - 1]);
                    });

                    const last_digit = digits[digits.length - 1];

                    // Calculate digit frequency
                    const digit_counts = Array(10).fill(0);
                    digits.forEach((d: number) => digit_counts[d]++);
                    const digit_percentages = digit_counts.map(c => (c / digits.length) * 100);

                    // Even/Odd statistics
                    const evens = digits.filter((d: number) => d % 2 === 0).length;
                    const even_pct = (evens / digits.length) * 100;
                    const odd_pct = 100 - even_pct;

                    // Over/Under statistics
                    const over = digits.filter((d: number) => d > 4).length;
                    const over_pct = (over / digits.length) * 100;
                    const under_pct = 100 - over_pct;

                    // Top 3 digits for Matches
                    const sorted_indices = digit_counts
                        .map((count, digit) => ({ digit, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 3)
                        .map(item => item.digit);

                    // Valid Differs targets (2-7, <10%, excluding extremes)
                    const sorted_by_freq = digit_counts
                        .map((count, digit) => ({ digit, percentage: (count / digits.length) * 100 }))
                        .sort((a, b) => b.percentage - a.percentage);

                    const most_frequent = sorted_by_freq[0].digit;
                    const second_most = sorted_by_freq[1].digit;
                    const least_frequent = sorted_by_freq[sorted_by_freq.length - 1].digit;

                    const differs_targets = [2, 3, 4, 5, 6, 7].filter(
                        d =>
                            d !== most_frequent &&
                            d !== second_most &&
                            d !== least_frequent &&
                            digit_percentages[d] < 10
                    );

                    // Calculate overall market score
                    const ev_skew = Math.abs(even_pct - odd_pct);
                    const ou_skew = Math.abs(over_pct - under_pct);
                    const score = Math.max(ev_skew, ou_skew);
                    const reason =
                        ev_skew > ou_skew
                            ? `Strong ${even_pct > odd_pct ? 'Even' : 'Odd'} bias (${score.toFixed(1)}%)`
                            : `Strong ${over_pct > under_pct ? 'Over' : 'Under'} bias (${score.toFixed(1)}%)`;

                    return {
                        symbol,
                        price: String(current_price),
                        last_digit,
                        even_pct,
                        odd_pct,
                        over_pct,
                        under_pct,
                        top_matches: sorted_indices,
                        differs_targets,
                        timestamp: Date.now(),
                        score,
                        reason,
                    };
                } catch (e) {
                    return null;
                }
            });

            const results = (await Promise.all(analysis_promises)).filter(r => r !== null);
            results.sort((a, b) => (b?.score || 0) - (a?.score || 0));

            runInAction(() => {
                this.all_markets_stats = results as any[];
                this.scan_results = results.map(r => ({ symbol: r.symbol, score: r.score, reason: r.reason }));

                if (results.length > 0) {
                    this.best_market = results[0].symbol;
                    this.market_fit_score = Math.round(results[0].score);

                    // Automatically switch to the best market
                    this.setSymbol(results[0].symbol);
                }
                this.is_scanning = false;
            });
        } catch (error) {
            runInAction(() => {
                this.is_scanning = false;
            });
        }
    };

    @action
    fireTurboContract = async (type: string, stake: number, duration: number, prediction?: number) => {
        if (!api_base.api) return;

        try {
            const proposal = await api_base.api.send({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: type,
                currency: this.root_store.client.currency || 'USD',
                duration,
                duration_unit: 't',
                symbol: this.symbol,
                ...(prediction !== undefined ? { barrier: String(prediction) } : {}),
            });

            if (proposal.error) return;

            const buy = await api_base.api.send({
                buy: proposal.proposal.id,
                price: stake,
            });

            if (buy.error) return;

            const contract_id = buy.buy.contract_id;
            const unsubscribe = api_base.api.subscribe(
                { proposal_open_contract: 1, contract_id },
                (response: TDerivResponse) => {
                    if (response.proposal_open_contract?.is_sold) {
                        const is_win = response.proposal_open_contract.status === 'won';
                        const profit = parseFloat(response.proposal_open_contract.profit || '0');

                        runInAction(() => {
                            if (is_win) this.wins++;
                            else {
                                this.losses++;
                                if (this.is_turbo_bot_running) {
                                    this.is_turbo_bot_running = false;
                                    this.turbo_bot_state = 'STOPPED';
                                }
                            }
                            this.session_pl += profit;

                            this.trade_history.push({
                                timestamp: Date.now(),
                                contractType: type,
                                stake,
                                result: is_win ? 'WON' : 'LOST',
                                profitLoss: profit,
                            } as TTradeHistory);
                        });
                        if (unsubscribe && typeof unsubscribe === 'function') unsubscribe();
                    }
                }
            );
        } catch (error) {
            console.error('Turbo contract error:', error);
        }
    };

    // --- Money Maker Ultra Methods ---
    @action
    startMoneyMakerUltra = () => {
        if (this.ultra_circuit_breaker_active) {
            this.addUltraLog('Circuit breaker active. Cannot start.', 'error');
            return;
        }

        this.is_money_maker_ultra_running = true;
        this.ultra_session_trades = 0;
        this.ultra_heartbeat_count = 0;
        this.ultra_last_losses = [];
        this.ultra_start_balance = parseFloat(this.root_store.client.balance as string) || 0;
        this.addUltraLog('Money Maker Ultra INITIATED', 'success');

        // Start the loop logic
        this.runMoneyMakerUltraLoop();
    };

    @action
    stopMoneyMakerUltra = () => {
        this.is_money_maker_ultra_running = false;
        this.addUltraLog('Money Maker Ultra TERMINATED', 'info');
    };

    @action
    setUltraMomentumMode = (mode: 'shadow_scalper' | 'flash_overunder' | 'momentum_pulse') => {
        this.ultra_momentum_mode = mode;
        this.addUltraLog(`Strategy switched to: ${mode.toUpperCase().replace('_', ' ')}`, 'info');
    };

    @action
    addUltraLog = (message: string, type: 'info' | 'success' | 'error') => {
        const log = { timestamp: Date.now(), message, type };
        this.ultra_console_logs = [...this.ultra_console_logs.slice(-99), log];
    };

    @action
    calculateVolatilitySigma = (): number => {
        if (this.ticks.length < 20) return 0;

        const last20 = this.ticks.slice(-20);
        const changes: number[] = [];

        for (let i = 1; i < last20.length; i++) {
            changes.push(Math.abs(last20[i] - last20[i - 1]));
        }

        const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
        const variance = changes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / changes.length;

        return Math.sqrt(variance);
    };

    @action
    calculateAlphaScore = (): number => {
        let score = 0;
        const totalTrades = this.wins + this.losses;
        if (totalTrades > 0) {
            const winRate = this.wins / totalTrades;
            score += winRate * 40;
        }
        if (this.ticks.length >= 1000) score += 20;
        else if (this.ticks.length >= 100) score += 10;
        else if (this.ticks.length >= 20) score += 5;
        if (this.is_connected) score += 20;
        if (!this.ultra_circuit_breaker_active) score += 20;
        return Math.min(100, Math.max(0, score));
    };

    @action
    checkCircuitBreaker = () => {
        const now = Date.now();
        this.ultra_last_losses = this.ultra_last_losses.filter(t => now - t < 30000);

        if (this.ultra_last_losses.length >= 3) {
            this.ultra_circuit_breaker_active = true;
            this.ultra_circuit_breaker_until = now + 120000;
            this.is_money_maker_ultra_running = false;
            this.addUltraLog('CIRCUIT BREAKER TRIGGERED - Cooling down', 'error');

            setTimeout(() => {
                runInAction(() => {
                    this.ultra_circuit_breaker_active = false;
                    this.ultra_circuit_breaker_until = null;
                    this.addUltraLog('Circuit breaker RESET', 'success');
                });
            }, 120000);
        }
    };

    @action
    runMoneyMakerUltraLoop = async () => {
        if (!this.is_money_maker_ultra_running || this.is_ultra_loop_processing) return;

        this.is_ultra_loop_processing = true;

        try {
            runInAction(() => {
                this.ultra_heartbeat_count++;
                this.ultra_volatility_sigma = this.calculateVolatilitySigma();
                this.ultra_alpha_score = this.calculateAlphaScore();
                this.ultra_momentum_velocity = Math.min(100, (this.ultra_volatility_sigma || 0) * 50);
            });

            if (this.ticks.length >= 20) {
                const signal = await this.evaluateUltraStrategy();
                if (signal && this.is_money_maker_ultra_running) {
                    await this.executeUltraTrade(signal);
                }
            }
        } catch (error) {
            console.error('Ultra loop error:', error);
        } finally {
            runInAction(() => {
                this.is_ultra_loop_processing = false;
            });
        }
    };

    @action
    evaluateUltraStrategy = async (): Promise<{ type: string; prediction?: number } | null> => {
        if (!this.is_connected || this.ticks.length < 20) return null;

        switch (this.ultra_momentum_mode) {
            case 'shadow_scalper':
                return this.evaluateShadowScalper();
            case 'flash_overunder':
                return this.evaluateFlashOverUnder();
            case 'momentum_pulse':
                return this.evaluateMomentumPulse();
            default:
                return null;
        }
    };

    @action
    evaluateShadowScalper = (): { type: string; prediction?: number } | null => {
        const coldDigits = this.digit_stats.filter(d => d.percentage < 8).sort((a, b) => a.percentage - b.percentage);

        if (coldDigits.length === 0) return null;
        const coldestDigit = coldDigits[0].digit;

        if (this.ultra_volatility_sigma < 1.0) {
            this.addUltraLog(`Shadow Scalper: DIFFERS on ${coldestDigit}`, 'info');
            return { type: 'DIGITDIFF', prediction: coldestDigit };
        } else {
            const hotDigit = this.digit_stats.reduce((max, d) => (d.percentage > max.percentage ? d : max)).digit;
            this.addUltraLog(`Shadow Scalper: MATCHES on ${hotDigit}`, 'info');
            return { type: 'DIGITMATCH', prediction: hotDigit };
        }
    };

    @action
    evaluateFlashOverUnder = (): { type: string; prediction?: number } | null => {
        const last5 = this.ticks.slice(-5);
        if (last5.length < 5) return null;

        if (last5.every(d => d > 6)) {
            this.addUltraLog('Flash O/U: All >6 detect, OVER 5', 'info');
            return { type: 'DIGITOVER', prediction: 5 };
        } else if (last5.every(d => d < 3)) {
            this.addUltraLog('Flash O/U: All <3 detect, UNDER 4', 'info');
            return { type: 'DIGITUNDER', prediction: 4 };
        }
        return null;
    };

    @action
    evaluateMomentumPulse = (): { type: string; prediction?: number } | null => {
        if (this.ticks.length < 10) return null;
        const last = this.last_digit ?? 0;
        if (last % 2 === 0) {
            this.addUltraLog('Momentum Pulse: EVEN signal', 'info');
            return { type: 'DIGITEVEN' };
        } else {
            this.addUltraLog('Momentum Pulse: ODD signal', 'info');
            return { type: 'DIGITODD' };
        }
    };

    @action
    executeUltraTrade = async (trade: { type: string; prediction?: number }) => {
        if (this.ultra_circuit_breaker_active || !api_base.api) return;

        // Ping Guard
        const ping = this.root_store.common.latency;
        if (ping > 300) {
            this.addUltraLog(`High ping detected (${ping}ms) - Aborting trade`, 'error');
            return;
        }

        // Balance Safety (Circuit breaker if 20% drawdown)
        const currentBalance = parseFloat(this.root_store.client.balance as string) || 0;
        if (this.ultra_start_balance > 0 && currentBalance < this.ultra_start_balance * 0.8) {
            this.addUltraLog(
                `Emergency Stop: 20% drawdown reached (Start: ${this.ultra_start_balance}, Current: ${currentBalance})`,
                'error'
            );
            this.is_money_maker_ultra_running = false;
            return;
        }

        const stake = this.speedbot_stake || 0.35;
        this.ultra_session_trades++;
        this.addUltraLog(`Executing ${trade.type} signal...`, 'success');

        try {
            const proposal = await api_base.api.send({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: trade.type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: this.symbol,
                ...(trade.prediction !== undefined ? { barrier: String(trade.prediction) } : {}),
            });

            if (proposal.error) {
                this.addUltraLog(`Proposal error: ${proposal.error.message}`, 'error');
                return;
            }

            const buy = await api_base.api.send({
                buy: proposal.proposal.id,
                price: stake,
            });

            if (buy.error) {
                this.addUltraLog(`Buy error: ${buy.error.message}`, 'error');
                return;
            }

            this.addUltraLog(`Trade EXECUTED: ${buy.buy.contract_id}`, 'success');
        } catch (error) {
            this.addUltraLog(`Execution error: ${error}`, 'error');
        }
    };
    // --- SCP (Smart Crypto Predictor) Methods ---
    @action
    addScpLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const log = { timestamp: Date.now(), message, type };
        this.scp_analysis_log = [...this.scp_analysis_log.slice(-99), log];
    };

    @action
    addScpJournalEntry = (entry: any) => {
        this.scp_trading_journal = [entry, ...this.scp_trading_journal.slice(0, 999)];
        localStorage.setItem(
            `trading_journal_scp_${this.root_store.client.loginid}`,
            JSON.stringify(this.scp_trading_journal)
        );
    };

    @action
    setScpStatus = (status: typeof this.scp_status) => {
        this.scp_status = status;
    };

    @action
    updateScpProgress = (progress: number) => {
        this.scp_analysis_progress = progress;
    };

    @action
    runScpBot = async (config: {
        market: string;
        strategyId: string;
        stake: number;
        targetProfit: number;
        stopLossPct: number;
        analysisMinutes: number;
    }) => {
        if (this.scp_status !== 'idle') return;

        this.setScpStatus('analyzing');
        this.addScpLog(`Starting SCP Analysis on ${config.market}...`, 'info');
        this.scp_analysis_progress = 0;
        this.scp_start_balance = parseFloat(this.root_store.client.balance as string) || 0;

        // Total ticks to collect for analysis (e.g., 2 ticks per second)
        const total_ticks_needed = config.analysisMinutes * 60;
        let ticks_collected = 0;

        const analysisInterval = setInterval(() => {
            if (this.scp_status !== 'analyzing') {
                clearInterval(analysisInterval);
                return;
            }

            ticks_collected++;
            const progress = Math.min(100, Math.floor((ticks_collected / total_ticks_needed) * 100));
            this.updateScpProgress(progress);

            if (progress >= 100) {
                clearInterval(analysisInterval);
                this.setScpStatus('trading');
                this.addScpLog('Deep Analysis Complete. Market Pattern Identified.', 'success');
                this.addScpLog('Strategy Engaged: ' + config.strategyId, 'info');
                this.startScpTradingLoop(config);
            }
        }, 1000);
    };

    @action
    startScpTradingLoop = async (config: any) => {
        // This is a continuous observer loop that reacts to updateDigitStats
        const dispose = reaction(
            () => this.ticks.length,
            async () => {
                if (this.scp_status !== 'trading') {
                    dispose();
                    return;
                }

                // Stop Logic Checks
                if (this.session_pl >= config.targetProfit) {
                    this.addScpLog(`Target Profit of $${config.targetProfit} Reached! Stopping.`, 'success');
                    this.setScpStatus('completed');
                    dispose();
                    return;
                }

                const max_loss = this.scp_start_balance * (config.stopLossPct / 100);
                if (this.session_pl <= -max_loss) {
                    this.addScpLog(`Stop Loss Triggered (-$${max_loss.toFixed(2)}). Stopping.`, 'error');
                    this.setScpStatus('completed');
                    dispose();
                    return;
                }

                await this.evaluateScpStrategy(config);
            }
        );
    };

    @action
    evaluateScpStrategy = async (config: any) => {
        if (this.is_executing) return;

        const probs = this.calculateProbabilities();
        const sorted_stats = [...this.digit_stats].sort((a, b) => b.percentage - a.percentage);
        const most_appearing = sorted_stats[0].digit;
        const least_appearing = sorted_stats[sorted_stats.length - 1].digit;

        let should_trade = false;
        let contract_type = '';
        let prediction = 0;

        switch (config.strategyId) {
            case 'EVENODD': {
                const is_even_dominant = probs.even >= 55;
                const is_odd_dominant = probs.odd >= 55;

                // Check trend (increasing power)
                const history = this.strategies['EVENODD']?.power_history;
                const prev_even =
                    history && history.length > 0
                        ? history[history.length - 1]
                              .slice(0, 10)
                              .filter((_, i) => i % 2 === 0)
                              .reduce((a, b) => a + b, 0)
                        : 0;
                const prev_odd = history && history.length > 0 ? 100 - prev_even : 0;

                const is_even_increasing = probs.even >= prev_even;
                const is_odd_increasing = probs.odd >= prev_odd;

                if (is_even_dominant && is_even_increasing) {
                    // Entry: 2 consecutive odds then an even
                    const last_three = this.ticks.slice(-3);
                    if (
                        last_three.length === 3 &&
                        last_three[0] % 2 !== 0 &&
                        last_three[1] % 2 !== 0 &&
                        last_three[2] % 2 === 0
                    ) {
                        should_trade = true;
                        contract_type = 'DIGITEVEN';
                    }
                } else if (is_odd_dominant && is_odd_increasing) {
                    // Entry: 2 consecutive evens then an odd
                    const last_three = this.ticks.slice(-3);
                    if (
                        last_three.length === 3 &&
                        last_three[0] % 2 === 0 &&
                        last_three[1] % 2 === 0 &&
                        last_three[2] % 2 !== 0
                    ) {
                        should_trade = true;
                        contract_type = 'DIGITODD';
                    }
                }
                break;
            }
            case 'OU36':
            case 'OU27': {
                const side = probs.over > probs.under ? 'over' : 'under';
                const prob = side === 'over' ? probs.over : probs.under;

                // Wait/Unstable logic
                const history = this.strategies[config.strategyId]?.power_history;
                let prev_prob = 0;
                if (history && history.length > 0) {
                    const prev_stats = history[history.length - 1];
                    prev_prob =
                        side === 'over'
                            ? prev_stats.slice(5).reduce((a, b) => a + b, 0)
                            : prev_stats.slice(0, 5).reduce((a, b) => a + b, 0);
                }

                if (prob > 52 && prob < 55) {
                    this.addScpLog(`Waiting for strong ${side} trend (${prob.toFixed(1)}%)...`, 'info');
                    return;
                }

                if (prob > 55 && prob < prev_prob) {
                    this.addScpLog(`Market Unstable! ${side} strength decreasing.`, 'error');
                    return;
                }

                if (prob >= 55 && prob >= prev_prob) {
                    const last_digit = this.ticks[this.ticks.length - 1];
                    if (last_digit === most_appearing || last_digit === least_appearing) {
                        should_trade = true;
                        contract_type = side === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
                        prediction = config.strategyId === 'OU36' ? (side === 'over' ? 3 : 6) : side === 'over' ? 2 : 7;
                    }
                }
                break;
            }
            case 'DIFFERS': {
                // Logic per request: Digit 2-7, <10% power, decreasing power.
                const stats = this.digit_stats;
                const sorted = [...stats].sort((a, b) => b.count - a.count);
                const most = sorted[0];
                const least = sorted[sorted.length - 1];

                const candidates = stats.filter(
                    s => s.digit >= 2 && s.digit <= 7 && s.digit !== most.digit && s.digit !== least.digit
                );

                const candidate = candidates.find(c => {
                    if (c.percentage >= 10) return false;
                    const history = this.strategies['DIFFERS']?.power_history;
                    if (!history || history.length < 1) return true;
                    const prev_power = history[history.length - 1][c.digit];
                    return c.percentage < prev_power;
                });

                if (candidate) {
                    const last_digit = this.ticks[this.ticks.length - 1];
                    // Entry on extreme digits (most or least)
                    if (last_digit === most.digit || last_digit === least.digit) {
                        should_trade = true;
                        contract_type = 'DIGITDIFF';
                        prediction = candidate.digit;
                    }
                }
                break;
            }
        }

        if (should_trade) {
            this.addScpLog(`Executing ${contract_type} trade...`, 'info');
            await this.executeScpTrade(config, contract_type, prediction);
        }
    };

    @action
    executeScpTrade = async (config: any, contract_type: string, prediction?: number) => {
        if (this.is_executing) return;
        this.is_executing = true;

        try {
            this.addScpLog(`Sent: ${contract_type} | Stake: ${config.stake}`, 'info');

            const proposal = await api_base.api.send({
                proposal: 1,
                amount: config.stake,
                basis: 'stake',
                contract_type: contract_type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: config.market,
                ...(prediction !== undefined ? { barrier: String(prediction) } : {}),
            });

            if (proposal.error) {
                this.addScpLog(`Proposal error: ${proposal.error.message}`, 'error');
                this.is_executing = false;
                return;
            }

            const buy = await api_base.api.send({
                buy: proposal.proposal.id,
                price: config.stake,
                subscribe: 1, // Subscribe to get contract updates
            });

            if (buy.error) {
                this.addScpLog(`Buy error: ${buy.error.message}`, 'error');
                this.is_executing = false;
                return;
            }

            this.addScpLog(`Bought: ${buy.buy.contract_id}`, 'success');

            const contract_id = buy.buy.contract_id;

            const subscription = api_base.api.onMessage().subscribe((msg: any) => {
                if (
                    msg.msg_type === 'proposal_open_contract' &&
                    msg.proposal_open_contract.contract_id === contract_id
                ) {
                    const contract = msg.proposal_open_contract;
                    if (contract.is_sold) {
                        runInAction(() => {
                            const status = contract.status; // 'won' or 'lost'
                            const profit = parseFloat(contract.profit);
                            const is_win = status === 'won';

                            this.addScpLog(`Trade ${status.toUpperCase()}: ${profit}`, is_win ? 'success' : 'error');

                            this.addScpJournalEntry({
                                timestamp: Date.now(),
                                market: config.market,
                                strategy: config.strategyId,
                                stake: config.stake,
                                digit: parseInt(contract.current_spot_display_value.slice(-1)),
                                result: is_win ? 'WIN' : 'LOSS',
                                profit: profit,
                            });
                            this.session_pl += profit;
                            this.is_executing = false;
                            subscription.unsubscribe();
                        });
                    }
                }
            });

            // Safety timeout
            setTimeout(() => {
                runInAction(() => {
                    if (this.is_executing) {
                        this.addScpLog('Trade tracking timeout', 'info');
                        this.is_executing = false;
                        subscription.unsubscribe();
                    }
                });
            }, 15000);
        } catch (error) {
            this.addScpLog(`Scp Execution Error: ${error}`, 'error');
            this.is_executing = false;
        }
    };

    // ============ BULK TRADING METHODS ============
    @action
    executeBulkTradesOnce = async () => {
        if (!this.root_store.client.is_logged_in) {
            this.root_store.run_panel.showLoginDialog();
            return;
        }

        this.root_store.run_panel.setIsRunning(true);
        this.root_store.run_panel.setContractStage(contract_stages.STARTING);

        const trades = [];
        for (let i = 0; i < this.bulk_count_per_run; i++) {
            trades.push(this.executeSingleBulkTrade());
        }

        await Promise.all(trades);

        this.root_store.run_panel.setIsRunning(false);
        this.root_store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
    };

    @action
    toggleBulkAutoRun = () => {
        this.is_bulk_auto_running = !this.is_bulk_auto_running;

        if (this.is_bulk_auto_running) {
            this.root_store.run_panel.setIsRunning(true);
            this.root_store.run_panel.setContractStage(contract_stages.STARTING);
            this.runBulkAutoLoop();
        } else {
            this.root_store.run_panel.setIsRunning(false);
            this.root_store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    @action
    runBulkAutoLoop = async () => {
        while (this.is_bulk_auto_running) {
            if (!this.root_store.client.is_logged_in) {
                this.is_bulk_auto_running = false;
                break;
            }

            if (this.enable_tp_sl) {
                if (this.session_pl >= this.take_profit || this.session_pl <= -this.stop_loss) {
                    this.is_bulk_auto_running = false;
                    break;
                }
            }

            const trades = [];
            for (let i = 0; i < this.bulk_count_per_run; i++) {
                trades.push(this.executeSingleBulkTrade());
            }

            await Promise.all(trades);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.root_store.run_panel.setIsRunning(false);
        this.root_store.run_panel.setContractStage(contract_stages.NOT_RUNNING);
    };

    @action
    executeSingleBulkTrade = async () => {
        try {
            this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            const barrier = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(this.bulk_contract_type)
                ? this.bulk_prediction
                : undefined;

            const proposal = await api_base.api.send({
                proposal: 1,
                amount: this.bulk_stake,
                basis: 'stake',
                contract_type: this.bulk_contract_type,
                currency: this.root_store.client.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: this.bulk_market,
                ...(barrier !== undefined ? { barrier } : {}),
            });

            if (proposal.error) {
                console.error('Bulk Trade Error:', proposal.error);
                return;
            }

            const buy = await api_base.api.send({
                buy: proposal.proposal.id,
                price: this.bulk_stake,
            });

            if (buy.error) {
                console.error('Bulk Buy Error:', buy.error);
                return;
            }

            this.root_store.run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);
            globalObserver.emit('contract.status', { id: 'contract.purchase_received', buy: (buy as any).buy });

            const contract_id = (buy as any).buy?.contract_id;
            if (contract_id) {
                const unsubscribe = api_base.api.subscribe(
                    { proposal_open_contract: 1, contract_id },
                    (response: any) => {
                        if (response.proposal_open_contract?.is_sold) {
                            const profit = parseFloat(response.proposal_open_contract?.profit || '0');
                            const is_win = response.proposal_open_contract.status === 'won';

                            globalObserver.emit('bot.contract', response.proposal_open_contract);
                            globalObserver.emit('contract.sold', { contract: response.proposal_open_contract });

                            runInAction(() => {
                                if (is_win) this.wins++;
                                else this.losses++;
                                this.session_pl += profit;
                            });

                            if (unsubscribe && typeof unsubscribe === 'function') unsubscribe();
                        }
                    }
                );
            }
        } catch (error) {
            console.error('Bulk trade error:', error);
        }
    };

    addConsoleLog = (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
        console.log(`[SmartTrading] [${type.toUpperCase()}] ${msg}`);
        globalObserver.emit('ui.log.info', msg);
    };

    addLog = (msg: string) => this.addConsoleLog(msg, 'info');

    @action
    executeManualTrade = async ({
        contract_type,
        symbol,
        stake,
        barrier,
    }: {
        contract_type: string;
        symbol: string;
        stake: number;
        barrier?: number;
    }) => {
        if (!this.root_store.common.is_socket_opened) return;

        if (!this.root_store.client.is_logged_in) {
            this.root_store.run_panel.showLoginDialog();
            return;
        }

        const executeSingle = async (current_stake: number) => {
            try {
                if (!api_base.api) return;

                const proposal_request = {
                    proposal: 1,
                    amount: current_stake,
                    basis: 'stake',
                    contract_type,
                    currency: this.root_store.client.currency || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol,
                    ...(barrier !== undefined ? { barrier: String(barrier) } : {}),
                };

                const transformedProposal = transformProposalRequest(proposal_request);
                const response = await api_base.api.send(transformedProposal);
                if (response.error) {
                    globalObserver.emit('ui.log.error', response.error.message);
                    return;
                }

                const buy_request = {
                    buy: response.proposal.id,
                    price: current_stake,
                    subscribe: 1,
                };
                const transformedBuy = transformBuyRequest(buy_request);
                const buy_response = await api_base.api.send(transformedBuy);

                if (buy_response.error) {
                    globalObserver.emit('ui.log.error', buy_response.error.message);
                    return;
                }

                this.addLog(`Trade executed: ${contract_type} on ${symbol}`);

                const contract_id = buy_response.buy.contract_id;
                const subscription = api_base.api.onMessage().subscribe((msg: any) => {
                    if (
                        msg.msg_type === 'proposal_open_contract' &&
                        msg.proposal_open_contract.contract_id === contract_id
                    ) {
                        const contract = msg.proposal_open_contract;
                        if (contract.is_sold) {
                            runInAction(() => {
                                const status = contract.status;
                                const profit = parseFloat(contract.profit);
                                const is_win = status === 'won';

                                if (is_win) {
                                    this.wins++;
                                    this.consecutive_losses = 0;
                                    if (this.signals_settings.use_compounding) {
                                        this.speedbot_stake *= this.signals_settings.compounding_multiplier;
                                    }
                                } else {
                                    this.losses++;
                                    this.consecutive_losses++;
                                    if (this.signals_settings.use_compounding) {
                                        this.speedbot_stake = 0.5; // Reset or handle loss compounding
                                    }

                                    // Alternate market switching
                                    if (
                                        this.signals_settings.use_alternate_market &&
                                        this.consecutive_losses >= this.signals_settings.alternate_after_losses
                                    ) {
                                        this.symbol = this.signals_settings.alternate_market;
                                        this.addConsoleLog(`Switched to alternate market: ${this.symbol}`, 'warning');
                                    }
                                }

                                this.session_pl += profit;
                                this.manual_trade_history.unshift({
                                    timestamp: Date.now(),
                                    contractType: contract_type,
                                    stake: current_stake,
                                    result: is_win ? 'WON' : 'LOST',
                                    profitLoss: profit,
                                });

                                if (this.manual_trade_history.length > 50) {
                                    this.manual_trade_history.pop();
                                }

                                subscription.unsubscribe();
                            });
                        }
                    }
                });
            } catch (error) {
                console.error('Manual trade error:', error);
            }
        };

        const count = this.signals_settings.bulk_count || 1;
        for (let i = 0; i < count; i++) {
            await executeSingle(stake);
            if (i < count - 1) {
                await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between bulk trades
            }
        }
    };

    @action
    stopAll = () => {
        this.is_bulk_auto_running = false;
        this.is_money_maker_ultra_running = false;
        this.scp_status = 'idle';
        this.is_executing = false;
        this.addConsoleLog('ALL SYSTEMS STOPPED', 'warning');
    };
}
