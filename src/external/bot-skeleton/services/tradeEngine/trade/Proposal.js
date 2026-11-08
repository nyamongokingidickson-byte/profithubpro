import { localize } from '@deriv-com/translations';
import { api_base } from '../../api/api-base';
import { doUntilDone, tradeOptionToProposal } from '../utils/helpers';
import { clearProposals, proposalsReady } from './state/actions';

export default Engine =>
    class Proposal extends Engine {
        makeProposals(trade_option) {
            if (!this.isNewTradeOption(trade_option)) {
                return;
            }

            // Generate a purchase reference when trade options are different from previous trade options.
            // This will ensure the bot doesn't mistakenly purchase the wrong proposal.
            this.regeneratePurchaseReference();
            this.trade_option = trade_option;
            this.proposal_templates = tradeOptionToProposal(trade_option, this.getPurchaseReference());
            this.renewProposalsOnPurchase();
        }

        selectProposal(contract_type) {
            const { proposals } = this.data;

            if (proposals.length === 0) {
                throw Error(localize('Proposals are not ready'));
            }

            const to_buy = proposals.find(proposal => {
                if (
                    proposal.contract_type === contract_type &&
                    proposal.purchase_reference === this.getPurchaseReference()
                ) {
                    // Below happens when a user has had one of the proposals return
                    // with a ContractBuyValidationError. We allow the logic to continue
                    // to here cause the opposite proposal may still be valid. Only once
                    // they attempt to purchase the errored proposal we will intervene.
                    if (proposal.error) {
                        throw proposal.error;
                    }

                    return proposal;
                }

                return false;
            });

            if (!to_buy) {
                throw new Error(localize('Selected proposal does not exist'));
            }

            return {
                id: to_buy.id,
                askPrice: to_buy.ask_price,
            };
        }

        renewProposalsOnPurchase() {
            this.data.proposals = [];
            this.store.dispatch(clearProposals());
            this.requestProposals();
        }

        requestProposals() {
            // Since there are two proposals (in most cases), an error may be logged twice, to avoid this
            // flip this boolean on error.
            let has_informed_error = false;
            const current_ref = this.getPurchaseReference();

            Promise.all(
                this.proposal_templates.map(proposal => {
                    const expected_contract_type = proposal.passthrough?.contract_type || proposal.contract_type;
                    const expected_reference = proposal.passthrough?.purchase_reference || current_ref;

                    return doUntilDone(() => api_base.api.send(proposal))
                        .then(response => {
                            const resData = response?.data ?? response;
                            const receivedProposal = resData?.proposal;
                            if (
                                receivedProposal &&
                                this.data.proposals.findIndex(
                                    p =>
                                        p.id === receivedProposal.id ||
                                        (p.contract_type === expected_contract_type &&
                                            p.purchase_reference === expected_reference)
                                ) === -1
                            ) {
                                this.data.proposals.push({
                                    ...receivedProposal,
                                    ...(resData?.passthrough || {}),
                                    contract_type:
                                        resData?.passthrough?.contract_type ||
                                        resData?.echo_req?.contract_type ||
                                        expected_contract_type,
                                    purchase_reference:
                                        resData?.passthrough?.purchase_reference || expected_reference,
                                });
                                this.checkProposalReady();
                            }
                            return response;
                        })
                        .catch(error => {
                            // We intercept ContractBuyValidationError as user may have specified
                            // e.g. a DIGITUNDER 0 or DIGITOVER 9, while one proposal may be invalid
                            // the other is valid. We will error on Purchase rather than here.
                            if (error?.error?.code === 'ContractBuyValidationError') {
                                this.data.proposals.push({
                                    ...(error?.error?.echo_req || error?.echo_req || {}),
                                    ...(error?.echo_req?.passthrough || proposal.passthrough || {}),
                                    contract_type: expected_contract_type,
                                    purchase_reference: expected_reference,
                                    error,
                                });
                                this.checkProposalReady();
                                return null;
                            }
                            if (!has_informed_error) {
                                has_informed_error = true;
                                this.$scope.observer.emit('Error', error?.error || error);
                            }
                            return null;
                        });
                })
            );
        }

        observeProposals() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(response => {
                if (response?.data?.msg_type === 'proposal') {
                    const { passthrough, proposal, echo_req } = response.data;
                    const resolvedContractType =
                        passthrough?.contract_type || echo_req?.contract_type || proposal?.contract_type;
                    const resolvedRef = passthrough?.purchase_reference || this.getPurchaseReference();

                    if (
                        proposal &&
                        resolvedContractType &&
                        this.data.proposals.findIndex(
                            p =>
                                p.id === proposal.id ||
                                (p.contract_type === resolvedContractType && p.purchase_reference === resolvedRef)
                        ) === -1
                    ) {
                        this.data.proposals.push({
                            ...proposal,
                            ...(passthrough || {}),
                            contract_type: resolvedContractType,
                            purchase_reference: resolvedRef,
                        });
                        this.checkProposalReady();
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        checkProposalReady() {
            // Proposals are considered ready when the proposals in our memory match the ones
            // we've requested from the API, we determine this by checking the passthrough of the response.
            const { proposals } = this.data;

            if (proposals.length > 0 && this.proposal_templates) {
                const has_equal_proposals = this.proposal_templates.every(template => {
                    return (
                        proposals.findIndex(proposal => {
                            return (
                                proposal.purchase_reference === template.passthrough.purchase_reference &&
                                proposal.contract_type === template.contract_type
                            );
                        }) !== -1
                    );
                });

                if (has_equal_proposals) {
                    this.startPromise.then(() => this.store.dispatch(proposalsReady()));
                }
            }
        }

        isNewTradeOption(trade_option) {
            if (!this.trade_option) {
                this.trade_option = trade_option;
                return true;
            }

            // Compare incoming "trade_option" argument with "this.trade_option", if any
            // of the values is different, this is a new tradeOption and new proposals
            // should be generated.
            return [
                'amount',
                'barrierOffset',
                'basis',
                'duration',
                'duration_unit',
                'prediction',
                'secondBarrierOffset',
                'symbol',
            ].some(value => this.trade_option[value] !== trade_option[value]);
        }
    };
