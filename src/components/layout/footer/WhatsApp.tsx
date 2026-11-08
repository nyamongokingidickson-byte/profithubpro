import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';
import { URLConstants } from '@deriv-com/utils';

// Custom WhatsApp Icon - using your uploaded image
const CustomWhatsAppIcon = () => (
    <img src='/whatsapp icon.png' alt='WhatsApp' width='16' height='16' style={{ objectFit: 'contain' }} />
);

const WhatsApp = () => {
    const { localize } = useTranslations();

    // Get current domain for WhatsApp link
    const getCurrentDomain = () => {
        if (typeof window !== 'undefined') {
            return window.location.hostname;
        }
        return '';
    };

    // Domain-specific WhatsApp channel links
    const getWhatsAppLink = () => {
        const currentDomain = getCurrentDomain();

        const domainWhatsAppLinks: Record<string, string> = {
            // Legoo.site WhatsApp channel
            'legoo.site': 'https://whatsapp.com/channel/0029VbBFxBwGufIw230nxz0C',
            'www.legoo.site': 'https://whatsapp.com/channel/0029VbBFxBwGufIw230nxz0C',

            // Wallace site WhatsApp channel
            'wallacetraders.site': 'https://whatsapp.com/channel/0029Vb6ngek60eBo02nGKR3T',
            'www.wallacetraders.site': 'https://whatsapp.com/channel/0029Vb6ngek60eBo02nGKR3T',

            // Dylan Trades domain
            'dylantrades.site': URLConstants.whatsApp,
            'www.dylantrades.site': URLConstants.whatsApp,

            // Other domains use default Deriv WhatsApp
            'kingstraders.site': URLConstants.whatsApp,
            'www.kingstraders.site': URLConstants.whatsApp,
            'dbotprinters.site': URLConstants.whatsApp,
            'www.dbotprinters.site': URLConstants.whatsApp,
            'dbot12.netlify.app': URLConstants.whatsApp,
        };

        return domainWhatsAppLinks[currentDomain] || URLConstants.whatsApp;
    };

    return (
        <Tooltip
            as='a'
            className='app-footer__icon'
            href={getWhatsAppLink()}
            target='_blank'
            tooltipContent={localize('WhatsApp')}
        >
            <CustomWhatsAppIcon />
        </Tooltip>
    );
};

export default WhatsApp;
