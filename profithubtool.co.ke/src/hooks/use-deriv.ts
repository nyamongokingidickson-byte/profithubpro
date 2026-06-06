import { useState, useEffect, useCallback, useRef } from 'react';
import DerivWebSocket from '@/lib/deriv-websocket';
import AnalysisEngine, { AnalysisResult, Signal } from '@/lib/analysis-engine';
import AIPredictor, { AIPredictionResult } from '@/lib/ai-predictor';

export type TConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export const useDeriv = (initialSymbol = 'R_100', maxTicks = 100) => {
    const [connectionStatus, setConnectionStatus] = useState<TConnectionStatus>('disconnected');
    const [currentPrice, setCurrentPrice] = useState<string | number>('0.00');
    const [currentDigit, setCurrentDigit] = useState<number | null>(null);
    const [tickCount, setTickCount] = useState(0);
    const [symbol, setSymbol] = useState(initialSymbol);
    const [availableSymbols, setAvailableSymbols] = useState<any[]>([]);
    const [connectionLogs, setConnectionLogs] = useState<string[]>([]);

    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [signals, setSignals] = useState<Signal[]>([]);
    const [proSignals, setProSignals] = useState<Signal[]>([]);
    const [aiPrediction, setAiPrediction] = useState<AIPredictionResult | null>(null);

    const wsRef = useRef<DerivWebSocket | null>(null);
    const engineRef = useRef<AnalysisEngine>(new AnalysisEngine(maxTicks));
    const predictorRef = useRef<AIPredictor>(new AIPredictor(maxTicks));

    const addLog = useCallback((message: string) => {
        setConnectionLogs(prev => [...prev.slice(-49), `${new Date().toLocaleTimeString()}: ${message}`]);
    }, []);

    const handleTick = useCallback((data: any) => {
        if (data.msg_type === 'tick') {
            const price = data.tick.quote;
            const pip_size = data.tick.pip_size || 2;
            const priceStr = price.toFixed(pip_size);
            const lastDigit = parseInt(priceStr[priceStr.length - 1]);

            setCurrentPrice(price);
            setCurrentDigit(lastDigit);
            setTickCount(prev => prev + 1);

            engineRef.current.addTick(price, pip_size);
            predictorRef.current.addData(lastDigit);

            const currentAnalysis = engineRef.current.getAnalysis();
            setAnalysis(currentAnalysis);
            setSignals(engineRef.current.generateSignals());
            setProSignals(engineRef.current.generateProSignals());
            setAiPrediction(predictorRef.current.predict());
        }
    }, []);

    const hasRequestedActiveSymbols = useRef(false);

    const connect = useCallback(async () => {
        if (!wsRef.current) {
            wsRef.current = new DerivWebSocket();
            wsRef.current.subscribe('tick', handleTick);

            wsRef.current.subscribe('active_symbols', data => {
                if (data.active_symbols) {
                    setAvailableSymbols(data.active_symbols);
                }
            });
        }

        try {
            setConnectionStatus('reconnecting');
            addLog('Connecting to Deriv...');
            await wsRef.current.connect();
            setConnectionStatus('connected');
            addLog('Connected to Deriv WebSocket');

            wsRef.current.subscribeTicks(symbol);
            if (!hasRequestedActiveSymbols.current) {
                wsRef.current.send({ active_symbols: 'brief', product_type: 'basic' });
                hasRequestedActiveSymbols.current = true;
            }
        } catch (error) {
            setConnectionStatus('disconnected');
            addLog(`Connection error: ${error}`);
        }
    }, [symbol, handleTick, addLog]);

    useEffect(() => {
        connect();
        return () => {
            wsRef.current?.disconnect();
        };
    }, []); // Run once on mount

    const changeHistoryLength = useCallback(
        (newMax: number) => {
            addLog(`Updating analysis window to ${newMax} ticks`);
            engineRef.current = new AnalysisEngine(newMax);
            predictorRef.current = new AIPredictor(newMax);
            setTickCount(0);
            // In a full implementation, we would call wsRef.current?.send({ ticks_history: symbol, count: newMax })
        },
        [addLog]
    );

    const changeSymbol = useCallback(
        (newSymbol: string) => {
            if (newSymbol !== symbol) {
                addLog(`Switching symbol to ${newSymbol}`);
                wsRef.current?.unsubscribeTicks();
                setSymbol(newSymbol);
                setTickCount(0);
                engineRef.current = new AnalysisEngine(engineRef.current.maxTicks);
                predictorRef.current = new AIPredictor(predictorRef.current.maxTicks);
                wsRef.current?.subscribeTicks(newSymbol);
            }
        },
        [symbol, addLog]
    );

    const exportData = useCallback(
        (format: 'csv' | 'json') => {
            const data = {
                symbol,
                tickCount,
                analysis,
                signals,
                proSignals,
                aiPrediction,
                timestamp: new Date().toISOString(),
            };

            if (format === 'json') {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `deriv-analysis-${symbol}-${Date.now()}.json`;
                a.click();
            } else {
                // Simple CSV export for frequencies
                if (!analysis) return;
                let csv = 'Digit,Count,Percentage\n';
                analysis.digitFrequencies.forEach(f => {
                    csv += `${f.digit},${f.count},${f.percentage.toFixed(2)}%\n`;
                });
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `deriv-frequencies-${symbol}-${Date.now()}.csv`;
                a.click();
            }
        },
        [symbol, tickCount, analysis, signals, proSignals, aiPrediction]
    );

    return {
        connectionStatus,
        currentPrice,
        currentDigit,
        tickCount,
        analysis,
        signals,
        proSignals,
        aiPrediction,
        symbol,
        availableSymbols,
        connectionLogs,
        changeSymbol,
        changeHistoryLength,
        exportData,
        addLog,
    };
};
