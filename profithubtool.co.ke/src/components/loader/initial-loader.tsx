import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import './initial-loader.scss';

const LOADING_MESSAGES = [
    'Initializing workspace...',
    'Connecting to Deriv servers...',
    'Loading market data...',
    'Preparing dashboard...',
    'Almost ready...'
];

export default function InitialLoader() {
    const [messageIndex, setMessageIndex] = useState(0);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const msgInterval = setInterval(() => {
            setMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
        }, 2000);

        const progInterval = setInterval(() => {
            setProgress(prev => {
                const step = Math.random() * 5 + 1; // Random step between 1 and 6
                const next = prev + step;
                return next >= 100 ? 100 : next;
            });
        }, 300);

        return () => {
            clearInterval(msgInterval);
            clearInterval(progInterval);
        };
    }, []);

    const whatsappNumber = '+254796428848';
    const whatsappLink = `https://wa.me/${whatsappNumber.replace('+', '')}`;

    return (
        <div className='premium-loader-overlay'>
            {/* Animated Gradient Background */}
            <div className='ambient-background'>
                <div className='gradient-orb orb-1' />
                <div className='gradient-orb orb-2' />
                <div className='gradient-orb orb-3' />
            </div>

            <div className='glass-card'>
                <div className='brand-container'>
                    <div className='logo-mark'>
                        <span className='logo-letter'>D</span>
                        <div className='logo-ring'></div>
                    </div>
                    <div className='brand-text'>
                        <h1 className='main-title'>DYLAN</h1>
                        <span className='sub-title'>TRADES</span>
                    </div>
                </div>

                <div className='loader-content'>
                    <div className='status-container'>
                        <AnimatePresence exitBeforeEnter>
                            <motion.div
                                key={messageIndex}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.3 }}
                                className='status-message'
                            >
                                {LOADING_MESSAGES[messageIndex]}
                            </motion.div>
                        </AnimatePresence>
                        <span className='progress-text'>{Math.floor(progress)}%</span>
                    </div>

                    <div className='progress-track'>
                        <motion.div 
                            className='progress-fill' 
                            animate={{ width: `${progress}%` }} 
                            transition={{ ease: "easeOut", duration: 0.3 }} 
                        />
                    </div>
                </div>

                <div className='card-footer'>
                    <a href={whatsappLink} target='_blank' rel='noopener noreferrer' className='support-btn'>
                        <svg className='w-icon' viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                        </svg>
                        <span>Support: {whatsappNumber}</span>
                    </a>
                </div>
            </div>

            <div className='bottom-text'>
                POWERED BY DERIV TECHNOLOGY
            </div>
        </div>
    );
}
