import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { startLogin } from '@/lib/auth';
import { localize } from '@deriv-com/translations';
import './dtrader.scss';

type TTradeFamily = 'over_under' | 'even_odd' | 'match_diff' | 'rise_fall' | 'higher_lower';
type TDurationUnit = 't' | 's' | 'm';
type TBasis = 'stake' | 'payout';

interface TMarketItem {
    symbol: string;
    display_name: string;
    market: string;
    market_display_name: string;
    submarket_display_name: string;
    pip: number;
}

interface TDirectionOption {
    contractType: string;
    iconType: string;
    label: string;
    variant: 'up' | 'down';
}

interface TQuoteInfo {
    id: string;
    askPrice: number;
    payout: number;
    longcode: string;
    spot?: number;
    createdAt: number;
    error?: string;
}

interface TTrackedContract {
    contract_id: number;
    contract_type?: string;
    symbol?: string;
    longcode?: string;
    buy_price: number;
    bid_price?: number;
    sell_price?: number;
    payout?: number;
    profit?: number;
    currency: string;
    entry_spot?: number;
    current_spot?: number;
    exit_spot?: number;
    tick_count?: number;
    current_tick?: number;
    barrier?: string;
    is_valid_to_sell?: number | boolean;
    is_sold?: number | boolean;
    status?: string;
    date_start?: number;
    settledAt?: number;
}

const DEFAULT_TICK_COUNT = 1000;
const QUOTE_FRESH_MS = 12000;
const DIGIT_CIRCUMFERENCE = 339.292; // 2 * Math.PI * 54

const FALLBACK_MARKETS: TMarketItem[] = [
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.0001 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.0001 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.001 },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.01 },
    { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index', market_display_name: 'Derived', submarket_display_name: 'Continuous Indices', pip: 0.001 },
];

const TRADE_TYPE_META: {
    id: TTradeFamily;
    label: string;
    category: 'Digits' | 'Up/Down';
    icons: [string, string];
    isDigits: boolean;
    description: string;
    winRule: string;
}[] = [
    {
        id: 'match_diff',
        label: 'Matches/Differs',
        category: 'Digits',
        icons: ['DIGITMATCH', 'DIGITDIFF'],
        isDigits: true,
        description:
            'Predict whether the last digit of the final tick of the contract will match or differ from your selected digit (0–9).',
        winRule:
            'Select "Matches" if you expect the final tick’s last digit to equal your prediction, or "Differs" if you expect any of the other 9 digits.',
    },
    {
        id: 'even_odd',
        label: 'Even/Odd',
        category: 'Digits',
        icons: ['DIGITEVEN', 'DIGITODD'],
        isDigits: true,
        description:
            'Predict whether the last digit of the final tick of the contract will be an even number (0, 2, 4, 6, 8) or an odd number (1, 3, 5, 7, 9).',
        winRule:
            'Select "Even" to win on 0, 2, 4, 6, or 8, or select "Odd" to win on 1, 3, 5, 7, or 9.',
    },
    {
        id: 'over_under',
        label: 'Over/Under',
        category: 'Digits',
        icons: ['DIGITOVER', 'DIGITUNDER'],
        isDigits: true,
        description:
            'Predict whether the last digit of the final tick of the contract will be strictly greater than (Over) or strictly less than (Under) your selected digit (0–9).',
        winRule:
            'Select "Over" to win if the exit spot’s last digit is higher than your prediction, or "Under" to win if it is lower.',
    },
    {
        id: 'rise_fall',
        label: 'Rise/Fall',
        category: 'Up/Down',
        icons: ['CALL', 'PUT'],
        isDigits: false,
        description:
            'Predict whether the exit spot at the end of the contract will be higher (Rise) or lower (Fall) than the entry spot.',
        winRule:
            'Select "Rise" if the market will close above the entry spot (or equal if Allow equals is enabled), or "Fall" if it will close below.',
    },
    {
        id: 'higher_lower',
        label: 'Higher/Lower',
        category: 'Up/Down',
        icons: ['CALL', 'PUT'],
        isDigits: false,
        description:
            'Predict whether the exit spot at expiry will finish strictly higher or strictly lower than a target barrier price.',
        winRule:
            'Set your barrier offset and select "Higher" if exit spot finishes above the barrier, or "Lower" if it finishes below.',
    },
];

const getDirectionsForFamily = (family: TTradeFamily, allowEquals: boolean): [TDirectionOption, TDirectionOption] => {
    switch (family) {
        case 'over_under':
            return [
                { contractType: 'DIGITOVER', iconType: 'DIGITOVER', label: 'Over', variant: 'up' },
                { contractType: 'DIGITUNDER', iconType: 'DIGITUNDER', label: 'Under', variant: 'down' },
            ];
        case 'even_odd':
            return [
                { contractType: 'DIGITEVEN', iconType: 'DIGITEVEN', label: 'Even', variant: 'up' },
                { contractType: 'DIGITODD', iconType: 'DIGITODD', label: 'Odd', variant: 'down' },
            ];
        case 'match_diff':
            return [
                { contractType: 'DIGITMATCH', iconType: 'DIGITMATCH', label: 'Matches', variant: 'up' },
                { contractType: 'DIGITDIFF', iconType: 'DIGITDIFF', label: 'Differs', variant: 'down' },
            ];
        case 'higher_lower':
            return [
                { contractType: 'CALL', iconType: 'CALL', label: 'Higher', variant: 'up' },
                { contractType: 'PUT', iconType: 'PUT', label: 'Lower', variant: 'down' },
            ];
        case 'rise_fall':
        default:
            return [
                {
                    contractType: allowEquals ? 'CALLE' : 'CALL',
                    iconType: 'CALL',
                    label: 'Rise',
                    variant: 'up',
                },
                {
                    contractType: allowEquals ? 'PUTE' : 'PUT',
                    iconType: 'PUT',
                    label: 'Fall',
                    variant: 'down',
                },
            ];
    }
};

const pipToDecimals = (pip?: number): number => {
    if (!pip || !Number.isFinite(pip) || pip <= 0) return 2;
    const str = pip.toString();
    if (str.includes('e-')) {
        return Math.min(10, Math.max(0, parseInt(str.split('e-')[1], 10) || 2));
    }
    const parts = str.split('.');
    return parts[1] ? Math.min(10, parts[1].length) : 0;
};

const extractLastDigit = (quote: number, decimals: number): number => {
    const formatted = quote.toFixed(Math.max(0, decimals));
    const ch = formatted.charAt(formatted.length - 1);
    const d = Number(ch);
    return Number.isInteger(d) && d >= 0 && d <= 9 ? d : 0;
};

const extractErrMsg = (err: any): string =>
    err?.error?.message || err?.message || localize('Unable to complete Deriv request.');

const formatMoney = (value: number | string | undefined, currency = 'USD'): string => {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return `0.00 ${currency}`;
    return `${num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${currency}`;
};

// Official Deriv Trade Type SVG Icons (extracted 1:1 from @deriv/components)
const TradeTypeIcon: React.FC<{
    type: string;
    tone?: 'coral' | 'white';
    size?: number;
}> = ({ type, tone = 'coral', size = 18 }) => {
    const fill1 = tone === 'white' ? '#ffffff' : '#ff444f';
    const fill2 = tone === 'white' ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 68, 79, 0.35)';

    switch (type) {
        case 'DIGITOVER':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path fill={fill2} d='M6.513 12.544L3.02 15.912H.203l4.89-4.746z' />
                        <path
                            fill={fill1}
                            d='M.045 11.034H15.82v1.925H.045v-1.925zM13.837 8.06V5.412l-5.792 5.622V8.3l4.372-4.244H9.69c-1.104 0-1.983-.875-1.983-1.925h8.113v7.875c-1.105 0-1.983-.875-1.983-1.947z'
                        />
                    </g>
                </svg>
            );
        case 'DIGITUNDER':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path fill={fill2} d='M6.603 5.478L3.11 2.088H.293l4.913 4.768z' />
                        <path
                            fill={fill1}
                            d='M.135 5.04H15.91v1.926H.135V5.04zm13.792 4.9c0-1.071.901-1.924 1.983-1.946v7.875H7.797c0-1.05.88-1.925 1.983-1.925h2.727L8.135 9.7V6.966l5.792 5.621V9.941z'
                        />
                    </g>
                </svg>
            );
        case 'DIGITEVEN':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill2}
                            d='M.135 6.49V.158h6.333V6.49H.135zm4.125-4.1H2.366v1.893H4.26V2.389zM9.6 16V9.668h6.332V16H9.6zm4.101-4.124h-1.893v1.893h1.893v-1.893z'
                        />
                        <path
                            fill={fill1}
                            d='M9.6.158h6.332V6.49H9.6V.158zm2.208 4.124h1.893V2.389h-1.893v1.893zM.135 16V9.668h6.333V16H.135zm4.124-4.124H2.366v1.893H4.26v-1.893z'
                        />
                    </g>
                </svg>
            );
        case 'DIGITODD':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill2}
                            d='M11.628 7.827H4.237L7.91 2l3.718 5.827zM7.256 6.155h1.352l-.676-1.068-.676 1.068z'
                        />
                        <path
                            fill={fill1}
                            d='M7.46 14.86H.067L3.74 9.035l3.718 5.827zm-4.395-1.67h1.352l-.677-1.07-.676 1.068zm12.755 1.67H8.428l3.673-5.826 3.719 5.827zm-4.372-1.67H12.8l-.676-1.069-.676 1.068z'
                        />
                    </g>
                </svg>
            );
        case 'DIGITMATCH':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill1}
                            d='M3.556 2.231l5.666 5.724L3.556 13.7c-.756-.788-.778-2.028 0-2.816l1.822-1.848H.156V7.054h5.377L3.556 5.048a1.992 1.992 0 010-2.817zm3.377 10.231H8.89v3.47H6.933v-3.47zm0-12.304H8.89v3.56H6.933V.158z'
                        />
                        <path
                            fill={fill2}
                            d='M12.156 2.344c.755.788.755 2.05-.023 2.817l-1.466 1.487L9.289 5.25l2.867-2.907zm0 11.493L9.2 10.817l1.378-1.397 1.578 1.6c.755.788.755 2.05 0 2.817zm-1.223-4.778l1.045-1.082-.911-.923h4.622v2.005h-4.756z'
                        />
                    </g>
                </svg>
            );
        case 'DIGITDIFF':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill1}
                            d='M3.493.654l5.746 5.723-5.746 5.747c-.766-.789-.789-2.028 0-2.817l1.848-1.848H.045V5.476H5.5L3.493 3.47a1.973 1.973 0 010-2.816zm3.448 11.808h1.983v3.493H6.94v-3.493zM6.94.18h1.983v1.893H6.94V.18z'
                        />
                        <path
                            fill={fill2}
                            d='M15.82 8.563h-4.305l1.848-1.848c.767-.766.767-2.028 0-2.816L10.051 7.21a.844.844 0 010 1.172l-1.826 1.825 5.138 5.138c.609-.923.474-2.343-.315-3.132l-1.69-1.69h4.44v-1.96h.022z'
                        />
                    </g>
                </svg>
            );
        case 'PUT':
        case 'PUTE':
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill1}
                            d='M15.99 9A1.99 1.99 0 0014 10.99v1.6l-10-10v2.824L12.586 14h-1.6A1.99 1.99 0 009 15.99V16h5a2 2 0 002-2V9h-.01z'
                        />
                        <path fill={fill2} d='M0 2V0h1.414L2 .586 3.414 2H2z' />
                    </g>
                </svg>
            );
        case 'CALL':
        case 'CALLE':
        default:
            return (
                <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
                    <g fill='none'>
                        <path
                            fill={fill1}
                            d='M14 0H9v.01A1.99 1.99 0 0010.99 2h1.6L4 10.586v2.828l10-10v1.6A1.99 1.99 0 0015.99 7H16V2a2 2 0 00-2-2z'
                        />
                        <path fill={fill2} d='M1.414 16H0v-2h3.414L2 15.414z' />
                    </g>
                </svg>
            );
    }
};

// Deriv Synthetic / Market Candlestick Badge Icon matching Screenshot_20261108_123439_Chrome.png
const MarketSymbolIcon: React.FC<{ symbol: string; displayName?: string }> = ({ symbol, displayName = '' }) => {
    const numMatch = symbol.match(/(\d+)/) || displayName.match(/(\d+)/);
    const numText = numMatch ? numMatch[1] : '';
    const is1s = symbol.startsWith('1HZ') || displayName.includes('(1s)');
    const isJump = symbol.startsWith('JD') || displayName.toLowerCase().includes('jump');

    return (
        <svg className='dt-symbol-icon' width='32' height='32' viewBox='0 0 32 32' aria-hidden='true'>
            {/* Candlestick bars */}
            <line x1='5' y1='13' x2='5' y2='26' stroke='#8b9bb4' strokeWidth='1.4' strokeLinecap='round' />
            <rect x='3.5' y='16' width='3' height='6' rx='0.8' fill='#8b9bb4' />

            <line x1='11' y1='11' x2='11' y2='28' stroke='#8b9bb4' strokeWidth='1.4' strokeLinecap='round' />
            <rect x='9.5' y='14' width='3' height='9' rx='0.8' fill='#5c6f8c' />

            <line x1='17' y1='14' x2='17' y2='27' stroke='#8b9bb4' strokeWidth='1.4' strokeLinecap='round' />
            <rect x='15.5' y='17' width='3' height='6' rx='0.8' fill='#8b9bb4' />

            <line x1='23' y1='12' x2='23' y2='25' stroke='#8b9bb4' strokeWidth='1.4' strokeLinecap='round' />
            <rect x='21.5' y='15' width='3' height='6' rx='0.8' fill='#5c6f8c' />

            {numText ? (
                <text
                    x={is1s ? '10' : '14'}
                    y='9.5'
                    fill='#ffffff'
                    fontSize={numText.length >= 3 ? '7.5' : '8.5'}
                    fontWeight='800'
                    textAnchor='middle'
                    fontFamily='IBM Plex Sans, Inter, sans-serif'
                >
                    {numText}
                </text>
            ) : (
                <text
                    x='14'
                    y='9.5'
                    fill='#ffffff'
                    fontSize='7.5'
                    fontWeight='800'
                    textAnchor='middle'
                    fontFamily='IBM Plex Sans, Inter, sans-serif'
                >
                    {isJump ? 'JMP' : symbol.slice(0, 3).toUpperCase()}
                </text>
            )}

            {is1s && (
                <g>
                    <rect x='19' y='2' width='11.5' height='9.5' rx='4.75' fill='#ff444f' />
                    <text
                        x='24.75'
                        y='8.7'
                        fill='#ffffff'
                        fontSize='6.5'
                        fontWeight='800'
                        textAnchor='middle'
                        fontFamily='IBM Plex Sans, Inter, sans-serif'
                    >
                        1s
                    </text>
                </g>
            )}
        </svg>
    );
};

// Exact deriv-circles LastDigitStat + DigitDisplay + LastDigitPointer circle
interface TDigitCircleProps {
    digit: number;
    percentage: number;
    isMax: boolean;
    isMin: boolean;
    isSelected: boolean;
    isLatest: boolean;
    pointerState: 'idle' | 'won' | 'lost';
    interactive: boolean;
    onSelect: (digit: number) => void;
}

const DigitCircle: React.FC<TDigitCircleProps> = ({
    digit,
    percentage,
    isMax,
    isMin,
    isSelected,
    isLatest,
    pointerState,
    interactive,
    onSelect,
}) => {
    const safePct = Number.isFinite(percentage) ? percentage : 10;
    // Exact deriv-circles formula from last-digit-stat.tsx:
    const p = Math.max(Math.min((20 * safePct - 102) / 3 / 100, 0.66), 0.06);
    const dashArray = `${(DIGIT_CIRCUMFERENCE * p).toFixed(2)} ${(DIGIT_CIRCUMFERENCE * (1 - p)).toFixed(2)}`;
    const dashOffset = (DIGIT_CIRCUMFERENCE * ((p + 1) / 2)).toFixed(2);

    const clamp = Math.max(Math.min((safePct - 10) / 4, 1), -1);
    const neutralOpacity = (((clamp + 1) / 2) * 0.85 + 0.15).toFixed(2);

    const progressColor = isMax ? '#00a79e' : isMin ? '#ec3f3f' : '#6e7278';
    const progressOpacity = isMax || isMin ? 1 : Number(neutralOpacity);

    const pointerColor =
        pointerState === 'won' ? '#00a79e' : pointerState === 'lost' ? '#ec3f3f' : '#ff6444';

    return (
        <button
            type='button'
            className={classNames('dt-digit', {
                'dt-digit--latest': isLatest,
                'dt-digit--selected': isSelected,
                'dt-digit--interactive': interactive,
            })}
            onClick={() => interactive && onSelect(digit)}
            aria-label={`Digit ${digit}, ${safePct.toFixed(1)}%`}
        >
            <span className='dt-digit__gauge'>
                <svg className='dt-digit__pie' width='120' height='120' viewBox='0 0 120 120'>
                    <circle
                        className='dt-digit__bg'
                        cx='60'
                        cy='60'
                        r='54'
                        fill={isSelected ? '#2a3052' : 'transparent'}
                        stroke='#262729'
                        strokeWidth='12'
                    />
                    <circle
                        className='dt-digit__arc'
                        cx='60'
                        cy='60'
                        r='54'
                        fill='none'
                        stroke={progressColor}
                        strokeOpacity={progressOpacity}
                        strokeWidth='12'
                        strokeDasharray={dashArray}
                        strokeDashoffset={dashOffset}
                    />
                </svg>
                <span className='dt-digit__content'>
                    <i className='dt-digit__num'>{digit}</i>
                    <i className='dt-digit__pct'>{safePct.toFixed(1)}%</i>
                </span>
            </span>

            {isLatest && (
                <span className='dt-digit__pointer' aria-hidden='true'>
                    <svg width='12' height='9' viewBox='0 0 12 9'>
                        <polygon points='6,0 12,9 0,9' fill={pointerColor} />
                    </svg>
                </span>
            )}
        </button>
    );
};

const Dtrader = observer(() => {
    const { client } = useStore();
    const { isAuthorized, connectionStatus, activeLoginid } = useApiBase();

    // Market & 1000-tick live stream state
    const [markets, setMarkets] = useState<TMarketItem[]>(FALLBACK_MARKETS);
    const [symbol, setSymbol] = useState<string>('1HZ100V');
    const [ticks, setTicks] = useState<{ epoch: number; quote: number }[]>([]);
    const [streamPipSize, setStreamPipSize] = useState<number | null>(null);

    // Trade ticket state (defaults match Screenshot_20261108_123439_Chrome.png)
    const [family, setFamily] = useState<TTradeFamily>('over_under');
    const [prediction, setPrediction] = useState<number>(2);
    const [basis, setBasis] = useState<TBasis>('stake');
    const [amount, setAmount] = useState<string>('1');
    const [durationUnit, setDurationUnit] = useState<TDurationUnit>('t');
    const [duration, setDuration] = useState<string>('1');
    const [barrierOffset, setBarrierOffset] = useState<string>('+0.50');
    const [allowEquals, setAllowEquals] = useState<boolean>(false);

    // UI / Deriv DTrader navigation & modal state
    const [viewIndex, setViewIndex] = useState<0 | 1>(0); // 0 = 10 Digit Circles, 1 = Live Chart
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [isMarketModalOpen, setIsMarketModalOpen] = useState<boolean>(false);
    const [marketSearch, setMarketSearch] = useState<string>('');
    const [marketCategory, setMarketCategory] = useState<string>('All');

    const [isTradeTypeModalOpen, setIsTradeTypeModalOpen] = useState<boolean>(false);
    const [tradeTypeModalView, setTradeTypeModalView] = useState<'list' | 'info'>('list');
    const [tradeTypeCategory, setTradeTypeCategory] = useState<'All' | 'Digits' | 'Up/Down'>('All');
    const [infoFamily, setInfoFamily] = useState<TTradeFamily>('over_under');

    const [isParamsModalOpen, setIsParamsModalOpen] = useState<boolean>(false);
    const [paramsModalTab, setParamsModalTab] = useState<'duration' | 'amount'>('duration');
    const [draftAmount, setDraftAmount] = useState<string>('1');

    const [isPositionsOpen, setIsPositionsOpen] = useState<boolean>(false);
    const [activeToastContractId, setActiveToastContractId] = useState<number | null>(null);

    // Quotes, execution & portfolio state
    const [quotes, setQuotes] = useState<Record<string, TQuoteInfo>>({});
    const [isQuoting, setIsQuoting] = useState<boolean>(false);
    const [buyingType, setBuyingType] = useState<string | null>(null);
    const [sellingId, setSellingId] = useState<number | null>(null);
    const [tradeError, setTradeError] = useState<string>('');
    const [contracts, setContracts] = useState<TTrackedContract[]>([]);

    const isBuyingRef = useRef<boolean>(false);
    const quoteSeqRef = useRef<number>(0);
    const subscribedContractsRef = useRef<Set<number>>(new Set());
    const touchStartXRef = useRef<number | null>(null);

    const resolvedLoginId = client?.loginid || activeLoginid || V2GetActiveClientId() || '';
    const hasAuthSession = Boolean((isAuthorized || client?.is_logged_in || V2GetActiveToken()) && resolvedLoginId);
    const currency = client?.currency || 'USD';

    const currentMarket = useMemo(
        () => markets.find(m => m.symbol === symbol) || FALLBACK_MARKETS.find(m => m.symbol === symbol) || markets[0],
        [markets, symbol]
    );
    const decimals = useMemo(
        () => (streamPipSize !== null ? streamPipSize : pipToDecimals(currentMarket?.pip)),
        [streamPipSize, currentMarket?.pip]
    );

    const currentFamilyMeta = useMemo(
        () => TRADE_TYPE_META.find(m => m.id === family) || TRADE_TYPE_META[2],
        [family]
    );
    const isDigitFamily = currentFamilyMeta.isDigits;
    const needsDigitPrediction = family === 'over_under' || family === 'match_diff';
    const needsBarrierOffset = family === 'higher_lower';
    const directions = useMemo(() => getDirectionsForFamily(family, allowEquals), [family, allowEquals]);

    // Auto-switch viewport between Digits (0) and Chart (1) when switching trade family
    useEffect(() => {
        if (isDigitFamily) {
            setViewIndex(0);
            if (durationUnit !== 't') setDurationUnit('t');
            const d = parseInt(duration, 10);
            if (!Number.isFinite(d) || d < 1 || d > 10) {
                setDuration('1');
            }
        } else {
            setViewIndex(1);
        }
    }, [isDigitFamily]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ensure central Options V1 WS connection is alive
    useEffect(() => {
        if (!api_base?.api || (api_base.api.connection && api_base.api.connection.readyState > WebSocket.OPEN)) {
            api_base.init?.(true)?.catch(err => {
                console.warn('[DTrader] Initial reconnect warning:', err);
            });
        }
    }, [connectionStatus]);

    // Load active symbols from Deriv WS
    useEffect(() => {
        let cancelled = false;
        const loadMarkets = async () => {
            if (!api_base?.api) return;
            try {
                const res = await api_base.api.send({ active_symbols: 'brief' });
                if (cancelled || !Array.isArray(res?.active_symbols)) return;

                const openSymbols: TMarketItem[] = res.active_symbols
                    .filter(
                        (item: any) =>
                            (item.symbol || item.underlying_symbol) &&
                            item.exchange_is_open !== 0 &&
                            item.exchange_is_open !== false &&
                            !item.is_trading_suspended
                    )
                    .map((item: any) => ({
                        symbol: item.symbol || item.underlying_symbol,
                        display_name: item.display_name || item.underlying_symbol_name || item.symbol,
                        market: item.market || 'synthetic_index',
                        market_display_name: item.market_display_name || 'Derived',
                        submarket_display_name: item.submarket_display_name || 'Continuous Indices',
                        pip: Number(item.pip ?? item.pip_size ?? 0.01),
                    }));

                if (openSymbols.length > 0) {
                    openSymbols.sort((a, b) => {
                        if (a.market === 'synthetic_index' && b.market !== 'synthetic_index') return -1;
                        if (a.market !== 'synthetic_index' && b.market === 'synthetic_index') return 1;
                        return a.display_name.localeCompare(b.display_name);
                    });
                    setMarkets(openSymbols);
                    setSymbol(prev =>
                        openSymbols.some(s => s.symbol === prev)
                            ? prev
                            : openSymbols.find(s => s.symbol === '1HZ100V')?.symbol ||
                              openSymbols.find(s => s.symbol === 'R_100')?.symbol ||
                              openSymbols[0].symbol
                    );
                }
            } catch (err) {
                console.warn('[DTrader] Using fallback markets while active_symbols loads:', err);
            }
        };

        loadMarkets();
        return () => {
            cancelled = true;
        };
    }, [connectionStatus, resolvedLoginId]);

    // Subscribe to 1000 historical ticks + live ticks stream for the selected symbol
    useEffect(() => {
        if (!api_base?.api || !symbol) return undefined;

        let active = true;
        let tickSubId: string | null = null;
        setTicks([]);
        setStreamPipSize(null);

        const msgSub = api_base.api.onMessage().subscribe((evt: any) => {
            const data = evt?.data ?? evt;
            if (!active || !data || data.error) return;

            const incomingSymbol = data.tick?.symbol || data.tick?.underlying_symbol;
            if (data.msg_type === 'tick' && incomingSymbol === symbol) {
                const quote = Number(data.tick.quote);
                const epoch = Number(data.tick.epoch || Math.floor(Date.now() / 1000));
                if (!Number.isFinite(quote)) return;

                if (typeof data.tick.pip_size === 'number') {
                    setStreamPipSize(data.tick.pip_size);
                }
                if (data.tick.id && !tickSubId) {
                    tickSubId = data.tick.id;
                }

                setTicks(prev => {
                    const next = [...prev, { epoch, quote }];
                    return next.length > DEFAULT_TICK_COUNT ? next.slice(-DEFAULT_TICK_COUNT) : next;
                });
            }
        });

        // Seed 1000 historical ticks by default for accurate digit percentages & green/red arcs
        api_base.api
            .send({
                ticks_history: symbol,
                count: DEFAULT_TICK_COUNT,
                end: 'latest',
                style: 'ticks',
                subscribe: 0,
            })
            .then((res: any) => {
                if (!active || !res?.history?.prices) return;
                if (typeof res.pip_size === 'number') {
                    setStreamPipSize(res.pip_size);
                }
                const prices: number[] = res.history.prices.map(Number);
                const times: number[] = (res.history.times || []).map(Number);
                const seeded = prices
                    .map((q, idx) => ({ epoch: times[idx] || idx, quote: q }))
                    .filter(item => Number.isFinite(item.quote));
                if (seeded.length) {
                    setTicks(prev => {
                        if (prev.length >= seeded.length) return prev;
                        const lastSeedEpoch = seeded[seeded.length - 1]?.epoch ?? 0;
                        const newerLive = prev.filter(t => t.epoch > lastSeedEpoch);
                        return [...seeded, ...newerLive].slice(-DEFAULT_TICK_COUNT);
                    });
                }
            })
            .catch(() => {});

        // Start live tick stream
        api_base.api
            .send({ ticks: symbol, subscribe: 1 })
            .then((res: any) => {
                const id = res?.subscription?.id || res?.tick?.id || null;
                if (!active && id) {
                    api_base.api?.send({ forget: id }).catch(() => {});
                    return;
                }
                if (id) tickSubId = id;
                if (typeof res?.tick?.pip_size === 'number') {
                    setStreamPipSize(res.tick.pip_size);
                }
            })
            .catch((err: any) => {
                console.warn('[DTrader] Tick stream warning:', err);
            });

        return () => {
            active = false;
            msgSub?.unsubscribe?.();
            if (tickSubId && api_base?.api) {
                api_base.api.send({ forget: tickSubId }).catch(() => {});
            }
        };
    }, [symbol, connectionStatus]);

    // Build proposal payload
    const buildProposalPayload = useCallback(
        (contractType: string) => {
            const numericAmount = Number(amount);
            const numericDuration = parseInt(duration, 10);
            if (!symbol || !Number.isFinite(numericAmount) || numericAmount <= 0) return null;
            if (!Number.isInteger(numericDuration) || numericDuration < 1) return null;
            if (durationUnit === 't' && numericDuration > 10) return null;

            const payload: Record<string, any> = {
                proposal: 1,
                amount: numericAmount,
                basis,
                contract_type: contractType,
                currency,
                duration: numericDuration,
                duration_unit: durationUnit,
                symbol,
            };

            if (needsDigitPrediction) {
                payload.barrier = String(prediction);
            } else if (needsBarrierOffset) {
                const trimmedBarrier = barrierOffset.trim();
                if (!trimmedBarrier) return null;
                payload.barrier = trimmedBarrier;
            }

            return payload;
        },
        [
            amount,
            basis,
            currency,
            duration,
            durationUnit,
            symbol,
            needsDigitPrediction,
            prediction,
            needsBarrierOffset,
            barrierOffset,
        ]
    );

    // Fetch live quotes for both purchase buttons
    const refreshQuotes = useCallback(async () => {
        const seq = ++quoteSeqRef.current;

        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) {
            return;
        }

        const payloads = directions.map(dir => ({
            dir,
            payload: buildProposalPayload(dir.contractType),
        }));

        if (payloads.some(p => !p.payload)) {
            setQuotes({});
            return;
        }

        setIsQuoting(true);
        const results = await Promise.all(
            payloads.map(async ({ dir, payload }) => {
                try {
                    const res = await api_base.api!.send(payload!);
                    if (res?.error) {
                        return [
                            dir.contractType,
                            {
                                id: '',
                                askPrice: 0,
                                payout: 0,
                                longcode: '',
                                createdAt: Date.now(),
                                error: res.error.message,
                            } as TQuoteInfo,
                        ] as const;
                    }
                    const p = res?.proposal;
                    if (!p) {
                        return [dir.contractType, null] as const;
                    }
                    return [
                        dir.contractType,
                        {
                            id: p.id || '',
                            askPrice: Number(p.ask_price ?? 0),
                            payout: Number(p.payout ?? 0),
                            longcode: p.longcode || '',
                            spot: p.spot !== undefined ? Number(p.spot) : undefined,
                            createdAt: Date.now(),
                        } as TQuoteInfo,
                    ] as const;
                } catch (err: any) {
                    return [
                        dir.contractType,
                        {
                            id: '',
                            askPrice: 0,
                            payout: 0,
                            longcode: '',
                            createdAt: Date.now(),
                            error: extractErrMsg(err),
                        } as TQuoteInfo,
                    ] as const;
                }
            })
        );

        if (seq !== quoteSeqRef.current) return;
        const nextQuotes: Record<string, TQuoteInfo> = {};
        results.forEach(([type, info]) => {
            if (info) nextQuotes[type] = info;
        });
        setQuotes(nextQuotes);
        setIsQuoting(false);
    }, [directions, buildProposalPayload]);

    useEffect(() => {
        setTradeError('');
        const debounceTimer = setTimeout(() => {
            refreshQuotes();
        }, 200);

        const refreshInterval = setInterval(() => {
            if (!isBuyingRef.current) {
                refreshQuotes();
            }
        }, 10000);

        return () => {
            clearTimeout(debounceTimer);
            clearInterval(refreshInterval);
        };
    }, [refreshQuotes, connectionStatus, resolvedLoginId]);

    // Subscribe to proposal_open_contract updates & portfolio
    const trackContractStream = useCallback((contractId: number) => {
        if (!contractId || subscribedContractsRef.current.has(contractId) || !api_base?.api) return;
        subscribedContractsRef.current.add(contractId);
        api_base.api
            .send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            })
            .catch((err: any) => {
                subscribedContractsRef.current.delete(contractId);
                console.warn('[DTrader] proposal_open_contract subscribe warning:', err);
            });
    }, []);

    useEffect(() => {
        subscribedContractsRef.current.clear();
        setContracts([]);

        if (!hasAuthSession || !api_base?.api) return undefined;

        let active = true;
        const sub = api_base.api.onMessage().subscribe((evt: any) => {
            const data = evt?.data ?? evt;
            if (!active || !data || data.error) return;

            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.contract_id) {
                const poc = data.proposal_open_contract;
                const isSoldNow = Boolean(poc.is_sold) || (poc.status && poc.status !== 'open');
                setContracts(prev => {
                    const existing = prev.find(item => item.contract_id === poc.contract_id);
                    const updated: TTrackedContract = {
                        contract_id: poc.contract_id,
                        contract_type: poc.contract_type || existing?.contract_type,
                        symbol: poc.symbol || poc.underlying_symbol || existing?.symbol,
                        longcode: poc.longcode || existing?.longcode,
                        buy_price: Number(poc.buy_price ?? existing?.buy_price ?? 0),
                        bid_price: poc.bid_price !== undefined ? Number(poc.bid_price) : existing?.bid_price,
                        sell_price: poc.sell_price !== undefined ? Number(poc.sell_price) : existing?.sell_price,
                        payout: poc.payout !== undefined ? Number(poc.payout) : existing?.payout,
                        profit: poc.profit !== undefined ? Number(poc.profit) : existing?.profit,
                        currency: poc.currency || existing?.currency || currency,
                        entry_spot: poc.entry_spot !== undefined ? Number(poc.entry_spot) : existing?.entry_spot,
                        current_spot: poc.current_spot !== undefined ? Number(poc.current_spot) : existing?.current_spot,
                        exit_spot: poc.exit_spot !== undefined ? Number(poc.exit_spot) : existing?.exit_spot,
                        tick_count: poc.tick_count !== undefined ? Number(poc.tick_count) : existing?.tick_count,
                        current_tick: poc.current_tick !== undefined ? Number(poc.current_tick) : existing?.current_tick,
                        barrier: poc.barrier !== undefined ? String(poc.barrier) : existing?.barrier,
                        is_valid_to_sell: poc.is_valid_to_sell,
                        is_sold: poc.is_sold,
                        status: poc.status || (poc.is_sold ? 'sold' : 'open'),
                        date_start: poc.date_start || existing?.date_start,
                        settledAt: isSoldNow ? existing?.settledAt || Date.now() : undefined,
                    };

                    if (isSoldNow && !existing?.settledAt) {
                        api_base.api?.send({ balance: 1 }).catch(() => {});
                    }

                    const idx = prev.findIndex(item => item.contract_id === poc.contract_id);
                    if (idx === -1) {
                        return [updated, ...prev].slice(0, 25);
                    }
                    const copy = [...prev];
                    copy[idx] = { ...copy[idx], ...updated };
                    return copy;
                });
            }
        });

        api_base.api
            .send({ portfolio: 1 })
            .then((res: any) => {
                if (!active || !Array.isArray(res?.portfolio?.contracts)) return;
                const openItems: TTrackedContract[] = res.portfolio.contracts.map((c: any) => ({
                    contract_id: c.contract_id,
                    contract_type: c.contract_type,
                    symbol: c.symbol || c.underlying_symbol,
                    longcode: c.longcode,
                    buy_price: Number(c.buy_price ?? 0),
                    payout: c.payout !== undefined ? Number(c.payout) : undefined,
                    currency: c.currency || currency,
                    date_start: c.date_start,
                    status: 'open',
                    is_sold: 0,
                }));
                if (openItems.length) {
                    setContracts(prev => {
                        const existingIds = new Set(prev.map(p => p.contract_id));
                        const merged = [...prev, ...openItems.filter(o => !existingIds.has(o.contract_id))];
                        return merged.slice(0, 25);
                    });
                    openItems.forEach(item => trackContractStream(item.contract_id));
                }
            })
            .catch(() => {});

        return () => {
            active = false;
            sub?.unsubscribe?.();
        };
    }, [hasAuthSession, resolvedLoginId, connectionStatus, currency, trackContractStream]);

    // Execute trade purchase via Options V1 WS
    const handlePurchase = async (dir: TDirectionOption) => {
        if (!hasAuthSession) {
            await startLogin();
            return;
        }
        if (isBuyingRef.current) return;
        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) {
            setTradeError(localize('Connection is reconnecting. Please wait a moment and try again.'));
            return;
        }

        const proposalPayload = buildProposalPayload(dir.contractType);
        if (!proposalPayload) {
            setTradeError(localize('Please enter a valid stake and duration.'));
            return;
        }

        isBuyingRef.current = true;
        setBuyingType(dir.contractType);
        setTradeError('');

        try {
            let activeQuote = quotes[dir.contractType];
            const isQuoteFresh =
                activeQuote?.id &&
                !activeQuote.error &&
                activeQuote.askPrice > 0 &&
                Date.now() - activeQuote.createdAt < QUOTE_FRESH_MS;

            if (!isQuoteFresh) {
                const freshRes = await api_base.api.send(proposalPayload);
                if (freshRes?.error) {
                    throw freshRes;
                }
                const p = freshRes?.proposal;
                if (!p?.id) {
                    throw new Error(localize('Unable to obtain a live quote from Deriv.'));
                }
                activeQuote = {
                    id: p.id,
                    askPrice: Number(p.ask_price ?? amount),
                    payout: Number(p.payout ?? 0),
                    longcode: p.longcode || '',
                    createdAt: Date.now(),
                };
            }

            const buyRes = await api_base.api.send({
                buy: activeQuote.id,
                price: activeQuote.askPrice,
            });

            if (buyRes?.error) {
                throw buyRes;
            }

            const bought = buyRes?.buy;
            if (!bought?.contract_id) {
                throw new Error(localize('Deriv did not return a contract ID for the purchase.'));
            }

            const optimisticContract: TTrackedContract = {
                contract_id: bought.contract_id,
                contract_type: dir.contractType,
                symbol,
                longcode: bought.longcode || activeQuote.longcode,
                buy_price: Number(bought.buy_price ?? activeQuote.askPrice),
                payout: Number(bought.payout ?? activeQuote.payout),
                currency,
                status: 'open',
                is_sold: 0,
                date_start: bought.start_time,
                barrier: needsDigitPrediction ? String(prediction) : undefined,
            };

            setContracts(prev => [
                optimisticContract,
                ...prev.filter(item => item.contract_id !== bought.contract_id),
            ].slice(0, 25));
            setActiveToastContractId(bought.contract_id);

            trackContractStream(bought.contract_id);
            api_base.api?.send({ balance: 1 }).catch(() => {});
            refreshQuotes();
        } catch (err: any) {
            setTradeError(extractErrMsg(err));
            refreshQuotes();
        } finally {
            isBuyingRef.current = false;
            setBuyingType(null);
        }
    };

    const handleSellContract = async (contractId: number) => {
        if (!api_base?.api || sellingId) return;
        setSellingId(contractId);
        setTradeError('');
        try {
            const res = await api_base.api.send({ sell: contractId, price: 0 });
            if (res?.error) {
                throw res;
            }
            api_base.api?.send({ balance: 1 }).catch(() => {});
        } catch (err: any) {
            setTradeError(extractErrMsg(err));
        } finally {
            setSellingId(null);
        }
    };

    // Auto-clear toast 5.5s after contract settles
    const toastContract = useMemo(
        () => (activeToastContractId ? contracts.find(c => c.contract_id === activeToastContractId) || null : null),
        [activeToastContractId, contracts]
    );

    useEffect(() => {
        if (!toastContract?.settledAt) return undefined;
        const timer = setTimeout(() => {
            setActiveToastContractId(curr => (curr === toastContract.contract_id ? null : curr));
        }, 5500);
        return () => clearTimeout(timer);
    }, [toastContract?.contract_id, toastContract?.settledAt]);

    // Live spot, tick change & 1000-tick digit statistics
    const latestTick = ticks[ticks.length - 1];
    const previousTick = ticks.length > 1 ? ticks[ticks.length - 2] : latestTick;
    const spotDelta = latestTick && previousTick ? latestTick.quote - previousTick.quote : 0;
    const spotPct = latestTick && previousTick && previousTick.quote !== 0 ? (spotDelta / previousTick.quote) * 100 : 0;

    const latestDigit = useMemo(
        () => (latestTick ? extractLastDigit(latestTick.quote, decimals) : null),
        [latestTick, decimals]
    );

    const digitStats = useMemo(() => {
        const counts = Array(10).fill(0) as number[];
        ticks.forEach(t => {
            counts[extractLastDigit(t.quote, decimals)] += 1;
        });
        const total = ticks.length;
        const percentages = counts.map(c => (total > 0 ? (c * 100) / total : 10));
        const maxCount = total > 0 ? Math.max(...counts) : 0;
        const minCount = total > 0 ? Math.min(...counts) : 0;
        const hasSpread = maxCount > minCount;

        return counts.map((count, digit) => ({
            digit,
            count,
            percentage: percentages[digit],
            isMax: hasSpread && count === maxCount,
            isMin: hasSpread && count === minCount,
        }));
    }, [ticks, decimals]);

    // Determine pointer win/loss state from most recently settled digit contract
    const pointerState = useMemo<'idle' | 'won' | 'lost'>(() => {
        if (!toastContract || !toastContract.settledAt || toastContract.symbol !== symbol) return 'idle';
        if (Date.now() - toastContract.settledAt > 4500) return 'idle';
        if (!toastContract.contract_type?.startsWith('DIGIT')) return 'idle';
        const profit = Number(toastContract.profit ?? 0);
        if (profit > 0 || toastContract.status === 'won') return 'won';
        if (profit < 0 || toastContract.status === 'lost') return 'lost';
        return 'idle';
    }, [toastContract, symbol]);

    // Live SVG Chart geometry (for View 1)
    const chartData = useMemo(() => {
        const recent = ticks.slice(-120);
        if (recent.length < 2) return null;
        const values = recent.map(t => t.quote);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const width = 800;
        const height = 340;
        const padX = 16;
        const padY = 26;
        const usableW = width - padX * 2 - 70;
        const usableH = height - padY * 2;

        const points = recent.map((t, idx) => {
            const x = padX + (idx / (recent.length - 1)) * usableW;
            const y = padY + (1 - (t.quote - min) / span) * usableH;
            return { x, y, quote: t.quote };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const last = points[points.length - 1];
        const first = points[0];
        const areaPath = `${linePath} L${last.x.toFixed(1)},${(height - padY).toFixed(1)} L${first.x.toFixed(1)},${(
            height - padY
        ).toFixed(1)} Z`;

        const gridLevels = [0, 0.25, 0.5, 0.75, 1].map(frac => ({
            y: padY + frac * usableH,
            price: (max - frac * span).toFixed(decimals),
        }));

        return { width, height, linePath, areaPath, last, usableW, padX, gridLevels };
    }, [ticks, decimals]);

    // Market selector categories & filtered groups
    const marketCategories = useMemo(() => {
        const cats = Array.from(new Set(markets.map(m => m.market_display_name)));
        return ['All', ...cats];
    }, [markets]);

    const groupedMarkets = useMemo(() => {
        const q = marketSearch.trim().toLowerCase();
        const filtered = markets.filter(m => {
            if (marketCategory !== 'All' && m.market_display_name !== marketCategory) return false;
            if (!q) return true;
            return (
                m.display_name.toLowerCase().includes(q) ||
                m.symbol.toLowerCase().includes(q) ||
                m.submarket_display_name.toLowerCase().includes(q)
            );
        });

        const groups: Record<string, TMarketItem[]> = {};
        filtered.forEach(item => {
            const key = item.submarket_display_name || item.market_display_name;
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return Object.entries(groups);
    }, [markets, marketCategory, marketSearch]);

    const openContractsCount = useMemo(
        () => contracts.filter(c => !c.is_sold && (!c.status || c.status === 'open')).length,
        [contracts]
    );

    const humanDuration = useMemo(() => {
        const d = parseInt(duration, 10) || 1;
        if (durationUnit === 't') return `${d} ${d === 1 ? 'tick' : 'ticks'}`;
        if (durationUnit === 's') return `${d} ${d === 1 ? 'sec' : 'secs'}`;
        return `${d} ${d === 1 ? 'min' : 'mins'}`;
    }, [duration, durationUnit]);

    const openParamsModal = (tab: 'duration' | 'amount') => {
        setParamsModalTab(tab);
        setDraftAmount(amount);
        setIsParamsModalOpen(true);
    };

    const handleKeypadPress = (key: string) => {
        setDraftAmount(prev => {
            if (key === 'BACK') {
                const next = prev.slice(0, -1);
                return next || '0';
            }
            if (key === '.') {
                if (prev.includes('.')) return prev;
                return `${prev || '0'}.`;
            }
            if (prev === '0') return key;
            const parts = prev.split('.');
            if (parts[1] && parts[1].length >= 2) return prev;
            return `${prev}${key}`;
        });
    };

    const commitParamsModal = () => {
        const parsed = Number(draftAmount);
        if (Number.isFinite(parsed) && parsed > 0) {
            setAmount(String(parsed));
        }
        setIsParamsModalOpen(false);
    };

    const adjustAmount = (delta: number) => {
        const curr = Number(amount) || 0;
        const next = Math.max(0.35, Number((curr + delta).toFixed(2)));
        setAmount(String(next));
    };

    const adjustDuration = (delta: number) => {
        const curr = parseInt(duration, 10) || 1;
        const max = durationUnit === 't' ? 10 : 120;
        const next = Math.min(max, Math.max(1, curr + delta));
        setDuration(String(next));
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0]?.clientX ?? null;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (touchStartXRef.current === null) return;
        const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
        const diff = endX - touchStartXRef.current;
        touchStartXRef.current = null;
        if (Math.abs(diff) < 48) return;
        if (diff < 0) setViewIndex(1);
        else setViewIndex(0);
    };

    const spotLineText = latestTick
        ? `${latestTick.quote.toFixed(decimals)} ${spotDelta > 0 ? '+' : '-'} ${Math.abs(spotDelta).toFixed(
              decimals
          )} (${Math.abs(spotPct).toFixed(2)}%)`
        : localize('Loading ticks...');

    const renderPurchaseButtons = (showReturnPct = false) => (
        <div className='dt-purchase-grid'>
            {directions.map((dir, idx) => {
                const quote = quotes[dir.contractType];
                const isBuyingThis = buyingType === dir.contractType;
                const bottomLabel = basis === 'stake' ? 'Payout' : 'Stake';
                const bottomValue =
                    basis === 'stake'
                        ? quote?.payout
                            ? formatMoney(quote.payout, currency)
                            : '--'
                        : quote?.askPrice
                          ? formatMoney(quote.askPrice, currency)
                          : '--';

                const netReturnPct =
                    quote && quote.askPrice > 0
                        ? (((quote.payout - quote.askPrice) / quote.askPrice) * 100).toFixed(1)
                        : null;

                return (
                    <button
                        key={dir.contractType}
                        type='button'
                        className={classNames(
                            'dt-purchase-btn',
                            idx === 0 ? 'dt-purchase-btn--teal' : 'dt-purchase-btn--red',
                            {
                                'dt-purchase-btn--loading': isBuyingThis,
                                'dt-purchase-btn--disabled': Boolean(buyingType) || Boolean(quote?.error),
                            }
                        )}
                        disabled={Boolean(buyingType)}
                        onClick={() => handlePurchase(dir)}
                    >
                        <span className='dt-purchase-btn__main'>
                            <span className='dt-purchase-btn__icon'>
                                <TradeTypeIcon type={dir.iconType} tone='white' size={20} />
                            </span>
                            <span className='dt-purchase-btn__title'>
                                {isBuyingThis ? localize('Buying...') : dir.label}
                            </span>
                        </span>
                        <span className='dt-purchase-btn__strip'>
                            <span className='dt-purchase-btn__strip-label'>
                                {bottomLabel}
                                {showReturnPct && netReturnPct ? ` (${netReturnPct}%)` : ''}
                            </span>
                            <span className='dt-purchase-btn__strip-value'>
                                {isQuoting && !quote ? '...' : bottomValue}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );

    const activeQuoteError =
        tradeError ||
        quotes[directions[0].contractType]?.error ||
        quotes[directions[1].contractType]?.error ||
        '';

    return (
        <div className='dt-page'>
            {/* Main Canvas (Top-left Market Selector + Centered 1000-Tick Digit Circles / Live Chart + << >>) */}
            <div className='dt-canvas' onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
                {/* Floating Top Bar */}
                <div className='dt-top-overlay'>
                    <div className='dt-market-frame'>
                        <button
                            type='button'
                            className='dt-market-card'
                            onClick={() => setIsMarketModalOpen(true)}
                            aria-label='Select market'
                        >
                            <MarketSymbolIcon
                                symbol={currentMarket?.symbol || symbol}
                                displayName={currentMarket?.display_name}
                            />
                            <span className='dt-market-card__meta'>
                                <span className='dt-market-card__name'>
                                    {currentMarket?.display_name || symbol}
                                </span>
                                <span
                                    className={classNames('dt-market-card__spot', {
                                        'dt-market-card__spot--up': spotDelta > 0,
                                        'dt-market-card__spot--down': spotDelta < 0,
                                    })}
                                >
                                    {spotLineText}
                                </span>
                            </span>
                            <svg
                                className={classNames('dt-market-card__chevron', {
                                    'dt-market-card__chevron--open': isMarketModalOpen,
                                })}
                                width='16'
                                height='16'
                                viewBox='0 0 16 16'
                                aria-hidden='true'
                            >
                                <path
                                    d='M3.5 6L8 10.5L12.5 6'
                                    fill='none'
                                    stroke='#999c9f'
                                    strokeWidth='1.4'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>
                    </div>

                    {contracts.length > 0 && (
                        <button
                            type='button'
                            className={classNames('dt-positions-pill', {
                                'dt-positions-pill--open': openContractsCount > 0,
                            })}
                            onClick={() => setIsPositionsOpen(true)}
                        >
                            <span className='dt-positions-pill__dot' />
                            <span>
                                {openContractsCount > 0
                                    ? `Positions (${openContractsCount})`
                                    : `Recent (${contracts.length})`}
                            </span>
                        </button>
                    )}
                </div>

                {/* Live Contract Execution / Result Floating Toast */}
                {toastContract && (
                    <div
                        className={classNames('dt-contract-toast', {
                            'dt-contract-toast--won':
                                Boolean(toastContract.settledAt) && Number(toastContract.profit ?? 0) > 0,
                            'dt-contract-toast--lost':
                                Boolean(toastContract.settledAt) && Number(toastContract.profit ?? 0) < 0,
                        })}
                    >
                        <div className='dt-contract-toast__row'>
                            <div className='dt-contract-toast__title'>
                                <TradeTypeIcon
                                    type={toastContract.contract_type || directions[0].iconType}
                                    tone='white'
                                    size={15}
                                />
                                <span>
                                    {toastContract.symbol || symbol}{' '}
                                    {toastContract.barrier !== undefined ? `(${toastContract.barrier})` : ''}
                                </span>
                            </div>
                            <button
                                type='button'
                                className='dt-contract-toast__close'
                                onClick={() => setActiveToastContractId(null)}
                                aria-label='Dismiss'
                            >
                                ×
                            </button>
                        </div>
                        <div className='dt-contract-toast__stats'>
                            <span>
                                {toastContract.settledAt
                                    ? Number(toastContract.profit ?? 0) >= 0
                                        ? 'Won'
                                        : 'Lost'
                                    : toastContract.tick_count
                                      ? `Tick ${toastContract.current_tick ?? 0}/${toastContract.tick_count}`
                                      : 'Open contract'}
                            </span>
                            <strong
                                className={classNames('dt-contract-toast__pnl', {
                                    'dt-contract-toast__pnl--pos': Number(toastContract.profit ?? 0) > 0,
                                    'dt-contract-toast__pnl--neg': Number(toastContract.profit ?? 0) < 0,
                                })}
                            >
                                {toastContract.profit !== undefined
                                    ? `${toastContract.profit >= 0 ? '+' : ''}${formatMoney(
                                          toastContract.profit,
                                          toastContract.currency
                                      )}`
                                    : formatMoney(toastContract.buy_price, toastContract.currency)}
                            </strong>
                        </div>
                        {Boolean(toastContract.is_valid_to_sell) && !toastContract.is_sold && (
                            <button
                                type='button'
                                className='dt-contract-toast__sell'
                                disabled={sellingId === toastContract.contract_id}
                                onClick={() => handleSellContract(toastContract.contract_id)}
                            >
                                {sellingId === toastContract.contract_id
                                    ? 'Selling...'
                                    : `Sell ${
                                          toastContract.bid_price !== undefined
                                              ? formatMoney(toastContract.bid_price, toastContract.currency)
                                              : ''
                                      }`}
                            </button>
                        )}
                    </div>
                )}

                {/* Center Stage: View 0 = 10 Digit Circles (1000 ticks), View 1 = Live Tick Chart */}
                <div className='dt-stage'>
                    {viewIndex === 0 ? (
                        <div className='dt-digits-view'>
                            <div className='dt-digits-grid'>
                                {digitStats.map(stat => (
                                    <DigitCircle
                                        key={stat.digit}
                                        digit={stat.digit}
                                        percentage={stat.percentage}
                                        isMax={stat.isMax}
                                        isMin={stat.isMin}
                                        isSelected={needsDigitPrediction && prediction === stat.digit}
                                        isLatest={latestDigit === stat.digit}
                                        pointerState={latestDigit === stat.digit ? pointerState : 'idle'}
                                        interactive={needsDigitPrediction}
                                        onSelect={setPrediction}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className='dt-chart-view'>
                            {chartData ? (
                                <svg
                                    className='dt-chart-svg'
                                    viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                                    preserveAspectRatio='none'
                                >
                                    <defs>
                                        <linearGradient id='dtChartFill' x1='0' y1='0' x2='0' y2='1'>
                                            <stop offset='0%' stopColor='#00a79e' stopOpacity='0.28' />
                                            <stop offset='100%' stopColor='#00a79e' stopOpacity='0.0' />
                                        </linearGradient>
                                    </defs>
                                    {chartData.gridLevels.map((lvl, idx) => (
                                        <g key={idx}>
                                            <line
                                                x1={chartData.padX}
                                                y1={lvl.y}
                                                x2={chartData.padX + chartData.usableW}
                                                y2={lvl.y}
                                                stroke='#1c1f24'
                                                strokeWidth='1'
                                            />
                                            <text
                                                x={chartData.padX + chartData.usableW + 8}
                                                y={lvl.y + 4}
                                                fill='#6e7278'
                                                fontSize='11'
                                                fontFamily='IBM Plex Sans, Inter, sans-serif'
                                            >
                                                {lvl.price}
                                            </text>
                                        </g>
                                    ))}
                                    <path d={chartData.areaPath} fill='url(#dtChartFill)' />
                                    <path
                                        d={chartData.linePath}
                                        fill='none'
                                        stroke='#00a79e'
                                        strokeWidth='2'
                                        strokeLinejoin='round'
                                    />
                                    <line
                                        x1={chartData.padX}
                                        y1={chartData.last.y}
                                        x2={chartData.padX + chartData.usableW}
                                        y2={chartData.last.y}
                                        stroke='#ffffff'
                                        strokeOpacity='0.35'
                                        strokeDasharray='3 3'
                                    />
                                    <circle cx={chartData.last.x} cy={chartData.last.y} r='4.5' fill='#ffffff' />
                                    <rect
                                        x={chartData.padX + chartData.usableW + 4}
                                        y={chartData.last.y - 10}
                                        width='64'
                                        height='20'
                                        rx='3'
                                        fill='#ffffff'
                                    />
                                    <text
                                        x={chartData.padX + chartData.usableW + 36}
                                        y={chartData.last.y + 4}
                                        fill='#0e0e0e'
                                        fontSize='11'
                                        fontWeight='700'
                                        textAnchor='middle'
                                        fontFamily='IBM Plex Sans, Inter, sans-serif'
                                    >
                                        {chartData.last.quote.toFixed(decimals)}
                                    </text>
                                </svg>
                            ) : (
                                <div className='dt-chart-loading'>{localize('Connecting live market feed...')}</div>
                            )}
                        </div>
                    )}
                </div>

                {/* << and >> Swipeable View Switcher Arrows (matching Screenshot_20261108_123439_Chrome.png) */}
                <div className='dt-swipe-nav'>
                    <button
                        type='button'
                        className={classNames('dt-swipe-nav__btn', {
                            'dt-swipe-nav__btn--disabled': viewIndex === 0,
                        })}
                        onClick={() => setViewIndex(0)}
                        aria-label='Digits view'
                    >
                        <svg width='20' height='20' viewBox='0 0 20 20' aria-hidden='true'>
                            <path
                                d='M10.5 4.5L5 10l5.5 5.5M15.5 4.5L10 10l5.5 5.5'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='1.5'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                    </button>
                    <button
                        type='button'
                        className={classNames('dt-swipe-nav__btn', {
                            'dt-swipe-nav__btn--disabled': viewIndex === 1,
                        })}
                        onClick={() => setViewIndex(1)}
                        aria-label='Chart view'
                    >
                        <svg width='20' height='20' viewBox='0 0 20 20' aria-hidden='true'>
                            <path
                                d='M4.5 4.5L10 10l-5.5 5.5M9.5 4.5L15 10l-5.5 5.5'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='1.5'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Bottom Sheet (Mobile/Tablet) & Right Sidebar (Desktop) */}
            <div className='dt-panel'>
                {/* Mobile / Compact Collapsible Bottom Sheet (1:1 Screenshot Match) */}
                <div className='dt-mobile-sheet'>
                    <button
                        type='button'
                        className='dt-mobile-sheet__handle-wrap'
                        onClick={() => setIsExpanded(prev => !prev)}
                        aria-label='Toggle trade parameters'
                    >
                        <span className='dt-mobile-sheet__handle' />
                    </button>

                    <button
                        type='button'
                        className='dt-learn-link'
                        onClick={() => {
                            setInfoFamily(family);
                            setTradeTypeModalView('info');
                            setIsTradeTypeModalOpen(true);
                        }}
                    >
                        Learn about this trade type
                    </button>

                    {/* Row 1: [Icons] Over/Under >  +  Digit: 2 */}
                    <div className='dt-contract-row'>
                        <button
                            type='button'
                            className='dt-contract-selector'
                            onClick={() => {
                                setTradeTypeModalView('list');
                                setIsTradeTypeModalOpen(true);
                            }}
                        >
                            <span className='dt-contract-selector__icons'>
                                <TradeTypeIcon type={currentFamilyMeta.icons[0]} tone='coral' size={18} />
                                <TradeTypeIcon type={currentFamilyMeta.icons[1]} tone='coral' size={18} />
                            </span>
                            <span className='dt-contract-selector__label'>{currentFamilyMeta.label}</span>
                            <svg
                                className='dt-contract-selector__chevron'
                                width='16'
                                height='16'
                                viewBox='0 0 16 16'
                                aria-hidden='true'
                            >
                                <path
                                    d='M6 3.5L10.5 8L6 12.5'
                                    fill='none'
                                    stroke='#c2c2c2'
                                    strokeWidth='1.4'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>

                        {needsDigitPrediction && !isExpanded && (
                            <button
                                type='button'
                                className='dt-digit-pill'
                                onClick={() => setIsExpanded(true)}
                            >
                                Digit: {prediction}
                            </button>
                        )}

                        {needsBarrierOffset && !isExpanded && (
                            <button
                                type='button'
                                className='dt-digit-pill'
                                onClick={() => setIsExpanded(true)}
                            >
                                {barrierOffset}
                            </button>
                        )}
                    </div>

                    {/* Collapsible Inline Parameter Row (Last Digit Prediction / Barrier / Allow Equals) */}
                    {isExpanded && (
                        <div className='dt-expanded-box'>
                            {needsDigitPrediction && (
                                <div className='dt-inline-digits'>
                                    <div className='dt-inline-digits__head'>
                                        <span>Last Digit Prediction</span>
                                        <button type='button' onClick={() => setIsExpanded(false)}>
                                            Done
                                        </button>
                                    </div>
                                    <div className='dt-inline-digits__grid'>
                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                            <button
                                                key={d}
                                                type='button'
                                                className={classNames('dt-inline-digits__btn', {
                                                    'dt-inline-digits__btn--active': prediction === d,
                                                })}
                                                onClick={() => setPrediction(d)}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {needsBarrierOffset && (
                                <div className='dt-inline-barrier'>
                                    <label className='dt-inline-barrier__label'>Barrier offset</label>
                                    <input
                                        type='text'
                                        className='dt-inline-barrier__input'
                                        value={barrierOffset}
                                        onChange={e => setBarrierOffset(e.target.value)}
                                        placeholder='+0.50'
                                    />
                                </div>
                            )}

                            {family === 'rise_fall' && (
                                <label className='dt-allow-equals'>
                                    <input
                                        type='checkbox'
                                        checked={allowEquals}
                                        onChange={e => setAllowEquals(e.target.checked)}
                                    />
                                    <span>Allow equals</span>
                                </label>
                            )}
                        </div>
                    )}

                    {/* Row 2: 1 tick | 1.00 USD | Stake */}
                    <div className='dt-mobile-widget'>
                        <button
                            type='button'
                            className='dt-mobile-widget__duration'
                            onClick={() => openParamsModal('duration')}
                        >
                            {humanDuration}
                        </button>
                        <button
                            type='button'
                            className='dt-mobile-widget__amount'
                            onClick={() => openParamsModal('amount')}
                        >
                            {formatMoney(amount, currency)}
                        </button>
                        <button
                            type='button'
                            className='dt-mobile-widget__basis'
                            onClick={() => openParamsModal('amount')}
                        >
                            {basis === 'stake' ? 'Stake' : 'Payout'}
                        </button>
                    </div>

                    {activeQuoteError && <div className='dt-error-strip'>{activeQuoteError}</div>}

                    {/* Row 3: Two-Tone Teal Over & Red Under Purchase Buttons */}
                    {renderPurchaseButtons(false)}
                </div>

                {/* Desktop Sidebar (deriv-dtrader.vercel.app ScreenLarge dark fieldsets) */}
                <div className='dt-desktop-sidebar'>
                    <div className='dt-fieldset'>
                        <button
                            type='button'
                            className='dt-learn-link'
                            onClick={() => {
                                setInfoFamily(family);
                                setTradeTypeModalView('info');
                                setIsTradeTypeModalOpen(true);
                            }}
                        >
                            Learn about this trade type
                        </button>
                        <button
                            type='button'
                            className='dt-contract-selector'
                            onClick={() => {
                                setTradeTypeModalView('list');
                                setIsTradeTypeModalOpen(true);
                            }}
                        >
                            <span className='dt-contract-selector__icons'>
                                <TradeTypeIcon type={currentFamilyMeta.icons[0]} tone='coral' size={18} />
                                <TradeTypeIcon type={currentFamilyMeta.icons[1]} tone='coral' size={18} />
                            </span>
                            <span className='dt-contract-selector__label'>{currentFamilyMeta.label}</span>
                            <svg
                                className='dt-contract-selector__chevron'
                                width='16'
                                height='16'
                                viewBox='0 0 16 16'
                                aria-hidden='true'
                            >
                                <path
                                    d='M6 3.5L10.5 8L6 12.5'
                                    fill='none'
                                    stroke='#c2c2c2'
                                    strokeWidth='1.4'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>
                    </div>

                    {needsDigitPrediction && (
                        <div className='dt-fieldset'>
                            <div className='dt-fieldset__label'>Last Digit Prediction</div>
                            <div className='dt-inline-digits__grid'>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                    <button
                                        key={d}
                                        type='button'
                                        className={classNames('dt-inline-digits__btn', {
                                            'dt-inline-digits__btn--active': prediction === d,
                                        })}
                                        onClick={() => setPrediction(d)}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {needsBarrierOffset && (
                        <div className='dt-fieldset'>
                            <div className='dt-fieldset__label'>Barrier</div>
                            <input
                                type='text'
                                className='dt-inline-barrier__input'
                                value={barrierOffset}
                                onChange={e => setBarrierOffset(e.target.value)}
                                placeholder='+0.50'
                            />
                        </div>
                    )}

                    <div className='dt-fieldset'>
                        {!isDigitFamily ? (
                            <div className='dt-seg-tabs'>
                                {(['t', 's', 'm'] as TDurationUnit[]).map(u => (
                                    <button
                                        key={u}
                                        type='button'
                                        className={classNames('dt-seg-tabs__btn', {
                                            'dt-seg-tabs__btn--active': durationUnit === u,
                                        })}
                                        onClick={() => {
                                            setDurationUnit(u);
                                            if (u === 't' && Number(duration) > 10) setDuration('5');
                                            if (u === 's' && Number(duration) < 15) setDuration('15');
                                        }}
                                    >
                                        {u === 't' ? 'Ticks' : u === 's' ? 'Seconds' : 'Minutes'}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className='dt-fieldset__label'>Ticks</div>
                        )}

                        <div className='dt-stepper'>
                            <button type='button' className='dt-stepper__btn' onClick={() => adjustDuration(-1)}>
                                −
                            </button>
                            <input
                                type='number'
                                min={1}
                                max={durationUnit === 't' ? 10 : 120}
                                className='dt-stepper__input'
                                value={duration}
                                onChange={e => setDuration(e.target.value)}
                            />
                            <button type='button' className='dt-stepper__btn' onClick={() => adjustDuration(1)}>
                                +
                            </button>
                        </div>
                    </div>

                    <div className='dt-fieldset'>
                        <div className='dt-seg-tabs'>
                            {(['stake', 'payout'] as TBasis[]).map(b => (
                                <button
                                    key={b}
                                    type='button'
                                    className={classNames('dt-seg-tabs__btn', {
                                        'dt-seg-tabs__btn--active': basis === b,
                                    })}
                                    onClick={() => setBasis(b)}
                                >
                                    {b === 'stake' ? 'Stake' : 'Payout'}
                                </button>
                            ))}
                        </div>
                        <div className='dt-stepper'>
                            <button type='button' className='dt-stepper__btn' onClick={() => adjustAmount(-1)}>
                                −
                            </button>
                            <div className='dt-stepper__money'>
                                <input
                                    type='number'
                                    min='0.35'
                                    step='0.5'
                                    className='dt-stepper__input'
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                />
                                <span className='dt-stepper__ccy'>{currency}</span>
                            </div>
                            <button type='button' className='dt-stepper__btn' onClick={() => adjustAmount(1)}>
                                +
                            </button>
                        </div>

                        {family === 'rise_fall' && (
                            <label className='dt-allow-equals'>
                                <input
                                    type='checkbox'
                                    checked={allowEquals}
                                    onChange={e => setAllowEquals(e.target.checked)}
                                />
                                <span>Allow equals</span>
                            </label>
                        )}
                    </div>

                    {activeQuoteError && <div className='dt-error-strip'>{activeQuoteError}</div>}

                    <div className='dt-fieldset dt-fieldset--purchase'>{renderPurchaseButtons(true)}</div>
                </div>
            </div>

            {/* Market Selector Modal */}
            {isMarketModalOpen && (
                <div className='dt-modal-backdrop' onClick={() => setIsMarketModalOpen(false)}>
                    <div className='dt-modal' onClick={e => e.stopPropagation()}>
                        <div className='dt-modal__header'>
                            <h3>Markets</h3>
                            <button
                                type='button'
                                className='dt-modal__close'
                                onClick={() => setIsMarketModalOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className='dt-modal__search-wrap'>
                            <input
                                type='text'
                                className='dt-modal__search'
                                placeholder='Search markets...'
                                value={marketSearch}
                                onChange={e => setMarketSearch(e.target.value)}
                            />
                        </div>
                        <div className='dt-modal__cats'>
                            {marketCategories.map(cat => (
                                <button
                                    key={cat}
                                    type='button'
                                    className={classNames('dt-modal__cat', {
                                        'dt-modal__cat--active': marketCategory === cat,
                                    })}
                                    onClick={() => setMarketCategory(cat)}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                        <div className='dt-modal__body'>
                            {groupedMarkets.map(([groupName, items]) => (
                                <div key={groupName} className='dt-market-group'>
                                    <div className='dt-market-group__title'>{groupName}</div>
                                    {items.map(item => (
                                        <button
                                            key={item.symbol}
                                            type='button'
                                            className={classNames('dt-market-option', {
                                                'dt-market-option--active': item.symbol === symbol,
                                            })}
                                            onClick={() => {
                                                setSymbol(item.symbol);
                                                setIsMarketModalOpen(false);
                                            }}
                                        >
                                            <MarketSymbolIcon symbol={item.symbol} displayName={item.display_name} />
                                            <span className='dt-market-option__name'>{item.display_name}</span>
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Trade Types & "Learn about this trade type" Modal */}
            {isTradeTypeModalOpen && (
                <div className='dt-modal-backdrop' onClick={() => setIsTradeTypeModalOpen(false)}>
                    <div className='dt-modal' onClick={e => e.stopPropagation()}>
                        <div className='dt-modal__header'>
                            {tradeTypeModalView === 'info' ? (
                                <button
                                    type='button'
                                    className='dt-modal__back'
                                    onClick={() => setTradeTypeModalView('list')}
                                >
                                    ‹ Trade types
                                </button>
                            ) : (
                                <h3>Trade types</h3>
                            )}
                            <button
                                type='button'
                                className='dt-modal__close'
                                onClick={() => setIsTradeTypeModalOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        {tradeTypeModalView === 'list' ? (
                            <>
                                <div className='dt-modal__cats'>
                                    {(['All', 'Digits', 'Up/Down'] as const).map(cat => (
                                        <button
                                            key={cat}
                                            type='button'
                                            className={classNames('dt-modal__cat', {
                                                'dt-modal__cat--active': tradeTypeCategory === cat,
                                            })}
                                            onClick={() => setTradeTypeCategory(cat)}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                                <div className='dt-modal__body'>
                                    {(['Digits', 'Up/Down'] as const)
                                        .filter(cat => tradeTypeCategory === 'All' || tradeTypeCategory === cat)
                                        .map(cat => (
                                            <div key={cat} className='dt-market-group'>
                                                <div className='dt-market-group__title'>{cat}</div>
                                                {TRADE_TYPE_META.filter(m => m.category === cat).map(meta => (
                                                    <div key={meta.id} className='dt-tradetype-item'>
                                                        <button
                                                            type='button'
                                                            className={classNames('dt-tradetype-item__main', {
                                                                'dt-tradetype-item__main--active': family === meta.id,
                                                            })}
                                                            onClick={() => {
                                                                setFamily(meta.id);
                                                                setIsTradeTypeModalOpen(false);
                                                            }}
                                                        >
                                                            <span className='dt-contract-selector__icons'>
                                                                <TradeTypeIcon
                                                                    type={meta.icons[0]}
                                                                    tone='coral'
                                                                    size={18}
                                                                />
                                                                <TradeTypeIcon
                                                                    type={meta.icons[1]}
                                                                    tone='coral'
                                                                    size={18}
                                                                />
                                                            </span>
                                                            <span>{meta.label}</span>
                                                        </button>
                                                        <button
                                                            type='button'
                                                            className='dt-tradetype-item__info'
                                                            onClick={() => {
                                                                setInfoFamily(meta.id);
                                                                setTradeTypeModalView('info');
                                                            }}
                                                            aria-label={`Learn about ${meta.label}`}
                                                        >
                                                            i
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                </div>
                            </>
                        ) : (
                            <div className='dt-modal__body dt-info-view'>
                                {(() => {
                                    const infoMeta =
                                        TRADE_TYPE_META.find(m => m.id === infoFamily) || currentFamilyMeta;
                                    return (
                                        <>
                                            <div className='dt-info-view__badge'>
                                                <TradeTypeIcon type={infoMeta.icons[0]} tone='coral' size={22} />
                                                <TradeTypeIcon type={infoMeta.icons[1]} tone='coral' size={22} />
                                                <h4>{infoMeta.label}</h4>
                                            </div>
                                            <p className='dt-info-view__p'>{infoMeta.description}</p>
                                            <p className='dt-info-view__p'>{infoMeta.winRule}</p>
                                            <button
                                                type='button'
                                                className='dt-modal__primary-btn'
                                                onClick={() => {
                                                    setFamily(infoMeta.id);
                                                    setIsTradeTypeModalOpen(false);
                                                }}
                                            >
                                                Choose {infoMeta.label}
                                            </button>
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Mobile Duration & Stake/Payout Modal (TradeParamsModal) */}
            {isParamsModalOpen && (
                <div className='dt-modal-backdrop' onClick={() => commitParamsModal()}>
                    <div className='dt-modal dt-modal--params' onClick={e => e.stopPropagation()}>
                        <div className='dt-modal__tabs'>
                            <button
                                type='button'
                                className={classNames('dt-modal__tab', {
                                    'dt-modal__tab--active': paramsModalTab === 'duration',
                                })}
                                onClick={() => setParamsModalTab('duration')}
                            >
                                Duration
                            </button>
                            <button
                                type='button'
                                className={classNames('dt-modal__tab', {
                                    'dt-modal__tab--active': paramsModalTab === 'amount',
                                })}
                                onClick={() => setParamsModalTab('amount')}
                            >
                                Amount
                            </button>
                            <button type='button' className='dt-modal__close' onClick={() => commitParamsModal()}>
                                ×
                            </button>
                        </div>

                        {paramsModalTab === 'duration' ? (
                            <div className='dt-params-body'>
                                {!isDigitFamily && (
                                    <div className='dt-seg-tabs'>
                                        {(['t', 's', 'm'] as TDurationUnit[]).map(u => (
                                            <button
                                                key={u}
                                                type='button'
                                                className={classNames('dt-seg-tabs__btn', {
                                                    'dt-seg-tabs__btn--active': durationUnit === u,
                                                })}
                                                onClick={() => {
                                                    setDurationUnit(u);
                                                    if (u === 't' && Number(duration) > 10) setDuration('5');
                                                    if (u === 's' && Number(duration) < 15) setDuration('15');
                                                }}
                                            >
                                                {u === 't' ? 'Ticks' : u === 's' ? 'Seconds' : 'Minutes'}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {durationUnit === 't' ? (
                                    <div className='dt-ticks-picker'>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => (
                                            <button
                                                key={t}
                                                type='button'
                                                className={classNames('dt-ticks-picker__btn', {
                                                    'dt-ticks-picker__btn--active': Number(duration) === t,
                                                })}
                                                onClick={() => setDuration(String(t))}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className='dt-stepper'>
                                        <button
                                            type='button'
                                            className='dt-stepper__btn'
                                            onClick={() => adjustDuration(-1)}
                                        >
                                            −
                                        </button>
                                        <input
                                            type='number'
                                            min={1}
                                            max={120}
                                            className='dt-stepper__input'
                                            value={duration}
                                            onChange={e => setDuration(e.target.value)}
                                        />
                                        <button
                                            type='button'
                                            className='dt-stepper__btn'
                                            onClick={() => adjustDuration(1)}
                                        >
                                            +
                                        </button>
                                    </div>
                                )}

                                <button
                                    type='button'
                                    className='dt-modal__primary-btn'
                                    onClick={() => commitParamsModal()}
                                >
                                    OK
                                </button>
                            </div>
                        ) : (
                            <div className='dt-params-body'>
                                <div className='dt-seg-tabs'>
                                    {(['stake', 'payout'] as TBasis[]).map(b => (
                                        <button
                                            key={b}
                                            type='button'
                                            className={classNames('dt-seg-tabs__btn', {
                                                'dt-seg-tabs__btn--active': basis === b,
                                            })}
                                            onClick={() => setBasis(b)}
                                        >
                                            {b === 'stake' ? 'Stake' : 'Payout'}
                                        </button>
                                    ))}
                                </div>

                                <div className='dt-amount-display'>
                                    <span>{draftAmount || '0'}</span>
                                    <small>{currency}</small>
                                </div>

                                <div className='dt-quick-chips'>
                                    {['0.35', '1', '2', '5', '10', '25'].map(preset => (
                                        <button
                                            key={preset}
                                            type='button'
                                            className={classNames('dt-quick-chips__btn', {
                                                'dt-quick-chips__btn--active': Number(draftAmount) === Number(preset),
                                            })}
                                            onClick={() => setDraftAmount(preset)}
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                </div>

                                <div className='dt-keypad'>
                                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACK'].map(k => (
                                        <button
                                            key={k}
                                            type='button'
                                            className='dt-keypad__btn'
                                            onClick={() => handleKeypadPress(k)}
                                        >
                                            {k === 'BACK' ? '⌫' : k}
                                        </button>
                                    ))}
                                </div>

                                <button
                                    type='button'
                                    className='dt-modal__primary-btn'
                                    onClick={() => commitParamsModal()}
                                >
                                    OK
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Positions Drawer (on demand only — zero clutter on main page) */}
            {isPositionsOpen && (
                <div className='dt-modal-backdrop' onClick={() => setIsPositionsOpen(false)}>
                    <div className='dt-modal' onClick={e => e.stopPropagation()}>
                        <div className='dt-modal__header'>
                            <h3>Positions ({contracts.length})</h3>
                            <button
                                type='button'
                                className='dt-modal__close'
                                onClick={() => setIsPositionsOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className='dt-modal__body'>
                            {contracts.map(c => {
                                const isOpen = !c.is_sold && (!c.status || c.status === 'open');
                                const profit = Number(c.profit ?? 0);
                                return (
                                    <div key={c.contract_id} className='dt-pos-card'>
                                        <div className='dt-pos-card__top'>
                                            <div className='dt-pos-card__sym'>
                                                <TradeTypeIcon
                                                    type={c.contract_type || 'CALL'}
                                                    tone='coral'
                                                    size={16}
                                                />
                                                <strong>{c.symbol || symbol}</strong>
                                            </div>
                                            <span
                                                className={classNames('dt-pos-card__badge', {
                                                    'dt-pos-card__badge--open': isOpen,
                                                    'dt-pos-card__badge--won': !isOpen && profit >= 0,
                                                    'dt-pos-card__badge--lost': !isOpen && profit < 0,
                                                })}
                                            >
                                                {isOpen ? 'Open' : profit >= 0 ? 'Won' : 'Lost'}
                                            </span>
                                        </div>
                                        {c.longcode && <div className='dt-pos-card__desc'>{c.longcode}</div>}
                                        <div className='dt-pos-card__bottom'>
                                            <span>Buy: {formatMoney(c.buy_price, c.currency)}</span>
                                            <strong
                                                className={classNames({
                                                    'dt-contract-toast__pnl--pos': profit > 0,
                                                    'dt-contract-toast__pnl--neg': profit < 0,
                                                })}
                                            >
                                                {c.profit !== undefined
                                                    ? `${profit >= 0 ? '+' : ''}${formatMoney(profit, c.currency)}`
                                                    : '--'}
                                            </strong>
                                            {Boolean(c.is_valid_to_sell) && isOpen && (
                                                <button
                                                    type='button'
                                                    className='dt-contract-toast__sell'
                                                    disabled={sellingId === c.contract_id}
                                                    onClick={() => handleSellContract(c.contract_id)}
                                                >
                                                    {sellingId === c.contract_id ? 'Selling...' : 'Sell'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default Dtrader;
