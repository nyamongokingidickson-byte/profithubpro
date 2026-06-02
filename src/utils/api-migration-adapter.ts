/**
 * API Migration Adapter: Legacy API → New API (v4)
 * Handles transformation of requests and responses between legacy and new API formats
 * Reference: https://developers.deriv.com/comparison/
 */

// ============================================================================
// REQUEST TRANSFORMATIONS (Legacy → New)
// ============================================================================

/**
 * Transform legacy active_symbols request to new API format
 * Removes: product_type, landing_company_short, landing_company, loginid, barrier_category
 */
export const transformActiveSymbolsRequest = (
    legacyRequest: any
): any => {
    const { product_type, landing_company_short, landing_company, loginid, barrier_category, ...newRequest } = legacyRequest;
    
    // Only keep: active_symbols (required), contract_type (optional)
    return {
        active_symbols: newRequest.active_symbols,
        ...(newRequest.contract_type && { contract_type: newRequest.contract_type }),
    };
};

/**
 * Transform legacy contracts_for request to new API format
 * Removes: currency, landing_company_short, product_type, loginid
 */
export const transformContractsForRequest = (
    legacyRequest: any
): any => {
    const { currency, landing_company_short, product_type, loginid, ...newRequest } = legacyRequest;
    
    // Only keep: contracts_for (required)
    return {
        contracts_for: newRequest.contracts_for,
    };
};

/**
 * Transform legacy ticks request to new API format
 * subscribe can now be 0 (single tick) or 1 (continuous)
 */
export const transformTicksRequest = (
    legacyRequest: any
): any => {
    return {
        ticks: legacyRequest.ticks,
        subscribe: legacyRequest.subscribe ?? 1, // Default to 1 for backwards compatibility
    };
};

/**
 * Transform legacy ticks_history request to new API format
 * Accepts any granularity value (not restricted to enum)
 */
export const transformTicksHistoryRequest = (
    legacyRequest: any
): any => {
    const { adjust_start_time, subscribe, ...request } = legacyRequest;
    
    return {
        ...request,
        adjust_start_time: adjust_start_time ?? 1,
        subscribe: subscribe ?? 1,
    };
};

/**
 * Transform legacy balance request to new API format
 * Removes: account, loginid parameters (multi-account no longer supported)
 */
export const transformBalanceRequest = (
    legacyRequest: any
): any => {
    const { account, loginid, ...newRequest } = legacyRequest;
    
    return {
        balance: newRequest.balance,
        subscribe: newRequest.subscribe ?? 1,
    };
};

/**
 * Transform legacy portfolio request to new API format
 * Removes: loginid parameter
 */
export const transformPortfolioRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy profit_table request to new API format
 * Removes: loginid parameter
 */
export const transformProfitTableRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy statement request to new API format
 * Removes: loginid parameter
 */
export const transformStatementRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy transaction request to new API format
 * Removes: loginid parameter
 */
export const transformTransactionRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy buy request to new API format
 * Removes: loginid parameter
 */
export const transformBuyRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy cancel request to new API format
 * Removes: loginid parameter
 */
export const transformCancelRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy contract_update request to new API format
 * Removes: loginid parameter
 */
export const transformContractUpdateRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy contract_update_history request to new API format
 * Removes: loginid parameter
 */
export const transformContractUpdateHistoryRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy proposal request to new API format
 * Changes: symbol → underlying_symbol
 * Removes: loginid, barrier_range, product_type, date_start, trade_risk_profile, trading_period_start
 */
export const transformProposalRequest = (
    legacyRequest: any
): any => {
    const {
        symbol,
        loginid,
        barrier_range,
        product_type,
        date_start,
        trade_risk_profile,
        trading_period_start,
        ...newRequest
    } = legacyRequest;
    
    return {
        ...newRequest,
        ...(symbol && { underlying_symbol: symbol }),
    };
};

/**
 * Transform legacy proposal_open_contract request to new API format
 * Removes: loginid parameter
 */
export const transformProposalOpenContractRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    return newRequest;
};

/**
 * Transform legacy sell request to new API format
 * Removes: loginid parameter
 * Validates: price must be >= 0
 */
export const transformSellRequest = (
    legacyRequest: any
): any => {
    const { loginid, ...newRequest } = legacyRequest;
    
    // Validate price
    if (newRequest.price !== undefined && newRequest.price < 0) {
        throw new Error('Sell price must be >= 0');
    }
    
    return newRequest;
};

/**
 * Transform legacy forget request to new API format
 */
export const transformForgetRequest = (
    legacyRequest: any
): any => {
    return legacyRequest;
};

/**
 * Transform legacy forget_all request to new API format
 */
export const transformForgetAllRequest = (
    legacyRequest: any
): any => {
    return legacyRequest;
};

// ============================================================================
// RESPONSE TRANSFORMATIONS (New → Legacy-compatible format, or vice versa)
// ============================================================================

/**
 * Transform new active_symbols response to include legacy field names
 * symbol ← underlying_symbol
 * symbol_type ← underlying_symbol_type
 * display_name ← underlying_symbol_name
 * pip ← pip_size
 */
export const transformActiveSymbolsResponse = (
    newResponse: any
): any => {
    if (!newResponse.active_symbols) return newResponse;
    
    return {
        ...newResponse,
        active_symbols: newResponse.active_symbols.map((symbol: any) => ({
            ...symbol,
            // Add legacy field names for backwards compatibility
            symbol: symbol.underlying_symbol,
            symbol_type: symbol.underlying_symbol_type,
            display_name: symbol.underlying_symbol_name,
            pip: symbol.pip_size,
        })),
    };
};

/**
 * Transform new contracts_for response to include legacy field names
 */
export const transformContractsForResponse = (
    newResponse: any
): any => {
    if (!newResponse.contracts_for?.available) return newResponse;
    
    return {
        ...newResponse,
        contracts_for: {
            ...newResponse.contracts_for,
            available: newResponse.contracts_for.available.map((contract: any) => ({
                ...contract,
                // No direct legacy equivalents removed in this endpoint
            })),
        },
    };
};

/**
 * Transform new ticks response to handle required fields
 * Ensures epoch, quote, symbol are present
 */
export const transformTicksResponse = (
    newResponse: any
): any => {
    if (!newResponse.tick) return newResponse;
    
    const { tick } = newResponse;
    
    // In new API: epoch, quote, symbol are required
    // pip_size is now optional
    return {
        ...newResponse,
        tick: {
            ...tick,
            // Ensure required fields exist
            epoch: tick.epoch ?? Math.floor(Date.now() / 1000),
            quote: tick.quote ?? tick.ask ?? 0,
            symbol: tick.symbol,
        },
    };
};

/**
 * Transform new balance response to include legacy multi-account structure
 * New API returns only current account balance
 */
export const transformBalanceResponse = (
    newResponse: any
): any => {
    if (!newResponse.balance) return newResponse;
    
    const { balance } = newResponse;
    
    return {
        ...newResponse,
        balance: {
            ...balance,
            // For backwards compatibility, create accounts object with single entry
            accounts: {
                [balance.loginid]: {
                    balance: balance.balance,
                    currency: balance.currency,
                    demo_account: 0,
                    type: 'deriv',
                },
            },
        },
    };
};

/**
 * Transform new portfolio response to include legacy field names
 * underlying_symbol → symbol
 */
export const transformPortfolioResponse = (
    newResponse: any
): any => {
    if (!newResponse.portfolio?.contracts) return newResponse;
    
    return {
        ...newResponse,
        portfolio: {
            ...newResponse.portfolio,
            contracts: newResponse.portfolio.contracts.map((contract: any) => ({
                ...contract,
                symbol: contract.underlying_symbol,
            })),
        },
    };
};

/**
 * Transform new transaction response to include legacy field names
 * underlying_symbol → symbol
 */
export const transformTransactionResponse = (
    newResponse: any
): any => {
    if (!newResponse.transaction) return newResponse;
    
    return {
        ...newResponse,
        transaction: {
            ...newResponse.transaction,
            symbol: newResponse.transaction.underlying_symbol,
        },
    };
};

/**
 * Transform new proposal response
 * Handle ask_price and payout as string | number
 */
export const transformProposalResponse = (
    newResponse: any
): any => {
    if (!newResponse.proposal) return newResponse;
    
    const { proposal } = newResponse;
    
    return {
        ...newResponse,
        proposal: {
            ...proposal,
            ask_price: typeof proposal.ask_price === 'string' ? parseFloat(proposal.ask_price) : proposal.ask_price,
            payout: typeof proposal.payout === 'string' ? parseFloat(proposal.payout) : proposal.payout,
        },
    };
};

/**
 * Transform new proposal_open_contract response
 * Handle string | number fields and deprecated fields
 */
export const transformProposalOpenContractResponse = (
    newResponse: any
): any => {
    if (!newResponse.proposal_open_contract) return newResponse;
    
    const { proposal_open_contract } = newResponse;
    
    return {
        ...newResponse,
        proposal_open_contract: {
            ...proposal_open_contract,
            bid_price: typeof proposal_open_contract.bid_price === 'string' 
                ? parseFloat(proposal_open_contract.bid_price) 
                : proposal_open_contract.bid_price,
            buy_price: typeof proposal_open_contract.buy_price === 'string' 
                ? parseFloat(proposal_open_contract.buy_price) 
                : proposal_open_contract.buy_price,
            current_spot: typeof proposal_open_contract.current_spot === 'string' 
                ? parseFloat(proposal_open_contract.current_spot) 
                : proposal_open_contract.current_spot,
            profit: typeof proposal_open_contract.profit === 'string' 
                ? parseFloat(proposal_open_contract.profit) 
                : proposal_open_contract.profit,
            payout: typeof proposal_open_contract.payout === 'string' 
                ? parseFloat(proposal_open_contract.payout) 
                : proposal_open_contract.payout,
            // Map new field names to legacy for backwards compatibility
            exit_spot: proposal_open_contract.exit_spot ?? proposal_open_contract.sell_spot,
            exit_spot_time: proposal_open_contract.exit_spot_time ?? proposal_open_contract.sell_spot_time,
        },
    };
};

/**
 * Master transformation dispatcher
 */
export const transformRequest = (
    request: any,
    msgType: string
): any => {
    switch (msgType) {
        case 'active_symbols':
            return transformActiveSymbolsRequest(request);
        case 'contracts_for':
            return transformContractsForRequest(request);
        case 'ticks':
            return transformTicksRequest(request);
        case 'ticks_history':
            return transformTicksHistoryRequest(request);
        case 'balance':
            return transformBalanceRequest(request);
        case 'portfolio':
            return transformPortfolioRequest(request);
        case 'profit_table':
            return transformProfitTableRequest(request);
        case 'statement':
            return transformStatementRequest(request);
        case 'transaction':
            return transformTransactionRequest(request);
        case 'buy':
            return transformBuyRequest(request);
        case 'cancel':
            return transformCancelRequest(request);
        case 'contract_update':
            return transformContractUpdateRequest(request);
        case 'contract_update_history':
            return transformContractUpdateHistoryRequest(request);
        case 'proposal':
            return transformProposalRequest(request);
        case 'proposal_open_contract':
            return transformProposalOpenContractRequest(request);
        case 'sell':
            return transformSellRequest(request);
        case 'forget':
            return transformForgetRequest(request);
        case 'forget_all':
            return transformForgetAllRequest(request);
        default:
            return request;
    }
};

/**
 * Master response transformation dispatcher
 * Set enableBackwardsCompat to true to get legacy-compatible responses
 */
export const transformResponse = (
    response: any,
    msgType: string,
    enableBackwardsCompat: boolean = true
): any => {
    if (!enableBackwardsCompat) return response;
    
    switch (msgType) {
        case 'active_symbols':
            return transformActiveSymbolsResponse(response);
        case 'contracts_for':
            return transformContractsForResponse(response);
        case 'tick':
            return transformTicksResponse(response);
        case 'balance':
            return transformBalanceResponse(response);
        case 'portfolio':
            return transformPortfolioResponse(response);
        case 'transaction':
            return transformTransactionResponse(response);
        case 'proposal':
            return transformProposalResponse(response);
        case 'proposal_open_contract':
            return transformProposalOpenContractResponse(response);
        default:
            return response;
    }
};
