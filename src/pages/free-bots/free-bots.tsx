import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { getBotsManifest, fetchXmlWithCache, isValidBotXml } from '@/utils/freebots-cache';
import { FREE_BOTS_DATA } from './free-bots-data';
import './free-bots.scss';

interface BotData {
    name: string;
    description: string;
    difficulty: string;
    strategy: string;
    features: string[];
    xml: string;
    xmlPath?: string;
}

const DEFAULT_FEATURES = ['Automated Trading', 'Risk Management', 'Profit Optimization'];

const FreeBots = observer(() => {
    const { dashboard, app } = useStore();
    const { active_tab, setActiveTab, setPendingFreeBot } = dashboard;
    const [availableBots, setAvailableBots] = useState<BotData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Manifest-driven list matching real XML bots in public/xml/
    const getXmlFiles = () => {
        return [
            { name: '$DollarprinterbotOrignal$', file: '$DollarprinterbotOrignal$.xml' },
            { name: 'Candle-Mine Version 2 (2)', file: 'Candle-Mine Version 2  (2).xml' },
            { name: 'EVEN/ODD SPEED EXECUTOR BOT', file: 'MKOREAN SV6 BOT (1).xml' },
            { name: 'Printed Dollars Bot', file: 'Printed_dollars_Bot.xml' },
            { name: 'SPEEDBOT ACCOUNT FLIPPER', file: 'legoospeedbot.xml' },
        ];
    };

    const getPublicPath = (path: string) => `/${path.split('/').map(part => encodeURIComponent(part)).join('/')}`;

    const getProFreeBotSkeletons = (): BotData[] =>
        FREE_BOTS_DATA.map(bot => ({
            name: bot.name,
            description: bot.description,
            difficulty: bot.isPremium ? 'Premium' : 'Standard',
            strategy: bot.category,
            features: [bot.category, bot.isPremium ? 'Pro XML Bot' : 'Free XML Bot', 'Bot Builder Ready'],
            xml: '',
            xmlPath: bot.xmlPath,
        }));

    // Wait for workspace to be available
    const waitForWorkspace = (maxAttempts = 10, delay = 500) => {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const checkWorkspace = () => {
                attempts++;
                if (window.Blockly?.derivWorkspace) {
                    console.log('Workspace is ready!');
                    resolve(window.Blockly.derivWorkspace);
                } else if (attempts >= maxAttempts) {
                    reject(new Error('Workspace not available after maximum attempts'));
                } else {
                    console.log(`Waiting for workspace... attempt ${attempts}/${maxAttempts}`);
                    setTimeout(checkWorkspace, delay);
                }
            };

            checkWorkspace();
        });
    };

    // Load bot into builder
    const loadBotIntoBuilder = async (bot: BotData) => {
        try {
            if (bot.xml) {
                console.log('Loading bot:', bot.name);
                console.log('Blockly workspace available:', !!window.Blockly?.derivWorkspace);

                // Flag the selected bot for the Bot Builder to load after navigation
                setPendingFreeBot({ name: bot.name, xml: bot.xml });

                // Navigate to Bot Builder; loading will be handled when workspace is ready
                setActiveTab(DBOT_TABS.BOT_BUILDER);

                console.log('Navigating to Bot Builder to load bot:', bot.name);
            }
        } catch (error) {
            console.error('Error loading bot:', error);
        }
    };

    // Load bots with instant UI and progressive loading (no blocking spinner)
    useEffect(() => {
        const loadBots = async () => {
            if (active_tab !== DBOT_TABS.FREE_BOTS) return;

            setError(null);

            // 0) Immediately render skeleton cards from real manifest defaults + Pro Bots
            const fallback = getXmlFiles();
            const initialSkeleton: BotData[] = fallback.map(item => ({
                name: (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' '),
                description: `Advanced trading bot: ${(item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ')}`,
                difficulty: 'Intermediate',
                strategy: 'Multi-Strategy',
                features: DEFAULT_FEATURES,
                xml: '',
            }));
            const proSkeletons = getProFreeBotSkeletons();
            setAvailableBots([...initialSkeleton, ...proSkeletons]);
            setIsLoading(false); // hide "Loading free bots..." right away

            try {
                // 1) Fetch manifest with generous timeout; fallback to initial list if slow
                const withTimeout = <T,>(p: Promise<T>, ms = 4000): Promise<T | null> =>
                    new Promise(resolve => {
                        const t = setTimeout(() => resolve(null), ms);
                        p.then(r => {
                            clearTimeout(t);
                            resolve(r);
                        }).catch(() => {
                            clearTimeout(t);
                            resolve(null);
                        });
                    });

                const manifest = (await withTimeout(getBotsManifest(), 4000)) || fallback;

                // 2) Update skeletons to match resolved manifest
                const skeletonBots: BotData[] = manifest.map(item => ({
                    name: (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' '),
                    description: `Advanced trading bot: ${(item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ')}`,
                    difficulty: 'Intermediate',
                    strategy: 'Multi-Strategy',
                    features: DEFAULT_FEATURES,
                    xml: '',
                }));
                setAvailableBots([...skeletonBots, ...proSkeletons]);

                // 3) Load manifest XMLs concurrently
                const manifestResults = await Promise.all(
                    manifest.map(async item => {
                        try {
                            const xml = await fetchXmlWithCache(item.file);
                            if (isValidBotXml(xml)) {
                                const botName = (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ');
                                return {
                                    name: botName,
                                    description: `Advanced trading bot: ${botName}`,
                                    difficulty: 'Intermediate',
                                    strategy: 'Multi-Strategy',
                                    features: DEFAULT_FEATURES,
                                    xml,
                                } as BotData;
                            }
                        } catch (err) {
                            console.warn(`Failed to load ${item.file}:`, err);
                        }
                        return null;
                    })
                );
                const loadedBots = manifestResults.filter((b): b is BotData => b !== null);
                setAvailableBots([...loadedBots, ...proSkeletons]);

                // 4) Load Pro XML bots in fast parallel batches of 6
                const loadedProBots: BotData[] = [];
                const batchSize = 6;
                for (let i = 0; i < FREE_BOTS_DATA.length; i += batchSize) {
                    const batch = FREE_BOTS_DATA.slice(i, i + batchSize);
                    const batchLoaded = await Promise.all(
                        batch.map(async bot => {
                            try {
                                const response = await fetch(getPublicPath(bot.xmlPath));
                                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                                const xml = await response.text();
                                if (!isValidBotXml(xml)) {
                                    throw new Error('Invalid XML returned for bot');
                                }
                                return {
                                    name: bot.name,
                                    description: bot.description,
                                    difficulty: bot.isPremium ? 'Premium' : 'Standard',
                                    strategy: bot.category,
                                    features: [
                                        bot.category,
                                        bot.isPremium ? 'Pro XML Bot' : 'Free XML Bot',
                                        'Bot Builder Ready',
                                    ],
                                    xml,
                                    xmlPath: bot.xmlPath,
                                } as BotData;
                            } catch (err) {
                                console.warn(`Failed to load pro free bot ${bot.xmlPath}:`, err);
                                return null;
                            }
                        })
                    );
                    loadedProBots.push(...batchLoaded.filter((b): b is BotData => b !== null));
                    const remainingSkeletons = proSkeletons.slice(Math.min(i + batchSize, proSkeletons.length));
                    setAvailableBots([...loadedBots, ...loadedProBots, ...remainingSkeletons]);
                }
            } catch (error) {
                console.error('Error loading bots:', error);
                setError('Failed to load bots. Please try again.');
            }
        };

        loadBots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

    return (
        <div className='free-bots'>
            <div className='free-bots__container'>
                {isLoading ? (
                    <div className='free-bots__loading'>
                        <Text size='s' color='general'>
                            {localize('Loading free bots...')}
                        </Text>
                    </div>
                ) : error ? (
                    <div className='free-bots__error'>
                        <Text size='s' color='general'>
                            {error}
                        </Text>
                        <div style={{ marginTop: '20px' }}>
                            <Button onClick={() => window.location.reload()}>{localize('Retry')}</Button>
                        </div>
                    </div>
                ) : availableBots.length === 0 ? (
                    <div className='free-bots__empty'>
                        <Text size='s' color='general'>
                            {localize('No bots available at the moment.')}
                        </Text>
                    </div>
                ) : (
                    <div className='free-bots__grid'>
                        {availableBots.map((bot, index) => (
                            <div key={index} className='free-bot-card'>
                                <div className='free-bot-card__header'>
                                    <Text size='s' weight='bold' className='free-bot-card__title'>
                                        {bot.name}
                                    </Text>
                                    <div className='free-bot-card__badges'>
                                        <span className='free-bot-card__badge free-bot-card__badge--difficulty'>
                                            {bot.difficulty}
                                        </span>
                                        <span className='free-bot-card__badge free-bot-card__badge--strategy'>
                                            {bot.strategy}
                                        </span>
                                    </div>
                                </div>

                                <Text size='xs' color='general' className='free-bot-card__description'>
                                    {bot.description}
                                </Text>

                                <div className='free-bot-card__features'>
                                    {bot.features.map((feature, featureIndex) => (
                                        <span key={featureIndex} className='free-bot-card__feature'>
                                            {feature}
                                        </span>
                                    ))}
                                </div>

                                <Button
                                    className='free-bot-card__load-btn'
                                    onClick={() => loadBotIntoBuilder(bot)}
                                    primary
                                    has_effect
                                    type='button'
                                    disabled={!bot.xml} // Disable if XML not loaded yet
                                >
                                    {bot.xml ? localize('Load Bot') : localize('Loading...')}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

export default FreeBots;
