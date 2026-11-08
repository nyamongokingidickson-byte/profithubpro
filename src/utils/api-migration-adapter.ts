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

const stripUndefined = <T extends Record<string, any>>(obj: T): T => {
    const cleaned: Record<string, any> = {};
    Object.keys(obj).forEach(key => {
        if (obj[key] !== undefined) {
            cleaned[key] = obj[key];
        }
    });
    return cleaned as T;
};

/**
 * Transform legacy buy request to new API format
 * Removes: loginid, passthrough; normalizes direct buy parameters (symbol → underlying_symbol, string barrier, selected_tick)
 */
export const transformBuyRequest = (
    legacyRequest: any
): any => {
    const { loginid, passthrough, parameters, ...rest } = legacyRequest;

    const normalizedPrice =
        rest.price !== undefined && Number.isFinite(Number(rest.price)) ? Number(rest.price) : rest.price;

    if (!parameters || typeof parameters !== 'object') {
        return stripUndefined({
            ...rest,
            ...(normalizedPrice !== undefined ? { price: normalizedPrice } : {}),
        });
    }

    const {
        symbol,
        underlying_symbol,
        loginid: _paramLoginId,
        passthrough: _paramPassthrough,
        app_markup_percentage,
        barrier_range,
        product_type,
        date_start,
        trade_risk_profile,
        trading_period_start,
        barrier,
        barrier2,
        selected_tick,
        ...restParams
    } = parameters;

    const contractType = restParams.contract_type;
    const isHighLowTick = ['TICKHIGH', 'TICKLOW'].includes(contractType);
    const resolvedUnderlying = underlying_symbol ?? symbol;

    const normalizedParams = stripUndefined({
        ...restParams,
        ...(resolvedUnderlying ? { underlying_symbol: resolvedUnderlying } : {}),
        ...(isHighLowTick && selected_tick !== undefined ? { selected_tick: Number(selected_tick) } : {}),
        ...(!isHighLowTick && barrier !== undefined && barrier !== null ? { barrier: String(barrier) } : {}),
        ...(!isHighLowTick && barrier2 !== undefined && barrier2 !== null ? { barrier2: String(barrier2) } : {}),
    });

    return stripUndefined({
        ...rest,
        ...(normalizedPrice !== undefined ? { price: normalizedPrice } : {}),
        parameters: normalizedParams,
    });
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
 * Changes: symbol → underlying_symbol, barrier → string, strips selected_tick for non-tickhigh/low
 * Removes: passthrough, loginid, barrier_range, product_type, date_start, trade_risk_profile, trading_period_start
 */
export const transformProposalRequest = (
    legacyRequest: any
): any => {
    const {
        symbol,
        underlying_symbol,
        passthrough,
        loginid,
        barrier_range,
        product_type,
        date_start,
        trade_risk_profile,
        trading_period_start,
        barrier,
        barrier2,
        selected_tick,
        ...newRequest
    } = legacyRequest;

    const contractType = newRequest.contract_type;
    const isHighLowTick = ['TICKHIGH', 'TICKLOW'].includes(contractType);
    const resolvedUnderlying = underlying_symbol ?? symbol;

    return stripUndefined({
        ...newRequest,
        ...(resolvedUnderlying ? { underlying_symbol: resolvedUnderlying } : {}),
        ...(isHighLowTick && selected_tick !== undefined ? { selected_tick: Number(selected_tick) } : {}),
        ...(!isHighLowTick && barrier !== undefined && barrier !== null ? { barrier: String(barrier) } : {}),
        ...(!isHighLowTick && barrier2 !== undefined && barrier2 !== null ? { barrier2: String(barrier2) } : {}),
    });
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

const MARKET_DISPLAY_NAMES: Record<string, string> = {
    synthetic_index: 'Derived',
    forex: 'Forex',
    indices: 'Stock Indices',
    commodities: 'Commodities',
    cryptocurrency: 'Cryptocurrencies',
    basket_index: 'Baskets',
};

const SUBMARKET_DISPLAY_NAMES: Record<string, string> = {
    random_index: 'Continuous Indices',
    random_daily: 'Daily Reset Indices',
    crash_index: 'Crash/Boom Indices',
    crash_boom: 'Crash/Boom Indices',
    jump_index: 'Jump Indices',
    step_index: 'Step Indices',
    range_break: 'Range Break Indices',
    major_pairs: 'Major Pairs',
    minor_pairs: 'Minor Pairs',
    smart_fx: 'Smart FX',
    americas: 'Americas',
    asia_oceania: 'Asia/Oceania',
    europe_africa: 'Europe',
    metals: 'Metals',
    energy: 'Energy',
    non_stable_coin: 'Cryptocurrencies',
};

const SYMBOL_DISPLAY_NAMES: Record<string, string> = {
    R_10: 'Volatility 10 Index',
    R_25: 'Volatility 25 Index',
    R_50: 'Volatility 50 Index',
    R_75: 'Volatility 75 Index',
    R_100: 'Volatility 100 Index',
    '1HZ10V': 'Volatility 10 (1s) Index',
    '1HZ15V': 'Volatility 15 (1s) Index',
    '1HZ25V': 'Volatility 25 (1s) Index',
    '1HZ30V': 'Volatility 30 (1s) Index',
    '1HZ50V': 'Volatility 50 (1s) Index',
    '1HZ75V': 'Volatility 75 (1s) Index',
    '1HZ90V': 'Volatility 90 (1s) Index',
    '1HZ100V': 'Volatility 100 (1s) Index',
    '1HZ150V': 'Volatility 150 (1s) Index',
    '1HZ200V': 'Volatility 200 (1s) Index',
    '1HZ250V': 'Volatility 250 (1s) Index',
    '1HZ300V': 'Volatility 300 (1s) Index',
    JD10: 'Jump 10 Index',
    JD25: 'Jump 25 Index',
    JD50: 'Jump 50 Index',
    JD75: 'Jump 75 Index',
    JD100: 'Jump 100 Index',
    BOOM300N: 'Boom 300 Index',
    BOOM500: 'Boom 500 Index',
    BOOM600: 'Boom 600 Index',
    BOOM900: 'Boom 900 Index',
    BOOM1000: 'Boom 1000 Index',
    CRASH300N: 'Crash 300 Index',
    CRASH500: 'Crash 500 Index',
    CRASH600: 'Crash 600 Index',
    CRASH900: 'Crash 900 Index',
    CRASH1000: 'Crash 1000 Index',
    stpRNG: 'Step Index',
    stpRNG2: 'Step Index 200',
    stpRNG3: 'Step Index 300',
    stpRNG4: 'Step Index 400',
    stpRNG5: 'Step Index 500',
    RDBEAR: 'Bear Market Index',
    RDBULL: 'Bull Market Index',
};

const humanizeCode = (code?: string): string => {
    if (!code) return '';
    return code
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
};

/**
 * Transform new active_symbols response to include legacy field names
 * Preserves existing fields when public v3 WS format is already used.
 */
export const transformActiveSymbolsResponse = (
    newResponse: any
): any => {
    if (!Array.isArray(newResponse?.active_symbols)) return newResponse;

    return {
        ...newResponse,
        active_symbols: newResponse.active_symbols.map((item: any) => {
            const resolvedSymbol = item.underlying_symbol ?? item.symbol ?? '';
            const resolvedMarket = item.market ?? 'synthetic_index';
            const resolvedSubmarket = item.submarket ?? 'random_index';
            const resolvedPip = item.pip_size ?? item.pip ?? 0.01;
            const resolvedDisplayName =
                item.display_name ??
                item.underlying_symbol_name ??
                SYMBOL_DISPLAY_NAMES[resolvedSymbol] ??
                resolvedSymbol;

            return {
                ...item,
                symbol: resolvedSymbol,
                underlying_symbol: resolvedSymbol,
                symbol_type: item.underlying_symbol_type ?? item.symbol_type ?? resolvedMarket,
                display_name: resolvedDisplayName,
                market: resolvedMarket,
                market_display_name:
                    item.market_display_name ??
                    MARKET_DISPLAY_NAMES[resolvedMarket] ??
                    humanizeCode(resolvedMarket),
                submarket: resolvedSubmarket,
                submarket_display_name:
                    item.submarket_display_name ??
                    SUBMARKET_DISPLAY_NAMES[resolvedSubmarket] ??
                    humanizeCode(resolvedSubmarket),
                pip: resolvedPip,
                pip_size: resolvedPip,
                exchange_is_open: item.exchange_is_open ?? 1,
                is_trading_suspended: item.is_trading_suspended ?? 0,
            };
        }),
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
 * Transform new buy response
 * Normalizes numeric strings and ensures transaction_id is always populated
 */
export const transformBuyResponse = (
    newResponse: any
): any => {
    if (!newResponse.buy) return newResponse;

    const { buy } = newResponse;
    const toNum = (val: any) => (typeof val === 'string' && val.trim() !== '' ? parseFloat(val) : val);

    return {
        ...newResponse,
        buy: {
            ...buy,
            buy_price: toNum(buy.buy_price),
            payout: toNum(buy.payout),
            balance_after: toNum(buy.balance_after),
            transaction_id: buy.transaction_id ?? buy.contract_id,
            longcode: buy.longcode ?? '',
        },
    };
};

/**
 * Transform new proposal_open_contract response
 * Handle string | number fields and deprecated fields required by Bot Engine & Summary/Transactions UI
 */
export const transformProposalOpenContractResponse = (
    newResponse: any
): any => {
    if (!newResponse.proposal_open_contract) return newResponse;
    
    const { proposal_open_contract: poc } = newResponse;
    const toNum = (val: any) => (typeof val === 'string' && val.trim() !== '' ? parseFloat(val) : val);

    const buyPrice = toNum(poc.buy_price);
    const bidPrice = toNum(poc.bid_price);
    const rawSellPrice = toNum(poc.sell_price);
    const profit = toNum(poc.profit);
    const payout = toNum(poc.payout);
    const currentSpot = toNum(poc.current_spot);
    const entrySpot = toNum(poc.entry_tick ?? poc.entry_spot);
    const exitSpot = toNum(poc.exit_tick ?? poc.exit_spot ?? poc.sell_spot);

    const isSold = Boolean(
        poc.is_sold ||
            poc.status === 'sold' ||
            poc.status === 'won' ||
            poc.status === 'lost'
    );

    const resolvedSellPrice =
        rawSellPrice !== undefined
            ? rawSellPrice
            : isSold && typeof buyPrice === 'number' && typeof profit === 'number'
              ? buyPrice + profit
              : isSold && typeof bidPrice === 'number'
                ? bidPrice
                : rawSellPrice;

    const resolvedSymbol = poc.symbol ?? poc.underlying_symbol ?? poc.underlying;
    const existingTxIds = poc.transaction_ids ?? {};
    const resolvedTxIds = {
        ...existingTxIds,
        buy: existingTxIds.buy ?? poc.transaction_id ?? poc.contract_id,
        ...(existingTxIds.sell
            ? { sell: existingTxIds.sell }
            : isSold
              ? { sell: poc.sell_transaction ?? poc.contract_id }
              : {}),
    };

    return {
        ...newResponse,
        proposal_open_contract: {
            ...poc,
            symbol: resolvedSymbol,
            underlying: poc.underlying ?? resolvedSymbol,
            underlying_symbol: poc.underlying_symbol ?? resolvedSymbol,
            bid_price: bidPrice,
            buy_price: buyPrice,
            sell_price: resolvedSellPrice,
            current_spot: currentSpot,
            profit,
            payout,
            is_sold: isSold ? 1 : 0,
            entry_spot: entrySpot,
            entry_tick: entrySpot,
            entry_tick_display_value: poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? (entrySpot !== undefined ? String(entrySpot) : undefined),
            entry_tick_time: poc.entry_tick_time ?? poc.entry_spot_time ?? poc.date_start,
            exit_spot: exitSpot,
            exit_tick: exitSpot ?? (isSold ? currentSpot : undefined),
            exit_tick_display_value: poc.exit_tick_display_value ?? poc.exit_spot_display_value ?? poc.sell_spot_display_value ?? (exitSpot !== undefined ? String(exitSpot) : undefined),
            exit_tick_time: poc.exit_tick_time ?? poc.exit_spot_time ?? poc.sell_spot_time ?? poc.sell_time,
            transaction_ids: resolvedTxIds,
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
        case 'buy':
            return transformBuyResponse(response);
        case 'proposal':
            return transformProposalResponse(response);
        case 'proposal_open_contract':
            return transformProposalOpenContractResponse(response);
        default:
            return response;
    }
};
