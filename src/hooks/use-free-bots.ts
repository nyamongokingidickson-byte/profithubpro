import { useCallback, useState } from 'react';
import { FREE_BOTS_DATA } from '../pages/free-bots/free-bots-data';
import { useStore } from './useStore';

export const useFreeBots = () => {
    const { load_modal, dashboard } = useStore();
    const [selectedCategory, setSelectedCategory] = useState<string>('Official');
    const [isLoading, setIsLoading] = useState(false);

    const categories = ['Official', 'Hybrid', 'Normal', 'Automatic'];

    const filteredBots = FREE_BOTS_DATA.filter(bot => bot.category === selectedCategory);

    const loadBotToBuilder = useCallback(
        async (bot: (typeof FREE_BOTS_DATA)[0]) => {
            setIsLoading(true);
            try {
                // Fetch the XML from the server or local path (properly URL-encoded)
                const publicPath = `/${bot.xmlPath
                    .replace(/^\/+/, '')
                    .split('/')
                    .map(part => encodeURIComponent(part))
                    .join('/')}`;
                const response = await fetch(publicPath);
                if (!response.ok) {
                    throw new Error(`Failed to fetch bot XML: ${response.status} ${response.statusText}`);
                }

                const xmlString = await response.text();

                // Validate that we actually got XML content (not SPA HTML fallback)
                const trimmedXml = xmlString?.trim() || '';
                if (!trimmedXml.startsWith('<xml') && !trimmedXml.startsWith('<?xml')) {
                    throw new Error('Invalid XML content received');
                }

                // Parse XML to ensure it's valid before loading
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
                const parseError = xmlDoc.querySelector('parsererror');

                if (parseError) {
                    throw new Error('XML parsing failed: Invalid XML structure');
                }

                const strategy = {
                    id: bot.id,
                    name: bot.name,
                    xml: xmlString,
                    save_type: 'unsaved' as const,
                    timestamp: Date.now(),
                };

                // Load into Blockly workspace via load_modal
                await load_modal.loadStrategyToBuilder(strategy);

                // Navigate to Bot Builder tab
                dashboard.setActiveTab(1);

                console.log(`Successfully loaded bot: ${bot.name}`);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('Error loading bot:', error);
                // Show user-friendly error
                alert(`Failed to load bot "${bot.name}": ${errorMessage}`);
            } finally {
                setIsLoading(false);
            }
        },
        [load_modal, dashboard]
    );

    return {
        selectedCategory,
        setSelectedCategory,
        categories,
        filteredBots,
        loadBotToBuilder,
        isLoading,
    };
};
