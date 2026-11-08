import React, { useState, useEffect, useRef } from 'react';
import './app-loader.scss';

interface AppLoaderProps {
    onLoadingComplete: () => void;
    duration?: number; // Duration in milliseconds, default 7000ms (7 seconds)
}

const AppLoader: React.FC<AppLoaderProps> = ({ onLoadingComplete, duration = 7000 }) => {
    const [progress, setProgress] = useState(1);
    const [isVisible, setIsVisible] = useState(true);
    const bgElementsRef = useRef<HTMLDivElement>(null);
    const minDuration = Math.max(duration, 7000);

    // Create twinkling stars
    const createStars = () => {
        if (!bgElementsRef.current) return;

        // Create many more stars for a rich starfield effect
        for (let i = 0; i < 200; i++) {
            const star = document.createElement('div');
            star.className = 'star';

            const size = Math.random() * 4 + 0.5; // Varied sizes from 0.5px to 4.5px
            const leftPos = Math.random() * 100;
            const topPos = Math.random() * 100;
            const duration = 2 + Math.random() * 8; // Faster twinkling
            const delay = Math.random() * 10; // More varied delays
            const opacity = 0.2 + Math.random() * 0.8; // More opacity variation

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${leftPos}%`;
            star.style.top = `${topPos}%`;
            star.style.setProperty('--duration', `${duration}s`);
            star.style.setProperty('--opacity', opacity.toString());
            star.style.animationDelay = `${delay}s`;

            // Add some stars with different shapes for variety
            if (Math.random() > 0.8) {
                star.style.borderRadius = '0';
                star.style.transform = 'rotate(45deg)';
            }

            bgElementsRef.current.appendChild(star);
        }
    };

    // Create falling dollar bills
    const createDollar = () => {
        if (!bgElementsRef.current) return;

        const dollarSigns = ['💰', '💵', '💲', '🪙', '💴', '💶', '💷', '💸', '🤑', '💎'];
        const dollar = document.createElement('div');
        dollar.className = 'dollar';
        dollar.textContent = dollarSigns[Math.floor(Math.random() * dollarSigns.length)];

        const leftPos = Math.random() * 100;
        const duration = 3 + Math.random() * 8; // Faster falling
        const delay = Math.random() * 2; // Less delay for more continuous flow
        const size = 0.6 + Math.random() * 1.8; // More size variation
        const rotation = Math.random() * 360;

        dollar.style.left = `${leftPos}%`;
        dollar.style.animationDuration = `${duration}s`;
        dollar.style.animationDelay = `${delay}s`;
        dollar.style.fontSize = `${size}em`;
        dollar.style.opacity = (0.4 + Math.random() * 0.6).toString();
        dollar.style.transform = `rotate(${rotation}deg)`;

        // Add some horizontal drift for more natural movement
        const drift = (Math.random() - 0.5) * 20;
        dollar.style.setProperty('--drift', `${drift}px`);

        bgElementsRef.current.appendChild(dollar);

        setTimeout(() => {
            if (dollar.parentNode === bgElementsRef.current) {
                bgElementsRef.current?.removeChild(dollar);
            }
        }, duration * 1000);
    };

    // Create multiple dollars at once for heavy rain effect
    const createDollarBurst = () => {
        // Create 5-8 dollars at once
        const burstCount = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => createDollar(), i * 50); // Slight stagger
        }
    };

    // Container hover effect
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const container = e.currentTarget;
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        container.style.transform = `translateY(0) rotate3d(${y}, ${x}, 0, ${(x - 0.5) * 2}deg) scale(1.02)`;
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.transform = 'translateY(0) rotate3d(0, 0, 0, 0) scale(1)';
    };

    // Initialize animations
    useEffect(() => {
        createStars();

        // Create initial heavy dollar rain
        for (let i = 0; i < 100; i++) {
            setTimeout(() => createDollar(), i * 30); // Create 100 dollars quickly
        }

        // Create continuous dollar bursts
        const dollarInterval = setInterval(createDollarBurst, 150); // More frequent bursts

        // Also create individual dollars for continuous flow
        const singleDollarInterval = setInterval(createDollar, 80);

        const startTime = Date.now();
        let currentProgress = 1;
        let speed = 0.5;
        const progressInterval = setInterval(() => {
            if (currentProgress < 30) {
                speed += 0.15;
            } else if (currentProgress > 85) {
                speed *= 0.85;
            }

            currentProgress = Math.min(currentProgress + speed, 100);
            setProgress(Math.floor(currentProgress));

            if (currentProgress >= 100) {
                clearInterval(progressInterval);
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, minDuration - elapsed);

                setTimeout(() => {
                    setIsVisible(false);
                    setTimeout(onLoadingComplete, 300); // Wait for fade out animation
                }, remaining + 200);
            }
        }, 40);

        return () => {
            clearInterval(dollarInterval);
            clearInterval(singleDollarInterval);
            clearInterval(progressInterval);
        };
    }, [onLoadingComplete]);

    if (!isVisible) return null;

    return (
        <div className='trading-hub-loader'>
            <div className='background-elements' ref={bgElementsRef}></div>

            <div className='loader-container' onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
                <div className='logo'>
                    <div className='logo-main'>DYLAN</div>
                    <div className='logo-sub'>TRADES</div>
                </div>

                <div className='welcome-message'>
                    <div className='welcome-title welcome-title--twinkle'>
                        <strong>WELCOME TO DYLAN TRADES</strong>
                    </div>
                    <div className='welcome-text'>
                        Experience advanced trading with intelligent automation, professional trade execution, and a powerful platform designed for high-performance traders.
                    </div>
                </div>

                <div className='features-container'>
                    <div className='feature-main'>Your trading platform, reimagined</div>
                    <ul className='feature-list'>
                        <li className='feature-item'>Smart Automation</li>
                        <li className='feature-item'>Copy Trading</li>
                        <li className='feature-item'>Real-time Analytics</li>
                    </ul>
                    <div className='feature-tagline'>Professional trading tools for everyone</div>
                </div>

                <div className='progress-container'>
                    <div className='progress-text'>
                        <span>Loading premium features</span>
                        <span className='progress-percent'>{progress}%</span>
                    </div>
                    <div className='progress-bar'>
                        <div className='progress-fill' style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className='progress-dots'>
                        <div className='progress-dot'></div>
                        <div className='progress-dot'></div>
                        <div className='progress-dot'></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AppLoader;
