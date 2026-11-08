import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import { observer as globalObserver } from '../../../utils/observer';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;
                const txId = buy.transaction_id ?? buy.contract_id;
                const activeAccountId =
                    this.accountInfo?.loginid ||
                    api_base.account_info?.loginid ||
                    localStorage.getItem('active_loginid') ||
                    '';

                contractStatus({
                    id: 'contract.purchase_received',
                    data: txId,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                // Explicitly subscribe to proposal_open_contract for this contract_id
                // so Deriv Options V1 streams live & final settlement updates reliably.
                if (buy.contract_id && api_base.api) {
                    api_base.api
                        .send({
                            proposal_open_contract: 1,
                            contract_id: buy.contract_id,
                            subscribe: 1,
                        })
                        .catch(err => {
                            console.warn('[Purchase] proposal_open_contract subscribe fallback:', err);
                        });
                }

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode || '', transaction_id: txId });
                info({
                    accountID: activeAccountId,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: txId },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                // Emit replication hook with parameters when we are about to buy by proposal id
                try {
                    globalObserver.emit('replicator.purchase', {
                        mode: 'proposal_id',
                        request: { buy: id, price: askPrice },
                        tradeOptions: this.tradeOptions,
                        contract_type,
                        account_id: this.accountInfo?.loginid,
                    });
                } catch {}

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

            // Emit replication hook with full buy parameters (non-proposal)
            try {
                globalObserver.emit('replicator.purchase', {
                    mode: 'parameters',
                    request: trade_option,
                    tradeOptions: this.tradeOptions,
                    contract_type,
                    account_id: this.accountInfo?.loginid,
                });
            } catch {}

            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
