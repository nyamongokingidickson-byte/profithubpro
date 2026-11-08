import { useCallback, useEffect, useRef, useState } from 'react';
import { LegacyLogout1pxIcon, LegacyMenuHamburger1pxIcon, LegacyTheme1pxIcon } from '@deriv/quill-icons/Legacy';
import { ToggleSwitch } from '@deriv-com/ui';
import { useTranslations } from '@deriv-com/translations';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { useStore } from '@/hooks/useStore';
import { website_name } from '@/utils/site-config';
import './app-logo.scss';

export const AppLogo = ({ onMenuClick }: { onMenuClick?: () => void }) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { client } = useStore() ?? {};
    const { oAuthLogout } = useOauth2({ handleLogout: async () => client?.logout(), client });
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const handleMenuToggle = useCallback(() => {
        setIsMenuOpen(prevState => !prevState);
    }, []);

    const handleCloseMenu = useCallback(() => {
        setIsMenuOpen(false);
    }, []);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
        };

        if (isMenuOpen) {
            document.addEventListener('mousedown', handleOutsideClick);
        }

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, [isMenuOpen]);

    return (
        <div className='app-header__logo-container' ref={menuRef}>
            <button
                className='app-header__menu-trigger'
                type='button'
                aria-label={localize('Open menu')}
                aria-expanded={isMenuOpen}
                onClick={handleMenuToggle}
            >
                <LegacyMenuHamburger1pxIcon iconSize='sm' fill='var(--text-general)' />
            </button>

            <a className='app-header__brand' href='/'>
                <img src='/dylantrades.svg' alt={website_name} className='app-header__brand-logo' />
                <span className='app-header__brand-name'>{website_name}</span>
            </a>

            {isMenuOpen && (
                <div className='app-header__menu-popover'>
                    <button type='button' className='app-header__menu-item' onClick={toggleTheme}>
                        <div className='app-header__menu-item__left'>
                            <LegacyTheme1pxIcon iconSize='xs' />
                            <span>{localize(is_dark_mode_on ? 'Light theme' : 'Dark theme')}</span>
                        </div>
                        <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />
                    </button>
                    <button
                        type='button'
                        className='app-header__menu-item app-header__menu-item--action'
                        onClick={() => {
                            handleCloseMenu();
                            oAuthLogout();
                        }}
                    >
                        <div className='app-header__menu-item__left'>
                            <LegacyLogout1pxIcon iconSize='xs' />
                            <span>{localize('Logout')}</span>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
};
