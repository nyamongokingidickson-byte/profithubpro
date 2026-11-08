import React, { useEffect, useState } from 'react';
import { Localize } from '@deriv-com/translations';
import './dev-tools-blocker.scss';

const DevToolsBlocker = () => {
    const [is_blocked, setIsBlocked] = useState(false);

    useEffect(() => {
        // Only run in production to avoid blocking ourselves during dev
        if (process.env.NODE_ENV !== 'production') return;

        const check = () => {
            const threshold = 160;
            const widthDiff = window.outerWidth - window.innerWidth > threshold;
            const heightDiff = window.outerHeight - window.innerHeight > threshold;

            if (widthDiff || heightDiff) {
                setIsBlocked(true);
            }
        };

        // Debugger trap - triggers when devtools are open
        const interval = setInterval(() => {
            const startTime = performance.now();
            debugger;
            const endTime = performance.now();
            if (endTime - startTime > 100) {
                setIsBlocked(true);
            }
        }, 1000);

        window.addEventListener('resize', check);
        
        return () => {
            window.removeEventListener('resize', check);
            clearInterval(interval);
        };
    }, []);

    if (!is_blocked) return null;

    return (
        <div className='dev-blocker-overlay'>
            <div className='blocker-card'>
                <div className='blocker-accent-line' />
                
                <div className='blocker-badges'>
                    <div className='badge badge--restricted'>
                        <span className='dot' />
                        <Localize i18n_default_text='ACCESS RESTRICTED' />
                    </div>
                    <div className='badge badge--shield'>
                        <span className='icon'>⚠</span>
                        <Localize i18n_default_text='DYLAN TRADES DANGER SHIELD' />
                    </div>
                </div>

                <h1 className='blocker-title'>
                    <Localize i18n_default_text='Restricted danger zone' />
                </h1>

                <p className='blocker-text'>
                    <Localize i18n_default_text='Developer tools are blocked on Dylan Trades. Close inspection tools and reload the page to continue.' />
                </p>

                <div className='blocker-status'>
                    <Localize i18n_default_text='Alarm siren arming...' />
                </div>

                <div className='blocker-footer'>
                    <p className='footer-label'><Localize i18n_default_text='Follow Dylan Trades' /></p>
                    <div className='social-grid'>
                        <a href='#' className='social-item'>
                            <span className='icon'>📷</span>
                            <span>Instagram</span>
                        </a>
                        <a href='#' className='social-item'>
                            <span className='icon'>💬</span>
                            <span>WhatsApp</span>
                        </a>
                        <a href='#' className='social-item'>
                            <span className='icon'>🎵</span>
                            <span>TikTok</span>
                        </a>
                        <a href='#' className='social-item'>
                            <span className='icon'>✈</span>
                            <span>Telegram</span>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DevToolsBlocker;
