import { action, makeObservable, observable, runInAction, computed } from 'mobx';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import RootStore from './root-store';
import { transformRequest, transformResponse } from '@/utils/api-migration-adapter';

export type TPrediction = 'UNDER' | 'OVER' | 'CURRENT' | 'WAIT';
export type TConfidenceLevel = 'VERY HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TDigitStrength = 'VERY STRONG' | 'STRONG' | 'MODERATE' | 'WEAK';

export interface OverUnderAnalysis {
    underPercent: number;
    overPercent: number;
    currentPercent: number;
    underCount: number;
    overCount: number;
    currentCount: number;
    volatility: number;
    changeRate: number;
    marketPower: number;
}

export interface DigitPower {
    frequency: number;
    momentum: number;
    gap: number;
    powerScore: number;
    strength: TDigitStrength;
}

export interface Streak {
    type: 'UNDER' | 'OVER' | 'CURRENT';
    length: number;
}

export default class OverUnderStore {
    root_store: RootStore;

    @observable accessor recent_digits: number[] = [];
    @observable accessor selected_digit: number = 5;
    @observable accessor symbol = 'R_100';
    @observable accessor current_price: string = '0.0000';
    @observable accessor is_connected = false;
    @observable accessor active_symbols: { symbol: string; display_name: string }[] = [];
    @observable accessor confirmed_ticks: number = 0;
    @observable accessor phase: 1 | 2 = 1;
    @observable accessor phase2_ticks: number = 0;
    @observable accessor last_confidence: number = 0;
    private _tick_sub: any = null;

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;
        this.init();
    }

    @action
    private init() {
        this.waitForApiAndConnect();
    }

    private isApiReady(): boolean {
        return !!(api_base.api && api_base.api.connection && api_base.api.connection.readyState === 1);
    }

    @action
    private waitForApiAndConnect = () => {
        let attempts = 0;
        const tryConnect = () => {
            attempts++;
            if (this.isApiReady()) {
                runInAction(() => this.is_connected = true);
                this.fetchActiveSymbols();
                this.subscribeToTicks();
            } else if (attempts < 30) {
                setTimeout(tryConnect, 1000);
            } else {
                console.warn('[OverUnderStore] API not ready after 30 attempts, will retry on next symbol change');
            }
        };
        tryConnect();
    };

    @action
    private fetchActiveSymbols() {
        if (!this.isApiReady()) return;
        const req = transformRequest({ active_symbols: 'brief', product_type: 'basic' }, 'active_symbols');
        api_base.api!.send(req).then((res: any) => {
            const transformed = transformResponse(res, 'active_symbols');
            if (transformed?.active_symbols) {
                const filtered = transformed.active_symbols
                    .filter((s: any) => s.market === 'synthetic_index' && s.submarket === 'random_index')
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                runInAction(() => {
                    this.active_symbols = filtered;
                });
            }
        }).catch((e: any) => console.warn('[OverUnderStore] fetchActiveSymbols error:', e));
    }

    @action
    private async subscribeToTicks() {
        if (!this.isApiReady()) {
            // API not ready yet — wait and retry
            setTimeout(() => this.subscribeToTicks(), 2000);
            return;
        }

        // Unsubscribe from previous if exists
        if (this._tick_sub) {
            try { this._tick_sub.unsubscribe(); } catch(e) { /* ignore */ }
            this._tick_sub = null;
        }

        const doSubscribe = async () => {
            if (!api_base.api) return;

            // Start real-time stream via centralized subscription manager
            const subscribeCallback = (data: any) => {
                const transformed = data; // api_base already transforms
                if (transformed?.error) {
                    if (transformed.error.code === 'AlreadySubscribed') return;
                    console.error('[OverUnderStore] Error:', transformed.error.message);
                    return;
                }

                if (transformed.msg_type === 'tick') {
                    if (transformed?.tick?.symbol === this.symbol) {
                        const tick = transformed.tick;
                        const quote = tick.quote.toString();
                        const digit = parseInt(quote.slice(-1));

                        runInAction(() => {
                            this.current_price = tick.quote.toFixed(tick.pip_size || 2);
                            this.recent_digits = [...this.recent_digits, digit].slice(-100);
                            this.confirmed_ticks++;

                            if (this.phase === 2) {
                                this.phase2_ticks++;
                                if (this.phase2_ticks >= 20) {
                                    this.phase = 1;
                                    this.phase2_ticks = 0;
                                }
                            } else if (this.analysis.marketPower >= 53) {
                                this.phase = 2;
                                this.phase2_ticks = 0;
                            }
                            this.last_confidence = this.confidence.maxPercent;
                        });
                    }
                }

                if (transformed.msg_type === 'history' && transformed.echo_req?.ticks_history === this.symbol) {
                    const digits = (transformed.history?.prices || []).map((p: any) => parseInt(p.toString().slice(-1)));
                    const lastPrice = transformed.history?.prices?.[transformed.history.prices.length - 1];
                    runInAction(() => {
                        this.recent_digits = digits;
                        if (lastPrice != null) this.current_price = lastPrice.toFixed(4);
                    });
                }
            };

            try {
                const subId = await api_base.subscribeTo({ ticks: this.symbol }, subscribeCallback as any);
                if (subId) {
                    this._tick_sub = { unsubscribe: () => api_base.unsubscribeById(subId) };
                }
            } catch (e) {
                console.warn('[OverUnderStore] ticks subscribe error:', e);
            }

            // Initial historical data
            const ticksHistoryReq = transformRequest({
                ticks_history: this.symbol,
                count: 100,
                end: 'latest',
                style: 'ticks',
            }, 'ticks_history');
            api_base.api.send(ticksHistoryReq).catch((e: any) =>
                console.warn('[OverUnderStore] ticks_history error:', e)
            );

            // Auto-retry: if no data arrives within 8 seconds, re-subscribe
            setTimeout(() => {
                if (this.recent_digits.length < 5 && this.isApiReady()) {
                    console.warn('[OverUnderStore] No ticks received, retrying subscription...');
                    this.subscribeToTicks();
                }
            }, 8000);
        };

        // Try forget_all first, but don't let it block if it fails
        api_base.api!.send(transformRequest({ forget_all: 'ticks' }, 'forget_all'))
            .then(() => doSubscribe())
            .catch(() => {
                console.warn('[OverUnderStore] forget_all failed, subscribing anyway');
                doSubscribe();
            });
    }

    @computed
    get analysis(): OverUnderAnalysis {
        const digits = this.recent_digits;
        const total = digits.length || 1;
        const threshold = 5; // Fixed for 0-4 vs 5-9

        const underDigits = digits.filter(d => d < threshold);
        const overDigits = digits.filter(d => d >= threshold);

        // Volatility: Avg difference between consecutive digits
        let totalDiff = 0;
        for (let i = 1; i < digits.length; i++) {
            totalDiff += Math.abs(digits[i] - digits[i-1]);
        }
        const volatility = digits.length > 1 ? totalDiff / (digits.length - 1) : 0;

        // Change Rate: % of times the type changed
        let changes = 0;
        for (let i = 1; i < digits.length; i++) {
            const prevType = digits[i-1] < threshold ? 'U' : 'O';
            const currType = digits[i] < threshold ? 'U' : 'O';
            if (prevType !== currType) changes++;
        }
        const changeRate = digits.length > 1 ? (changes / (digits.length - 1)) * 100 : 0;

        const marketPower = Math.max(underDigits.length, overDigits.length) / total * 100;

        return {
            underPercent: (underDigits.length / total) * 100,
            overPercent: (overDigits.length / total) * 100,
            currentPercent: 0, // Not used in this mode
            underCount: underDigits.length,
            overCount: overDigits.length,
            currentCount: 0,
            volatility,
            changeRate,
            marketPower
        };
    }

    @computed
    get digit_powers(): DigitPower[] {
        return Array.from({ length: 10 }, (_, i) => this.calculateDigitPower(i));
    }

    @computed
    get selected_digit_power(): DigitPower {
        return this.calculateDigitPower(this.selected_digit);
    }

    @computed
    get prediction() {
        const analysis = this.analysis;
        const conf = this.confidence;

        // Multi-Phase Signal Logic
        const isIncreasing = conf.maxPercent > this.last_confidence;
        
        let signal: TPrediction = 'WAIT';
        let reason = 'Market is currently balanced. Awaiting statistical divergence.';

        if (this.phase === 2 && conf.maxPercent >= 56 && isIncreasing) {
            signal = analysis.underPercent > analysis.overPercent ? 'UNDER' : 'OVER';
            reason = `${signal} signal confirmed via Phase 2 (${conf.maxPercent.toFixed(1)}% confidence).`;
        } else if (this.phase === 2) {
            reason = `Phase 2 in progress: ${this.phase2_ticks}/15 ticks. Confidence: ${conf.maxPercent.toFixed(1)}%`;
        } else if (analysis.marketPower >= 53) {
            reason = 'Initial conditions met. Entering Phase 2 validation...';
        }

        // Store last confidence for trend tracking (side-effect in getter is usually bad, 
        // but MobX handles computed dependencies; however, it's better to update last_confidence in the tick observer)
        
        return {
            prediction: signal,
            confidence: conf.level,
            reasoning: reason
        };
    }

    @computed
    get confidence() {
        const analysis = this.analysis;
        const maxPercent = Math.max(analysis.underPercent, analysis.overPercent);
        const difference = Math.abs(analysis.underPercent - analysis.overPercent);

        let level: TConfidenceLevel = 'LOW';
        if (maxPercent >= 65) level = 'VERY HIGH';
        else if (maxPercent >= 60) level = 'HIGH';
        else if (maxPercent >= 55 || difference >= 20) level = 'MEDIUM';

        return { level, maxPercent, difference };
    }

    @computed
    get streaks(): Streak[] {
        const digits = this.recent_digits;
        const threshold = this.selected_digit;
        if (digits.length === 0) return [];

        const streaks: Streak[] = [];
        let currentLength = 1;
        let currentType: 'UNDER' | 'OVER' | 'CURRENT' = 
            digits[0] < threshold ? 'UNDER' : digits[0] > threshold ? 'OVER' : 'CURRENT';

        for (let i = 1; i < digits.length; i++) {
            const type: 'UNDER' | 'OVER' | 'CURRENT' = 
                digits[i] < threshold ? 'UNDER' : digits[i] > threshold ? 'OVER' : 'CURRENT';
            
            if (type === currentType) {
                currentLength++;
            } else {
                if (currentLength >= 3) {
                    streaks.push({ type: currentType, length: currentLength });
                }
                currentType = type;
                currentLength = 1;
            }
        }
        if (currentLength >= 3) streaks.push({ type: currentType, length: currentLength });
        return streaks.reverse(); // Latest streaks first
    }

    @computed
    get digit_distribution(): { digit: number; count: number; percent: number }[] {
        const digits = this.recent_digits;
        const total = digits.length || 1;
        return Array.from({ length: 10 }, (_, i) => {
            const count = digits.filter(d => d === i).length;
            return { digit: i, count, percent: (count / total) * 100 };
        });
    }

    @computed
    get selected_digit_analysis() {
        const digits = this.recent_digits;
        const total = digits.length || 1;
        const target = this.selected_digit;

        const under = digits.filter(d => d < target);
        const over = digits.filter(d => d > target);
        const current = digits.filter(d => d === target);

        return {
            underPercent: (under.length / total) * 100,
            overPercent: (over.length / total) * 100,
            currentPercent: (current.length / total) * 100,
            underCount: under.length,
            overCount: over.length,
            currentCount: current.length
        };
    }

    @computed
    get group_stats() {
        const dist = this.digit_distribution;
        const under = dist.slice(0, 5);
        const over = dist.slice(5, 10);

        const highestUnder = [...under].sort((a, b) => (b.count || 0) - (a.count || 0))[0] || { digit: 0, count: 0, percent: 0 };
        const highestOver = [...over].sort((a, b) => (b.count || 0) - (a.count || 0))[0] || { digit: 9, count: 0, percent: 0 };

        return {
            highestUnder,
            highestOver
        };
    }

    private calculateDigitPower(digit: number): DigitPower {
        const digits = this.recent_digits;
        if (digits.length === 0) return { frequency: 0, momentum: 0, gap: 0, powerScore: 0, strength: 'WEAK' };

        const frequency = (digits.filter(d => d === digit).length / digits.length) * 100;
        
        const recent = digits.slice(-25);
        const momentum = (recent.filter(d => d === digit).length / (recent.length || 1)) * 100;
        
        const lastIndex = digits.lastIndexOf(digit);
        const gap = lastIndex === -1 ? digits.length : digits.length - lastIndex - 1;
        
        const powerScore = (frequency * 0.5) + (momentum * 0.4) - (gap * 0.1);
        
        let strength: TDigitStrength = 'WEAK';
        if (powerScore >= 15) strength = 'VERY STRONG';
        else if (powerScore >= 10) strength = 'STRONG';
        else if (powerScore >= 5) strength = 'MODERATE';

        return { frequency, momentum, gap, powerScore, strength };
    }

    @action
    setSelectedDigit(digit: number) {
        this.selected_digit = digit;
    }

    @action
    setSymbol(sym: string) {
        // Unsubscribe from previous
        if (this._tick_sub) {
            this._tick_sub.unsubscribe();
            this._tick_sub = null;
        }

        this.symbol = sym;
        this.recent_digits = [];
        this.confirmed_ticks = 0;
        this.phase = 1;
        this.phase2_ticks = 0;
        this.last_confidence = 0;

        // Re-subscribe with the new symbol
        this.subscribeToTicks();
    }
}
