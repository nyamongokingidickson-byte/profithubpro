import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
import { ProposalOpenContract } from '@deriv/api-types';
import RootStore from './root-store';
import { getAppId, getPublicWebSocketURL } from '@/components/shared';

export type TCopyAccount = {
    token: string;
    label?: string;
    type: 'Source' | 'Target';
    status: 'Connected' | 'Pending' | 'Error';
    account_type: string;
    balance: string;
    currency: string;
    ws?: WebSocket;
    profit_loss?: number;
    trades_count?: number;
};

export type TTradeResult = {
    timestamp: number;
    market: string;
    stake: number;
    status: 'Success' | 'Failed';
    message: string;
    target_label: string;
    contract_id?: number | string;
};

export default class CopyTraderStore {
    root_store: RootStore;
    private processed_contracts = new Set<string | number>();

    @observable accessor trade_history: TTradeResult[] = [];

    @observable accessor source_account: TCopyAccount = {
        token: '',
        type: 'Source',
        status: 'Pending',
        account_type: '-',
        balance: '-',
        currency: '-',
    };

    @observable accessor target_accounts: TCopyAccount[] = [
        {
            token: '',
            label: 'My Target Account',
            type: 'Target',
            status: 'Pending',
            account_type: '-',
            balance: '-',
            currency: '-',
        },
    ];

    @observable accessor is_mirroring_internal = false;
    @observable accessor internal_multiplier = 1;

    // Demo to Real Account mirroring
    @observable accessor selected_real_account_loginid: string = '';
    @observable accessor is_demo_to_real_active = false;
    @observable accessor demo_to_real_status: 'idle' | 'connecting' | 'active' | 'error' = 'idle';
    @observable accessor demo_to_real_error = '';
    private real_account_ws: WebSocket | null = null;

    constructor(root_store: RootStore) {
        makeObservable(this);
        this.root_store = root_store;

        // Reaction for internal mirroring
        reaction(
            () => this.root_store.summary_card.contract_info,
            contract => {
                if (this.is_mirroring_internal && contract) {
                    this.handleSourceTrade(contract);
                }
                // Also mirror to real account if demo-to-real is active
                if (this.is_demo_to_real_active && contract) {
                    this.mirrorTradeToRealAccount(contract);
                }
            }
        );
    }

    @action
    toggleInternalMirroring = () => {
        this.is_mirroring_internal = !this.is_mirroring_internal;
    };

    @action
    setInternalMultiplier = (value: number) => {
        this.internal_multiplier = value;
    };

    @action
    setSourceToken = (token: string) => {
        this.source_account.token = token;
        if (token.length > 10) {
            this.connectAccount(this.source_account);
        }
    };

    @action
    setTargetToken = (index: number, token: string) => {
        if (this.target_accounts[index]) {
            this.target_accounts[index].token = token;
            if (token.length > 10) {
                this.connectAccount(this.target_accounts[index]);
            }
        }
    };

    @action
    setTargetLabel = (index: number, label: string) => {
        if (this.target_accounts[index]) {
            this.target_accounts[index].label = label;
        }
    };

    @action
    addTargetAccount = () => {
        this.target_accounts.push({
            token: '',
            label: `Target Account ${this.target_accounts.length + 1}`,
            type: 'Target',
            status: 'Pending',
            account_type: '-',
            balance: '-',
            currency: '-',
        });
    };

    @action
    removeTargetAccount = (index: number) => {
        const account = this.target_accounts[index];
        if (account.ws) {
            account.ws.close();
        }
        this.target_accounts.splice(index, 1);
    };

    @action
    connectAccount = (account: TCopyAccount) => {
        if (account.ws) {
            account.ws.close();
        }

        const app_id = getAppId();
        const ws = new WebSocket(getPublicWebSocketURL(Number(app_id)));

        account.ws = ws;
        account.status = 'Pending';

        ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: account.token }));
        };

        ws.onmessage = msg => {
            const data = JSON.parse(msg.data);

            if (data.error) {
                console.error('CopyTrader Auth Error:', data.error.message);
                runInAction(() => {
                    account.status = 'Error';
                });
                return;
            }

            if (data.msg_type === 'authorize') {
                runInAction(() => {
                    account.status = 'Connected';
                    account.account_type = data.authorize.is_virtual ? 'Demo' : 'Real';
                    account.balance = data.authorize.balance.toLocaleString();
                    account.currency = data.authorize.currency;
                });

                // Subscribe to trades on source
                if (account.type === 'Source') {
                    ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1 }));
                }
            }

            if (data.msg_type === 'proposal_open_contract') {
                this.handleSourceTrade(data.proposal_open_contract);
            }
        };

        ws.onerror = () => {
            runInAction(() => {
                account.status = 'Error';
            });
        };
    };

    @action
    handleSourceTrade = (contract: ProposalOpenContract) => {
        // Debounce/Filter to only mirror new 'open' contracts
        if (contract.status !== 'open' || contract.is_expired) return;

        // Prevent mirroring the same contract ID multiple times
        const contract_id = (contract.contract_id || contract.id) as string | number;
        if (this.processed_contracts.has(contract_id)) return;
        this.processed_contracts.add(contract_id);

        // Keep the set size manageable
        if (this.processed_contracts.size > 100) {
            const first_id = this.processed_contracts.values().next().value;
            if (first_id) this.processed_contracts.delete(first_id);
        }

        console.log('Detected source trade. Mirroring to target accounts...', contract);

        this.target_accounts.forEach(async target => {
            if (target.status === 'Connected' && target.ws) {
                const multiplier = this.is_mirroring_internal ? this.internal_multiplier : 1;
                const original_stake =
                    parseFloat(String(contract.buy_price || (contract as any).stake || (contract as any).amount)) || 1;
                const stake = original_stake * multiplier;

                try {
                    // Step 1: Get proposal on target account
                    const proposal_request = {
                        proposal: 1,
                        amount: stake,
                        basis: 'stake',
                        contract_type: contract.contract_type,
                        currency: target.currency || 'USD',
                        duration: 1,
                        duration_unit: 't',
                        symbol: contract.underlying,
                        barrier: contract.barrier,
                    };

                    target.ws!.send(JSON.stringify(proposal_request));

                    // Wait for proposal response
                    const proposal_response = await new Promise<any>((resolve, reject) => {
                        const handler = (event: MessageEvent) => {
                            const data = JSON.parse(event.data);
                            if (data.msg_type === 'proposal') {
                                target.ws!.removeEventListener('message', handler);
                                resolve(data);
                            } else if (data.error) {
                                target.ws!.removeEventListener('message', handler);
                                reject(data.error);
                            }
                        };
                        target.ws!.addEventListener('message', handler);
                        setTimeout(() => reject(new Error('Proposal timeout')), 5000);
                    });

                    if (proposal_response.error) {
                        console.error('CopyTrader Proposal Error:', proposal_response.error);
                        runInAction(() => {
                            this.trade_history.unshift({
                                timestamp: Date.now(),
                                market: String(contract.underlying),
                                stake: stake,
                                status: 'Failed',
                                message: 'Proposal Error: ' + proposal_response.error.message,
                                target_label: target.label || 'Target',
                            });
                        });
                        return;
                    }

                    const proposal_id = proposal_response.proposal?.id;
                    if (!proposal_id) {
                        return;
                    }

                    // Step 2: Buy the contract on target account
                    const buy_request = {
                        buy: proposal_id,
                        price: stake,
                    };

                    target.ws!.send(JSON.stringify(buy_request));

                    runInAction(() => {
                        target.trades_count = (target.trades_count || 0) + 1;
                        this.trade_history.unshift({
                            timestamp: Date.now(),
                            market: String(contract.underlying),
                            stake: stake,
                            status: 'Success',
                            message: 'Trade copied successfully',
                            target_label: target.label || 'Target',
                            contract_id: proposal_id,
                        });
                    });

                    console.log(
                        `Sent mirror buy request to target account ${target.token.substring(0, 5)} with stake ${stake}...`
                    );
                } catch (error: any) {
                    console.error('CopyTrader mirror error:', error);
                    runInAction(() => {
                        this.trade_history.unshift({
                            timestamp: Date.now(),
                            market: String(contract.underlying),
                            stake: stake,
                            status: 'Failed',
                            message: error.message || 'Unknown Error',
                            target_label: target.label || 'Target',
                        });
                    });
                }
            }
        });
    };

    @action
    setSelectedRealAccount = (loginid: string) => {
        this.selected_real_account_loginid = loginid;
    };

    @action
    startDemoToRealCopy = async () => {
        const { client } = this.root_store;

        if (!this.selected_real_account_loginid) {
            this.demo_to_real_error = 'Please select a real account';
            this.demo_to_real_status = 'error';
            console.error('[Demo to Real] No real account selected');
            return;
        }

        if (!client.is_virtual) {
            this.demo_to_real_error = 'You must be on a demo account to use this feature';
            this.demo_to_real_status = 'error';
            console.error('[Demo to Real] Not on a demo account');
            return;
        }

        this.demo_to_real_status = 'connecting';
        this.demo_to_real_error = '';

        console.log('[Demo to Real] Attempting to get token for account:', this.selected_real_account_loginid);
        console.log('[Demo to Real] Available accounts:', Object.keys(client.accounts));

        // Get token for the selected real account
        const real_token = client.getTokenForAccount(this.selected_real_account_loginid);

        if (!real_token) {
            // Try to get from accounts list
            const accountsList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            console.error('[Demo to Real] Token not found for selected account');
            console.error('[Demo to Real] Selected loginid:', this.selected_real_account_loginid);
            console.error('[Demo to Real] Available tokens:', Object.keys(accountsList));
            console.error('[Demo to Real] AccountsList:', accountsList);

            this.demo_to_real_error =
                'Token not found for selected account. Please make sure you have API tokens enabled for this account.';
            this.demo_to_real_status = 'error';
            return;
        }

        console.log('[Demo to Real] Token retrieved successfully, connecting...');
        // Connect to real account with extracted token
        this.connectRealAccount(real_token);
    };

    @action
    stopDemoToRealCopy = () => {
        if (this.real_account_ws) {
            this.real_account_ws.close();
            this.real_account_ws = null;
        }
        this.is_demo_to_real_active = false;
        this.demo_to_real_status = 'idle';
    };

    @action
    connectRealAccount = (token: string) => {
        if (this.real_account_ws) {
            this.real_account_ws.close();
        }

        const app_id = getAppId();
        const ws = new WebSocket(getPublicWebSocketURL(Number(app_id)));

        this.real_account_ws = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: token }));
        };

        ws.onmessage = msg => {
            const data = JSON.parse(msg.data);

            if (data.error) {
                console.error('Demo to Real Auth Error:', data.error.message);
                runInAction(() => {
                    this.demo_to_real_status = 'error';
                    this.demo_to_real_error = data.error.message;
                });
                return;
            }

            if (data.msg_type === 'authorize') {
                runInAction(() => {
                    this.demo_to_real_status = 'active';
                    this.is_demo_to_real_active = true;
                });
                console.log('Demo to Real account connected successfully');
            }

            // Handle buy response for demo-to-real
            if (data.msg_type === 'buy') {
                console.log('Trade copied to real account:', data);
            }
        };

        ws.onerror = () => {
            runInAction(() => {
                this.demo_to_real_status = 'error';
                this.demo_to_real_error = 'Connection error';
            });
        };

        ws.onclose = () => {
            runInAction(() => {
                if (this.is_demo_to_real_active) {
                    this.demo_to_real_status = 'idle';
                    this.is_demo_to_real_active = false;
                }
            });
        };
    };

    @action
    mirrorTradeToRealAccount = async (contract: ProposalOpenContract) => {
        if (!this.is_demo_to_real_active || !this.real_account_ws) return;

        // Prevent mirroring the same contract ID multiple times to real account
        const contract_id = (contract.contract_id || contract.id) as string | number;
        if (this.processed_contracts.has(`real_${contract_id}`)) return;
        this.processed_contracts.add(`real_${contract_id}`);

        const { client } = this.root_store;
        const original_stake =
            parseFloat(String(contract.buy_price || (contract as any).stake || (contract as any).amount)) || 1;
        const stake = original_stake * this.internal_multiplier;

        try {
            const real_account = client.accounts[this.selected_real_account_loginid];
            const currency = real_account?.currency || 'USD';

            // Step 1: Get proposal on real account
            const proposal_request = {
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: contract.contract_type,
                currency: currency,
                duration: 1,
                duration_unit: 't',
                symbol: contract.underlying,
                barrier: contract.barrier,
            };

            this.real_account_ws.send(JSON.stringify(proposal_request));

            // Wait for proposal response
            const proposal_response = await new Promise<any>((resolve, reject) => {
                const handler = (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.msg_type === 'proposal') {
                        this.real_account_ws!.removeEventListener('message', handler);
                        resolve(data);
                    } else if (data.error) {
                        this.real_account_ws!.removeEventListener('message', handler);
                        reject(data.error);
                    }
                };
                this.real_account_ws!.addEventListener('message', handler);
                setTimeout(() => reject(new Error('Proposal timeout')), 5000);
            });

            if (proposal_response.error) {
                console.error('Demo to Real Proposal Error:', proposal_response.error);
                runInAction(() => {
                    this.trade_history.unshift({
                        timestamp: Date.now(),
                        market: String(contract.underlying),
                        stake: stake,
                        status: 'Failed',
                        message: 'Proposal Error: ' + proposal_response.error.message,
                        target_label: 'Real Account',
                    });
                });
                return;
            }

            const proposal_id = proposal_response.proposal?.id;
            if (!proposal_id) return;

            // Step 2: Buy the contract on real account
            const buy_request = {
                buy: proposal_id,
                price: stake,
            };

            this.real_account_ws.send(JSON.stringify(buy_request));

            runInAction(() => {
                this.trade_history.unshift({
                    timestamp: Date.now(),
                    market: String(contract.underlying),
                    stake: stake,
                    status: 'Success',
                    message: 'Trade copied to real account',
                    target_label: 'Real Account',
                    contract_id: proposal_id,
                });
            });

            console.log(`Copied trade to real account with stake ${stake}`);
        } catch (error: any) {
            console.error('Demo to Real mirror error:', error);
            runInAction(() => {
                this.trade_history.unshift({
                    timestamp: Date.now(),
                    market: String(contract.underlying),
                    stake: stake,
                    status: 'Failed',
                    message: error.message || 'Unknown Error',
                    target_label: 'Real Account',
                });
            });
        }
    };
}
