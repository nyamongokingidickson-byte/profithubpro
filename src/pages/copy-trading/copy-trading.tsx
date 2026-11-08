import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { getAppId, getSocketURL, getPublicWebSocketURL } from '@/components/shared/utils/config/config';

interface Account {
    [key: string]: string;
}

const CopyTrading = observer(() => {
    // UI State
    const [demoToReal, setDemoToReal] = useState<boolean>(false);
    const [isCopyTrading, setIsCopyTrading] = useState<boolean>(false);
    const [tokensList, setTokensList] = useState<string[]>([]);
    const [tokenInput, setTokenInput] = useState<string>('');
    
    // Status Messages
    const [statusMsg, setStatusMsg] = useState<string>('');
    const [statusMsgType, setStatusMsgType] = useState<'success' | 'error' | ''>('');
    const [statusMsg2, setStatusMsg2] = useState<string>('');
    const [statusMsg2Type, setStatusMsg2Type] = useState<'success' | 'error' | ''>('');

    // WebSocket / Connection States
    const [loginId, setLoginId] = useState<string>('---');
    const [balance, setBalance] = useState<string>('0.00 USD');
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

    const wsRef = useRef<WebSocket | null>(null);
    const pingTimerRef = useRef<number | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);

    // Show temporary messages
    const triggerStatusMsg = useCallback((msg: string, type: 'success' | 'error') => {
        setStatusMsg(msg);
        setStatusMsgType(type);
        setTimeout(() => {
            setStatusMsg('');
            setStatusMsgType('');
        }, 3000);
    }, []);

    const triggerStatusMsg2 = useCallback((msg: string, type: 'success' | 'error') => {
        setStatusMsg2(msg);
        setStatusMsg2Type(type);
        setTimeout(() => {
            setStatusMsg2('');
            setStatusMsg2Type('');
        }, 3000);
    }, []);

    // Load initial states from localStorage
    useEffect(() => {
        const storedDemoToReal = localStorage.getItem('demo_to_real') === 'true';
        const storedIsCopyTrading = localStorage.getItem('iscopyTrading') === 'true';
        const storedTokens = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
        
        setDemoToReal(storedDemoToReal);
        setIsCopyTrading(storedIsCopyTrading);
        setTokensList(storedTokens);

        // Set initial CR login ID if available
        try {
            const activeLoginId = localStorage.getItem('active_loginid') || '';
            if (activeLoginId && activeLoginId.startsWith('VR')) {
                const cr = localStorage.getItem('cr_loginid') || '';
                setLoginId(cr || 'CR — not linked yet');
            }
        } catch (e) {
            console.error('Error reading loginid from localStorage', e);
        }
    }, []);

    // Manage WebSocket connection
    const connectWebSocket = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }

        // Build tokens list
        const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
        const tokens: string[] = Object.keys(accountsList)
            .map(k => accountsList[k])
            .filter(Boolean);

        const copyTokensArray = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
        const additionalTokens = copyTokensArray.map((item: any) => typeof item === 'string' ? item : item.token).filter(Boolean);
        const allTokens = Array.from(new Set([...tokens, ...additionalTokens]));

        if (allTokens.length === 0) {
            setConnectionStatus('disconnected');
            setLoginId('No tokens');
            setBalance('Please add tokens first');
            return;
        }

        setConnectionStatus('connecting');

        const APP_ID = String(getAppId?.() ?? localStorage.getItem('APP_ID') ?? '34J0u7zObmeCX5lnl8zm7');
        const server = getSocketURL?.() || '';
        const wsUrl = server.startsWith('wss://') || server.startsWith('ws://')
            ? server
            : getPublicWebSocketURL(APP_ID);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectAttemptsRef.current = 0;
            setConnectionStatus('connected');
            
            // Start Ping Timer
            if (pingTimerRef.current) clearInterval(pingTimerRef.current);
            pingTimerRef.current = window.setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ping: 1 }));
                }
            }, 30000);

            // Authorize
            ws.send(JSON.stringify({ authorize: 'MULTI', tokens: allTokens, req_id: 2111 }));
        };

        ws.onclose = () => {
            setConnectionStatus('disconnected');
            scheduleReconnect();
        };

        ws.onerror = () => {
            setConnectionStatus('disconnected');
            scheduleReconnect();
        };

        ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                const reqId = data?.echo_req?.req_id;
                const error = data?.error;

                if (error) {
                    console.error('Copy Trading API Error:', error);
                    const errorMsg = `Error: ${error.message || 'Unknown error'}${error.code ? ` (${error.code})` : ''}`;
                    setLoginId('API Error');
                    setBalance(errorMsg);
                    return;
                }

                if (reqId === 2111 && data.authorize?.account_list) {
                    const list = data.authorize.account_list as Array<any>;
                    let realLogin: string | null = null;
                    for (const acc of list) {
                        if ((acc.currency_type === 'fiat' || String(acc.loginid).startsWith('CR')) && acc.is_virtual === 0) {
                            realLogin = acc.loginid;
                            break;
                        }
                    }
                    if (realLogin) {
                        localStorage.setItem('cr_loginid', String(realLogin));
                    }
                    const activeLoginId = localStorage.getItem('active_loginid') || '';
                    setLoginId(
                        realLogin
                            ? activeLoginId?.startsWith('VR')
                                ? `CR: ${realLogin}`
                                : String(realLogin)
                            : '---'
                    );
                    if (realLogin) {
                        ws.send(JSON.stringify({ balance: 1, loginid: realLogin, req_id: 2112 }));
                    }
                }

                if (reqId === 2112 && data.balance) {
                    const bal = data.balance.balance;
                    const cur = data.balance.currency;
                    setBalance(`${parseFloat(bal).toFixed(2)} ${cur}`);
                }
            } catch (err) {
                console.error('Error handling WebSocket message', err);
            }
        };
    }, []);

    const scheduleReconnect = useCallback(() => {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttemptsRef.current++));
        reconnectTimerRef.current = window.setTimeout(() => {
            connectWebSocket();
        }, delay);
    }, [connectWebSocket]);

    // Connect WebSocket on tokensList or accounts change
    useEffect(() => {
        connectWebSocket();
        return () => {
            if (wsRef.current) wsRef.current.close();
            if (pingTimerRef.current) clearInterval(pingTimerRef.current);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        };
    }, [connectWebSocket, tokensList]);

    // Actions
    const handleToggleDemoToReal = () => {
        const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
        const keys = Object.keys(accountsList);
        const key = keys[0];
        const value = accountsList[key];
        const nextDemoToReal = !demoToReal;

        if (nextDemoToReal) {
            if (keys.length > 0 && !key.startsWith('VR')) {
                const storedTokens = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
                const updatedTokens = Array.from(new Set([...storedTokens, value]));
                
                localStorage.setItem('copyTokensArray', JSON.stringify(updatedTokens));
                localStorage.setItem('demo_to_real', 'true');
                
                setTokensList(updatedTokens);
                setDemoToReal(true);
                triggerStatusMsg('Demo to real copy trading enabled', 'success');
            } else {
                alert('No real account found! Please log in to a real account.');
            }
        } else {
            if (keys.length > 0 && value) {
                const storedTokens = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
                const updatedTokens = storedTokens.filter((token: string) => token !== value);
                
                localStorage.setItem('copyTokensArray', JSON.stringify(updatedTokens));
                setTokensList(updatedTokens);
            }
            localStorage.setItem('demo_to_real', 'false');
            setDemoToReal(false);
            triggerStatusMsg('Demo to real copy trading disabled', 'error');
        }
    };

    const handleToggleCopyTrading = () => {
        const nextCopyTrading = !isCopyTrading;
        localStorage.setItem('iscopyTrading', nextCopyTrading ? 'true' : 'false');
        setIsCopyTrading(nextCopyTrading);
        if (nextCopyTrading) {
            triggerStatusMsg2('Copy trading started successfully', 'success');
        } else {
            triggerStatusMsg2('Copy trading stopped successfully', 'error');
        }
    };

    const handleAddToken = () => {
        const trimmed = tokenInput.trim();
        if (!trimmed) return;

        const storedTokens = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
        if (storedTokens.includes(trimmed)) {
            triggerStatusMsg2('Token already exists', 'error');
        } else {
            const updated = [...storedTokens, trimmed];
            localStorage.setItem('copyTokensArray', JSON.stringify(updated));
            setTokensList(updated);
            setTokenInput('');
            triggerStatusMsg2('Token added successfully', 'success');
        }
    };

    const handleDeleteToken = (index: number) => {
        const storedTokens = JSON.parse(localStorage.getItem('copyTokensArray') || '[]');
        storedTokens.splice(index, 1);
        localStorage.setItem('copyTokensArray', JSON.stringify(storedTokens));
        setTokensList(storedTokens);
        triggerStatusMsg2('Token removed successfully', 'error');
    };

    const handleSync = () => {
        connectWebSocket();
        triggerStatusMsg2('Synchronized successfully', 'success');
    };

    return (
        <div className="flex flex-col min-h-screen w-full bg-[#05080c] text-white p-4 md:p-8 overflow-y-auto">
            {/* Header / Network Status */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
                <div>
                    <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-teal-400 to-cyan-500 bg-clip-text text-transparent">
                        Copy Trading Control Center
                    </h2>
                    <p className="text-xs md:text-sm text-slate-400 mt-1">
                        Replicate trades in real-time across multiple client accounts.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Network Status:</span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        connectionStatus === 'connected' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        connectionStatus === 'connecting' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                        <span className={`w-2 h-2 rounded-full ${
                            connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
                            connectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
                            'bg-rose-400'
                        }`} />
                        {connectionStatus.toUpperCase()}
                    </span>
                </div>
            </div>

            {/* Hero Summary */}
            <div className="grid grid-cols-1 xl:grid-cols-[1.8fr_1fr] gap-6 mb-8">
                <div className="rounded-[32px] border border-cyan-500/10 bg-gradient-to-br from-slate-900/95 via-slate-950/90 to-slate-900/80 p-6 shadow-2xl shadow-cyan-500/10">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-xs uppercase tracking-[0.26em] text-cyan-300/70 mb-2">
                                Copy trading dashboard
                            </p>
                            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                                Modern Trade Replication
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm text-slate-400">
                                Keep your tokens synced, monitor live status, and control your copy trading service from a clean, modern dashboard.
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 w-full md:w-auto">
                            <div className="rounded-3xl bg-slate-950/70 border border-slate-800/90 p-4 text-center">
                                <span className="block text-xs uppercase tracking-[0.24em] text-slate-400">Accounts</span>
                                <span className="mt-2 text-2xl font-bold text-white">{tokensList.length}</span>
                            </div>
                            <div className="rounded-3xl bg-slate-950/70 border border-slate-800/90 p-4 text-center">
                                <span className="block text-xs uppercase tracking-[0.24em] text-slate-400">Live State</span>
                                <span className={`mt-2 text-2xl font-bold ${isCopyTrading ? 'text-emerald-300' : 'text-amber-300'}`}>
                                    {isCopyTrading ? 'Active' : 'Idle'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="rounded-[32px] border border-slate-800/80 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Security</p>
                            <h2 className="mt-2 text-xl font-bold text-white">Token-safe workflow</h2>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-slate-800/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 border border-cyan-500/15">
                            Secure mode
                        </span>
                    </div>
                    <p className="mt-4 text-sm text-slate-400 leading-6">
                        Store your linked client tokens securely and manage replication with confidence. Sync updates instantly across all connected accounts.
                    </p>
                </div>
            </div>

            {/* Top Bar - Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Demo to Real Card */}
                <div className="flex flex-col justify-between bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl">
                    <div>
                        <div className="flex justify-between items-start mb-4">
                            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Demo-to-Real Copier</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={demoToReal} 
                                    onChange={handleToggleDemoToReal}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:height-5 after:width-5 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed mb-4">
                            Automatically replicate trades placed on your virtual accounts onto your linked real accounts.
                        </p>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800/60">
                        <button
                            onClick={handleToggleDemoToReal}
                            className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs transition-all duration-300 uppercase tracking-wider ${
                                demoToReal 
                                    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-600/20' 
                                    : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-lg shadow-emerald-500/20'
                            }`}
                        >
                            {demoToReal ? 'Stop Demo to Real' : 'Start Demo to Real'}
                        </button>
                        {statusMsg && (
                            <span className={`text-xs font-semibold transition-all duration-300 ${
                                statusMsgType === 'success' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                                {statusMsg}
                            </span>
                        )}
                    </div>
                </div>

                {/* Account Details Card */}
                <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl flex flex-col justify-between">
                    <div>
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-wider block mb-4">Active Account Summary</span>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-slate-500">Linked Login ID:</span>
                            <span className="text-sm font-mono font-bold text-white bg-slate-800/60 px-3 py-1 rounded-lg border border-slate-700/50">
                                {loginId}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Available Balance:</span>
                            <span className="text-lg font-mono font-extrabold text-amber-400">
                                {balance}
                            </span>
                        </div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-slate-800/60 leading-normal">
                        Note: Multi-client configurations rely on client-provided secure tokens. Ensure these have 'Trade' permissions.
                    </div>
                </div>
            </div>

            {/* Token Management Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Form to Add Tokens */}
                <div className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl h-fit">
                    <h3 className="text-base font-bold text-slate-200 mb-2">Add Client Tokens</h3>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">
                        Link other client accounts to replicate trades directly to them.
                    </p>

                    <div className="space-y-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Client API Token</label>
                            <input 
                                type="text"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="Enter client API token"
                                className="bg-slate-950/60 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 rounded-xl p-3 text-xs text-white placeholder-slate-600 outline-none transition-all duration-300"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleAddToken}
                                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-300 shadow-md shadow-cyan-500/10"
                            >
                                Add Client
                            </button>
                            <button
                                onClick={handleSync}
                                className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-300 border border-slate-700/60"
                                title="Sync WebSocket"
                            >
                                Sync &#x21bb;
                            </button>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={handleToggleCopyTrading}
                                className={`w-full py-3 rounded-xl font-extrabold text-xs transition-all duration-300 uppercase tracking-wider ${
                                    isCopyTrading
                                        ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-600/20'
                                        : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-lg shadow-emerald-500/20'
                                }`}
                            >
                                {isCopyTrading ? 'Stop Replicator Service' : 'Start Replicator Service'}
                            </button>
                        </div>

                        {statusMsg2 && (
                            <div className={`text-center text-xs font-semibold mt-2 ${
                                statusMsg2Type === 'success' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                                {statusMsg2}
                            </div>
                        )}
                    </div>
                </div>

                {/* Tokens Table List */}
                <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base font-bold text-slate-200">Replicated Accounts</h3>
                            <span className="bg-slate-800 text-cyan-400 text-xs px-3 py-1 rounded-full font-bold border border-slate-700">
                                Copiers: {tokensList.length}
                            </span>
                        </div>

                        {tokensList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                                <span className="text-3xl mb-2">👥</span>
                                <p className="text-xs">No client accounts linked yet.</p>
                                <p className="text-[10px] text-slate-600 mt-1">Use the left form to add your first API token.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold">
                                            <th className="py-3 px-4">Client API Token</th>
                                            <th className="py-3 px-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/40 text-xs font-mono">
                                        {tokensList.map((token, index) => (
                                            <tr key={index} className="hover:bg-slate-800/20 transition-all">
                                                <td className="py-3.5 px-4 text-slate-300 break-all select-all pr-8">
                                                    {token}
                                                </td>
                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        onClick={() => handleDeleteToken(index)}
                                                        className="text-rose-500 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1.5 rounded-lg transition-all duration-200 font-sans text-xs font-semibold"
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CopyTrading;
