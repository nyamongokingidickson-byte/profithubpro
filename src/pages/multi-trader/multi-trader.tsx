import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import { getAppId, getSocketURL, getPublicWebSocketURL } from '@/components/shared/utils/config/config';
import './multi-trader.scss';

// ─── Types ───────────────────────────────────────────────────────────────────

type TradeType = 'highlow' | 'risefall' | 'evenodd' | 'overunder' | 'accumulator' | 'multiplier';
type StatusVariant = 'connected' | 'disconnected' | 'connecting';

interface TradeConfig {
    proposal: number;
    amount: number;
    basis: string;
    currency: string;
    duration: number;
    duration_unit: string;
    contract_type: string;
    label: string;
    strategyId: string;
    selected_tick?: number;
    barrier?: number | string;
    prediction?: number;
    growth_rate?: number;
    multiplier?: number;
}

interface LogEntry {
    id: number;
    time: string;
    message: string;
    type: 'default' | 'success' | 'error' | 'warning' | 'info';
}

interface Transaction {
    id: number;
    time: string;
    type: string;
    entry: string | number;
    exit: string | number;
    buy_price: number;
    profit: number;
}

interface TradeResult {
    profit: number;
    message: string;
    strategyId: string;
    stakeUsed: number;
    transaction: Transaction;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const APP_ID = getAppId();
const SERVER_URL = getSocketURL();
const WS_URL = SERVER_URL.startsWith('wss://') || SERVER_URL.startsWith('ws://')
    ? SERVER_URL
    : getPublicWebSocketURL(APP_ID);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

function getTradeConfigs(type: TradeType, stake: number, ticks: number, predictions: { over: number; under: number }): TradeConfig[] {
    const common = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        currency: 'USD',
        duration: ticks,
        duration_unit: 't',
    };
    switch (type) {
        case 'highlow':
            return [
                { ...common, contract_type: 'TICKHIGH', selected_tick: 1, label: 'High Tick',    strategyId: 'highlow_TICKHIGH' },
                { ...common, contract_type: 'TICKLOW',  selected_tick: 1, label: 'Low Tick',     strategyId: 'highlow_TICKLOW'  },
            ];
        case 'risefall':
            return [
                { ...common, contract_type: 'CALL', label: 'Rise', strategyId: 'risefall_CALL' },
                { ...common, contract_type: 'PUT',  label: 'Fall', strategyId: 'risefall_PUT'  },
            ];
        case 'evenodd':
            return [
                { ...common, contract_type: 'DIGITEVEN', label: 'Even Digit', strategyId: 'evenodd_DIGITEVEN' },
                { ...common, contract_type: 'DIGITODD',  label: 'Odd Digit',  strategyId: 'evenodd_DIGITODD'  },
            ];
        case 'overunder':
            return [
                { ...common, contract_type: 'DIGITOVER',  barrier: predictions.over, label: `Over ${predictions.over}`,  strategyId: 'overunder_DIGITOVER'  },
                { ...common, contract_type: 'DIGITUNDER', barrier: predictions.under, label: `Under ${predictions.under}`, strategyId: 'overunder_DIGITUNDER' },
            ];
        case 'accumulator':
            return [
                { ...common, contract_type: 'ACCU', growth_rate: 0.01, label: 'Accumulator', strategyId: 'accumulator_ACCU' }
            ];
        case 'multiplier':
            return [
                { ...common, contract_type: 'MULTUP',   multiplier: 10, label: 'Multiplier Up',   strategyId: 'multiplier_MULTUP' },
                { ...common, contract_type: 'MULTDOWN', multiplier: 10, label: 'Multiplier Down', strategyId: 'multiplier_MULTDOWN' }
            ];
        default:
            return [];
    }
}

// ─── Component ───────────────────────────────────────────────────────────────

const ProMultiTrader: React.FC = observer(() => {
    const { client } = useStore();
    // Connection
    const [status, setStatus] = useState<StatusVariant>('disconnected');
    const wsRef = useRef<WebSocket | null>(null);
    const reqCounter = useRef(1);
    const resolvers   = useRef<Map<number, { resolve: (d: any) => void; reject: (e: any) => void; isSubscription?: boolean }>>(new Map());

    // Config
    const [market,     setMarket]     = useState('V10_1S');
    const [baseStake,  setBaseStake]  = useState(0.5);
    const [ticks,      setTicks]      = useState(5);
    const [martingale, setMartingale] = useState(2.0);
    const [takeProfit, setTakeProfit] = useState(10);
    const [stopLoss,   setStopLoss]   = useState(5);
    const [tradeTypes, setTradeTypes] = useState<TradeType[]>(['highlow']);

    // State
    const [running,  setRunning]  = useState(false);
    const [totalProfit, setTotalProfit] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [roundWins,   setRoundWins]   = useState(0);
    const [roundLosses, setRoundLosses] = useState(0);
    const [totalStakeUsed, setTotalStakeUsed] = useState(0);
    const [totalPayout, setTotalPayout] = useState(0);
    const [totalTrades, setTotalTrades] = useState(0);
    const [overPrediction, setOverPrediction] = useState(5);
    const [underPrediction, setUnderPrediction] = useState(4);
    const [logs, setLogs] = useState<LogEntry[]>([{ id: 0, time: '', message: 'Awaiting connection…', type: 'default' }]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLogExpanded, setIsLogExpanded] = useState(false);

    // Mutable refs for trading loop
    const runningRef       = useRef(false);
    const totalProfitRef   = useRef(0);
    const totalRoundsRef   = useRef(0);
    const roundWinsRef     = useRef(0);
    const roundLossesRef   = useRef(0);
    const totalTradesRef   = useRef(0);
    const strategyStakes   = useRef<Record<string, number>>({});
    const logId            = useRef(1);

    // ── Logging ──────────────────────────────────────────────────────────────

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'default') => {
        const entry: LogEntry = {
            id: logId.current++,
            time: new Date().toLocaleTimeString(),
            message,
            type,
        };
        setLogs(prev => [entry, ...prev].slice(0, 300));
    }, []);

    // ── WebSocket helpers ─────────────────────────────────────────────────────

    const sendJSON = useCallback((obj: Record<string, any>): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                return reject('WebSocket not open');
            }
            const req_id = reqCounter.current++;
            resolvers.current.set(req_id, { resolve, reject });
            wsRef.current.send(JSON.stringify({ ...obj, req_id }));
        });
    }, []);

    const handleMessage = useCallback((raw: MessageEvent) => {
        const data = JSON.parse(raw.data as string);
        const req_id = data.req_id;

        if (req_id && resolvers.current.has(req_id)) {
            const { resolve, reject, isSubscription } = resolvers.current.get(req_id)!;
            if (isSubscription) {
                const poc = data.proposal_open_contract;
                if (poc?.is_sold) { resolve(data); resolvers.current.delete(req_id); }
                else if (data.error) { reject(data.error.message); resolvers.current.delete(req_id); }
                return;
            }
            resolvers.current.delete(req_id);
            if (data.error) reject(data.error.message);
            else resolve(data);
            return;
        }

        if (data.msg_type === 'authorize') {
            if (data.error) {
                setStatus('disconnected');
                addLog(`Authorization failed: ${data.error.message}`, 'error');
            } else {
                setStatus('connected');
                addLog(`Authorized as ${data.authorize.loginid}`, 'success');
                wsRef.current?.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            }
        }
        if (data.error && data.msg_type !== 'authorize') {
            addLog(`[API Error] ${data.error.message}`, 'error');
        }
    }, [addLog]);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        const currentToken = client.getToken();
        if (!currentToken) { addLog('Please log in first.', 'error'); return; }

        setStatus('connecting');

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen    = () => { addLog('Connected. Authorizing…', 'info'); ws.send(JSON.stringify({ authorize: currentToken })); };
        ws.onmessage = handleMessage;
        ws.onclose   = () => {
            setStatus('disconnected');
            if (runningRef.current) { runningRef.current = false; setRunning(false); addLog('Connection lost. Bot stopped.', 'error'); }
        };
        ws.onerror   = () => addLog('WebSocket error — check console.', 'error');
    }, [client, handleMessage, addLog]);

    // Auto-connect on mount
    useEffect(() => {
        if (status === 'disconnected' && client.getToken()) {
            connect();
        }
    }, [client, connect, status]);

    // ── Strategy stakes init ──────────────────────────────────────────────────

    const initStakes = useCallback((stake: number) => {
        strategyStakes.current = {};
        tradeTypes.forEach(type => {
            getTradeConfigs(type, stake, ticks, { over: overPrediction, under: underPrediction }).forEach(c => {
                strategyStakes.current[c.strategyId] = stake;
            });
        });
    }, [tradeTypes, ticks, overPrediction, underPrediction]);

    // ── Track contract ────────────────────────────────────────────────────────

    const trackContract = useCallback((contractId: number, strategyId: string, label: string, stakeUsed: number): Promise<TradeResult> => {
        return new Promise((resolve, reject) => {
            const req_id = reqCounter.current++;
            resolvers.current.set(req_id, {
                isSubscription: true,
                resolve: (data: any) => {
                    const poc  = data.proposal_open_contract;
                    const profit = parseFloat(poc.profit);
                    const status = poc.status.toUpperCase();
                    const entry  = poc.entry_tick_display_value  || 'N/A';
                    const exit   = poc.exit_tick_display_value   || 'N/A';
                    resolve({
                        profit,
                        strategyId,
                        stakeUsed,
                        message: `[ID: ${req_id}] [${strategyId.toUpperCase()}] - ${label} | ${status}`,
                        transaction: {
                            id: req_id,
                            time: new Date().toLocaleTimeString(),
                            type: label,
                            entry,
                            exit,
                            buy_price: stakeUsed,
                            profit,
                        }
                    } as any);
                },
                reject,
            });
            wsRef.current?.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1, req_id }));
        });
    }, []);

    // ── Core trading loop ─────────────────────────────────────────────────────

    const placeTrades = useCallback(async (
        _market: string, _baseStake: number, _ticks: number,
        _martingale: number, _takeProfit: number, _stopLoss: number,
        _tradeTypes: TradeType[],
    ) => {
        if (!runningRef.current || wsRef.current?.readyState !== WebSocket.OPEN) {
            runningRef.current = false; setRunning(false); return;
        }

        try {
            // TP / SL check
            if (totalProfitRef.current >= _takeProfit) {
                addLog(`TAKE PROFIT hit! Profit: ${totalProfitRef.current.toFixed(2)} USD`, 'success');
                runningRef.current = false; setRunning(false); return;
            }
            if (totalProfitRef.current <= -Math.abs(_stopLoss)) {
                addLog(`STOP LOSS hit! Loss: ${Math.abs(totalProfitRef.current).toFixed(2)} USD`, 'error');
                runningRef.current = false; setRunning(false); return;
            }

            // Build all configs with current stakes
            const allConfigs: (TradeConfig & { symbol: string })[] = [];
            _tradeTypes.forEach(type => {
                getTradeConfigs(type, _baseStake, _ticks, { over: overPrediction, under: underPrediction }).forEach(cfg => {
                    const stake = strategyStakes.current[cfg.strategyId] ?? _baseStake;
                    allConfigs.push({ ...cfg, amount: stake, symbol: _market });
                });
            });

            if (allConfigs.length === 0) { addLog('No trade types selected.', 'warning'); runningRef.current = false; setRunning(false); return; }

            addLog(`Round start — ${allConfigs.length} trades on ${_market}`, 'info');

            // Propose
            const proposalResults = await Promise.all(
                allConfigs.map(({ label, strategyId, ...apiConfig }) => sendJSON({ ...apiConfig }))
            );

            // Buy
            const buyPromises: Promise<any>[]  = [];
            const buyMeta: { config: TradeConfig; idx: number }[] = [];
            proposalResults.forEach((res, i) => {
                if (res.error) { addLog(`[${allConfigs[i].strategyId}] Proposal failed: ${res.error.message}`, 'warning'); return; }
                const id = res.proposal?.id;
                if (id) {
                    buyMeta.push({ config: allConfigs[i], idx: buyPromises.length });
                    buyPromises.push(sendJSON({ buy: id, price: allConfigs[i].amount }));
                }
            });

            if (buyPromises.length === 0) { addLog('All proposals failed. Waiting 5s…', 'error'); await new Promise(r => setTimeout(r, 5000)); if (runningRef.current) placeTrades(_market, _baseStake, _ticks, _martingale, _takeProfit, _stopLoss, _tradeTypes); return; }

            addLog(`Buying ${buyPromises.length} contracts…`);
            const buyResults = await Promise.all(buyPromises);

            // Track
            const trackPromises: Promise<TradeResult>[] = [];
            let bought = 0;
            buyMeta.forEach(({ config, idx }) => {
                const contractId = buyResults[idx]?.buy?.contract_id;
                if (contractId) { trackPromises.push(trackContract(contractId, config.strategyId, config.label, config.amount)); bought++; }
                else addLog(`[${config.strategyId}] Buy failed.`, 'error');
            });

            totalTradesRef.current += bought;
            setTotalTrades(totalTradesRef.current);
            addLog(`Tracking ${bought} contracts…`);

            const results = await Promise.all(trackPromises);

            // Process results
            let roundProfit = 0;
            let roundWon    = false;
            results.forEach(r => {
                const res = r as any;
                roundProfit += res.profit;
                addLog(res.message, res.profit >= 0 ? 'success' : 'error');
                setTransactions(prev => [res.transaction, ...prev].slice(0, 50));

                if (res.profit > 0) {
                    strategyStakes.current[res.strategyId] = _baseStake;
                    roundWon = true;
                } else {
                    const newStake = round2(res.stakeUsed * _martingale);
                    strategyStakes.current[res.strategyId] = newStake;
                }
            });

            totalProfitRef.current += roundProfit;
            totalRoundsRef.current++;
            if (roundWon) {
                roundWinsRef.current++;
            } else {
                roundLossesRef.current++;
            }
            
            const totalStakeInRound = results.reduce((acc, curr) => acc + curr.stakeUsed, 0);
            const totalPayoutInRound = results.reduce((acc, curr) => acc + (curr.stakeUsed + curr.profit), 0);
            
            setTotalStakeUsed(prev => prev + totalStakeInRound);
            setTotalPayout(prev => prev + totalPayoutInRound);
            setTotalProfit(totalProfitRef.current);
            setTotalRounds(totalRoundsRef.current);
            setRoundWins(roundWinsRef.current);
            setRoundLosses(roundLossesRef.current);

            addLog(`Round P/L: ${roundProfit >= 0 ? '+' : ''}${roundProfit.toFixed(2)} | Total: ${totalProfitRef.current >= 0 ? '+' : ''}${totalProfitRef.current.toFixed(2)} USD`,
                   roundProfit >= 0 ? 'success' : 'warning');

            await new Promise(r => setTimeout(r, 1500));
            if (runningRef.current) placeTrades(_market, _baseStake, _ticks, _martingale, _takeProfit, _stopLoss, _tradeTypes);

        } catch (err: any) {
            const msg = String(err).replace('Error: ', '');
            addLog(`CRITICAL ERROR: ${msg}. Resetting stakes, pausing 5s…`, 'error');
            initStakes(_baseStake);
            await new Promise(r => setTimeout(r, 5000));
            if (runningRef.current) placeTrades(_market, _baseStake, _ticks, _martingale, _takeProfit, _stopLoss, _tradeTypes);
        }
    }, [sendJSON, trackContract, addLog, initStakes]);

    // ── Start / Stop ──────────────────────────────────────────────────────────

    const startBot = useCallback(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) { addLog('Not connected.', 'error'); return; }
        const stake = round2(Math.max(0.5, baseStake));
        initStakes(stake);
        totalProfitRef.current = 0; totalRoundsRef.current = 0; roundWinsRef.current = 0; roundLossesRef.current = 0; totalTradesRef.current = 0;
        setTotalProfit(0); setTotalRounds(0); setRoundWins(0); setRoundLosses(0); setTotalTrades(0); setTotalStakeUsed(0); setTotalPayout(0);
        setTransactions([]);
        runningRef.current = true;
        setRunning(true);
        addLog('Bot started with independent Martingale per strategy!', 'success');
        placeTrades(market, stake, ticks, martingale, takeProfit, stopLoss, tradeTypes);
    }, [baseStake, market, ticks, martingale, takeProfit, stopLoss, tradeTypes, initStakes, placeTrades, addLog]);

    const stopBot = useCallback(() => {
        runningRef.current = false; setRunning(false);
        addLog('Bot manually stopped. Stakes retained until next start.', 'warning');
    }, [addLog]);

    const resetStats = useCallback(() => {
        totalProfitRef.current = 0; totalRoundsRef.current = 0; roundWinsRef.current = 0; roundLossesRef.current = 0; totalTradesRef.current = 0;
        setTotalProfit(0); setTotalRounds(0); setRoundWins(0); setRoundLosses(0); setTotalTrades(0); setTotalStakeUsed(0); setTotalPayout(0);
        setTransactions([]);
        initStakes(round2(Math.max(0.5, baseStake)));
        setLogs([{ id: logId.current++, time: '', message: 'Stats reset.', type: 'warning' }]);
    }, [baseStake, initStakes]);

    // Cleanup on unmount
    useEffect(() => () => { runningRef.current = false; wsRef.current?.close(); }, []);

    // ── Derived ───────────────────────────────────────────────────────────────

    const isConnected = status === 'connected';
    const winRate = totalRounds > 0 ? ((roundWins / totalRounds) * 100).toFixed(1) : '--';


    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className='multi-trader'>
            <div className='multi-trader__content'>
                {/* Parameters Section */}
                <div className='multi-trader__card multi-trader__config-card'>
                    <div className='multi-trader__card-header'>
                        <h2>⚙️ Trading Parameters</h2>
                    </div>
                    <div className='multi-trader__config-grid'>
                        <div className='multi-trader__field'>
                            <label>Market (Symbol)</label>
                            <select value={market} onChange={e => setMarket(e.target.value)} disabled={running}>
                                {useStore().analysis.markets.map(group => (
                                    <optgroup key={group.group} label={group.group}>
                                        {group.items.map(item => (
                                            <option key={item.value} value={item.value}>{item.label}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                        <div className='multi-trader__field'>
                            <label>Base Stake ($)</label>
                            <input type='number' value={baseStake} min={0.5} step={0.01} disabled={running} onChange={e => setBaseStake(round2(Math.max(0.5, parseFloat(e.target.value) || 0.5)))} />
                        </div>
                        <div className='multi-trader__field'>
                            <label>Duration (Ticks)</label>
                            <input type='number' value={ticks} min={5} max={10} step={1} disabled={running} onChange={e => setTicks(Math.max(5, parseInt(e.target.value) || 5))} />
                        </div>
                        <div className='multi-trader__field'>
                            <label>Martingale Factor</label>
                            <input type='number' value={martingale} min={1.1} step={0.01} disabled={running} onChange={e => setMartingale(parseFloat(e.target.value) || 2)} />
                        </div>
                        <div className='multi-trader__field'>
                            <label>Take Profit ($)</label>
                            <input type='number' value={takeProfit} min={0} step={1} disabled={running} onChange={e => setTakeProfit(parseFloat(e.target.value) || 10)} />
                        </div>
                        <div className='multi-trader__field'>
                            <label>Stop Loss ($)</label>
                            <input type='number' value={stopLoss} min={0} step={1} disabled={running} onChange={e => setStopLoss(Math.max(0, parseFloat(e.target.value) || 5))} />
                        </div>
                    </div>

                    <div className='multi-trader__config-strategies'>
                        <label>Active Trading Strategies</label>
                        <div className='multi-trader__strategy-grid'>
                            {[
                                { id: 'highlow', label: 'High / Low', icon: '📈' },
                                { id: 'risefall', label: 'Rise / Fall', icon: '↕️' },
                                { id: 'evenodd', label: 'Even / Odd', icon: '🔢' },
                                { id: 'overunder', label: 'Over / Under', icon: '🎯' },
                                { id: 'accumulator', label: 'Accumulator', icon: '🔋' },
                                { id: 'multiplier', label: 'Multiplier', icon: '✖️' }
                            ].map(strat => {
                                const isActive = tradeTypes.includes(strat.id as TradeType);
                                return (
                                    <div key={strat.id} 
                                        className={`multi-trader__strategy-card ${isActive ? 'active' : ''}`}
                                        onClick={() => {
                                            if (running) return;
                                            setTradeTypes(prev => 
                                                prev.includes(strat.id as TradeType) 
                                                    ? prev.filter(t => t !== strat.id) 
                                                    : [...prev, strat.id as TradeType]
                                            );
                                        }}>
                                        <span className='icon'>{strat.icon}</span>
                                        <span className='label'>{strat.label}</span>
                                        <div className='indicator'></div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {tradeTypes.includes('overunder') && (
                            <div className='multi-trader__predictions-row animate-fade-in'>
                                <div className='multi-trader__field'>
                                    <label>Over Prediction (0-9)</label>
                                    <input type='number' value={overPrediction} min={0} max={9} onChange={e => setOverPrediction(parseInt(e.target.value))} />
                                </div>
                                <div className='multi-trader__field'>
                                    <label>Under Prediction (0-9)</label>
                                    <input type='number' value={underPrediction} min={0} max={9} onChange={e => setUnderPrediction(parseInt(e.target.value))} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Control & Stats Section */}
                <div className='multi-trader__card multi-trader__controls-card'>
                    <div className='multi-trader__buttons-row'>
                        <button className='multi-trader__btn multi-trader__btn--start' onClick={startBot} disabled={!isConnected || running}>▶ Start</button>
                        <button className='multi-trader__btn multi-trader__btn--stop' onClick={stopBot} disabled={!running}>■ Stop</button>
                        <button className='multi-trader__btn multi-trader__btn--reset' onClick={resetStats} disabled={running}>↺ Reset</button>
                    </div>

                    <div className='multi-trader__stats-display'>
                        <div className='multi-trader__stats-grid'>
                            <div className='multi-trader__stat-item'>
                                <label>STAKE</label>
                                <span>{totalStakeUsed.toFixed(2)}</span>
                            </div>
                            <div className='multi-trader__stat-item'>
                                <label>PAYOUT</label>
                                <span>{totalPayout.toFixed(2)}</span>
                            </div>
                            <div className='multi-trader__stat-item'>
                                <label>TRADES</label>
                                <span>{totalTrades}</span>
                            </div>
                            <div className='multi-trader__stat-item'>
                                <label>WIN RATE</label>
                                <span>{winRate}%</span>
                            </div>
                            <div className='multi-trader__stat-item'>
                                <label>WINS</label>
                                <span className='success'>{roundWins}</span>
                            </div>
                            <div className='multi-trader__stat-item'>
                                <label>LOSSES</label>
                                <span className='error'>{roundLosses}</span>
                            </div>
                        </div>
                        <div className='multi-trader__profit-bar'>
                            <label>TOTAL PROFIT/LOSS</label>
                            <span className={totalProfit >= 0 ? 'success' : 'error'}>
                                {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} USD
                            </span>
                        </div>
                    </div>
                </div>

                {/* Log Section (Expandable) */}
                <div className='multi-trader__card multi-trader__log-card'>
                    <div className='multi-trader__card-header' onClick={() => setIsLogExpanded(!isLogExpanded)} style={{ cursor: 'pointer' }}>
                        <h2>📋 Bot Activity Log {isLogExpanded ? '▼' : '▶'}</h2>
                        <span className='multi-trader__expand-hint'>{isLogExpanded ? 'Click to collapse' : 'Click to expand'}</span>
                    </div>
                    {isLogExpanded && (
                        <div className='multi-trader__log-container'>
                            <div className='multi-trader__log-output'>
                                {logs.map(entry => (
                                    <div key={entry.id} className={`multi-trader__log-entry multi-trader__log-entry--${entry.type}`}>
                                        {entry.time && <span className='log-time'>[{entry.time}]</span>}
                                        <span dangerouslySetInnerHTML={{ __html: entry.message }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Transactions Section */}
                <div className='multi-trader__card multi-trader__transactions-card'>
                    <div className='multi-trader__card-header'>
                        <h2>🔄 Recent Transactions</h2>
                    </div>
                    <div className='multi-trader__transactions-list'>
                        <div className='multi-trader__transactions-header'>
                            <span>Type</span>
                            <span>Spots</span>
                            <span>Buy</span>
                            <span>P/L</span>
                        </div>
                        <div className='multi-trader__transactions-scroll'>
                            {transactions.map(tx => (
                                <div key={tx.id} className='multi-trader__transactions-row'>
                                    <span>{tx.type}</span>
                                    <span className='spots'>{tx.entry} → {tx.exit}</span>
                                    <span>{tx.buy_price.toFixed(2)}</span>
                                    <span className={tx.profit >= 0 ? 'success' : 'error'}>
                                        {tx.profit >= 0 ? '+' : ''}{tx.profit.toFixed(2)}
                                    </span>
                                </div>
                            ))}
                            {transactions.length === 0 && <div className='multi-trader__empty'>No recent transactions</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default ProMultiTrader;
