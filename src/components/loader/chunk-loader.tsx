import React, { useEffect, useState } from 'react';

interface ChunkLoaderProps {
    message: string;
    backgroundUrl?: string;
}

export default function ChunkLoader({ message, backgroundUrl }: ChunkLoaderProps) {
    const [progress, setProgress] = useState(0);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const timer = setInterval(() => {
            setProgress(prev => {
                if (prev >= 92) { clearInterval(timer); return 92; }
                return prev + Math.random() * 8 + 2;
            });
        }, 400);
        return () => clearInterval(timer);
    }, []);

    const backdropStyle: React.CSSProperties = backgroundUrl
        ? {
            backgroundImage: `radial-gradient(ellipse at 30% 20%, rgba(6, 182, 212, 0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.06) 0%, transparent 50%), radial-gradient(circle at center, rgba(10, 15, 30, 0.95) 0%, rgba(2, 6, 15, 0.99) 100%), url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }
        : {
            background: 'radial-gradient(ellipse at 30% 20%, rgba(6, 182, 212, 0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.05) 0%, transparent 50%), radial-gradient(circle at center, #0a0f1e 0%, #020615 100%)'
          };

    return (
        <div className='premium-loader-container' style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            width: '100vw',
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            ...backdropStyle,
            fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
            color: '#ffffff',
            overflow: 'hidden',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=JetBrains+Mono:wght@500&display=swap');

                /* Ambient glow orbs */
                .premium-loader-ambient-1,
                .premium-loader-ambient-2,
                .premium-loader-ambient-3 {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(80px);
                    pointer-events: none;
                    animation: ambientDrift 8s ease-in-out infinite alternate;
                }
                .premium-loader-ambient-1 {
                    width: 300px; height: 300px;
                    background: rgba(6, 182, 212, 0.12);
                    top: -80px; left: -60px;
                    animation-delay: 0s;
                }
                .premium-loader-ambient-2 {
                    width: 250px; height: 250px;
                    background: rgba(139, 92, 246, 0.10);
                    bottom: -60px; right: -40px;
                    animation-delay: -3s;
                }
                .premium-loader-ambient-3 {
                    width: 200px; height: 200px;
                    background: rgba(16, 185, 129, 0.07);
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    animation-delay: -5s;
                }

                @keyframes ambientDrift {
                    0% { transform: translate(0, 0) scale(1); }
                    100% { transform: translate(30px, -20px) scale(1.15); }
                }

                /* Main card - neumorphic glass */
                .premium-loader-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 3.5rem 3rem;
                    border-radius: 32px;
                    background: linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
                    backdrop-filter: blur(40px) saturate(1.5);
                    -webkit-backdrop-filter: blur(40px) saturate(1.5);
                    border: 1px solid rgba(255, 255, 255, 0.06);
                    box-shadow:
                        0 30px 100px rgba(0, 0, 0, 0.6),
                        0 0 1px rgba(255, 255, 255, 0.1),
                        inset 0 1px 0 rgba(255, 255, 255, 0.05),
                        inset 0 -1px 0 rgba(0, 0, 0, 0.1),
                        0 0 80px rgba(6, 182, 212, 0.05);
                    max-width: 400px;
                    width: 90%;
                    text-align: center;
                    position: relative;
                    overflow: hidden;
                    animation: cardEntrance 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    transform: translateY(20px);
                    z-index: 2;
                }
                
                .premium-loader-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.3), rgba(139, 92, 246, 0.2), transparent);
                }

                @keyframes cardEntrance {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                /* Orbital spinner */
                .premium-loader-orbit-wrapper {
                    position: relative;
                    width: 88px;
                    height: 88px;
                    margin-bottom: 2.4rem;
                }

                .premium-loader-orbit-ring {
                    position: absolute;
                    inset: 0;
                    border-radius: 50%;
                    border: 2px solid transparent;
                    border-top-color: rgba(6, 182, 212, 0.8);
                    border-right-color: rgba(6, 182, 212, 0.2);
                    animation: orbitSpin 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                    filter: drop-shadow(0 0 6px rgba(6, 182, 212, 0.4));
                }

                .premium-loader-orbit-ring-2 {
                    position: absolute;
                    inset: 8px;
                    border-radius: 50%;
                    border: 2px solid transparent;
                    border-bottom-color: rgba(139, 92, 246, 0.6);
                    border-left-color: rgba(139, 92, 246, 0.15);
                    animation: orbitSpin 2s cubic-bezier(0.4, 0, 0.2, 1) infinite reverse;
                    filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.3));
                }

                .premium-loader-orbit-ring-3 {
                    position: absolute;
                    inset: 16px;
                    border-radius: 50%;
                    border: 1.5px solid transparent;
                    border-top-color: rgba(16, 185, 129, 0.5);
                    animation: orbitSpin 2.8s linear infinite;
                    filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.3));
                }

                .premium-loader-orbit-core {
                    position: absolute;
                    inset: 24px;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(6, 182, 212, 0.15) 0%, transparent 70%);
                    animation: corePulse 2s ease-in-out infinite;
                }

                .premium-loader-orbit-dot {
                    position: absolute;
                    top: 50%; left: 50%;
                    width: 8px; height: 8px;
                    margin: -4px 0 0 -4px;
                    border-radius: 50%;
                    background: #06b6d4;
                    box-shadow: 0 0 16px rgba(6, 182, 212, 0.6), 0 0 40px rgba(6, 182, 212, 0.2);
                    animation: corePulse 2s ease-in-out infinite;
                }

                @keyframes orbitSpin {
                    to { transform: rotate(360deg); }
                }

                @keyframes corePulse {
                    0%, 100% { opacity: 0.5; transform: scale(0.95); }
                    50% { opacity: 1; transform: scale(1.1); }
                }

                /* Brand text */
                .premium-loader-brand {
                    font-size: 2rem;
                    font-weight: 800;
                    letter-spacing: 0.1em;
                    background: linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #06b6d4 100%);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    text-transform: uppercase;
                    margin-bottom: 0.3rem;
                    font-family: 'Outfit', sans-serif;
                    animation: brandShimmer 4s linear infinite;
                }

                @keyframes brandShimmer {
                    to { background-position: 200% center; }
                }

                .premium-loader-subtitle {
                    font-size: 0.7rem;
                    font-weight: 600;
                    color: rgba(255, 255, 255, 0.25);
                    text-transform: uppercase;
                    letter-spacing: 0.4em;
                    margin-bottom: 2rem;
                }

                /* Progress bar - frosted glass */
                .premium-loader-progress-track {
                    width: 100%;
                    max-width: 260px;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.04);
                    border-radius: 100px;
                    overflow: hidden;
                    margin-bottom: 1.4rem;
                    position: relative;
                    border: 1px solid rgba(255, 255, 255, 0.03);
                }

                .premium-loader-progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #06b6d4, #8b5cf6, #06b6d4);
                    background-size: 300% 100%;
                    border-radius: 100px;
                    transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
                    position: relative;
                    animation: progressShimmer 2s linear infinite;
                }
                .premium-loader-progress-fill::after {
                    content: '';
                    position: absolute;
                    right: 0; top: -1px; bottom: -1px;
                    width: 20px;
                    background: radial-gradient(circle at right, rgba(6, 182, 212, 0.6), transparent);
                    border-radius: 50%;
                    filter: blur(3px);
                }

                @keyframes progressShimmer {
                    to { background-position: 300% 0; }
                }

                /* Status text */
                .premium-loader-status-text {
                    font-size: 0.8rem;
                    color: rgba(255, 255, 255, 0.45);
                    font-weight: 400;
                    font-family: 'Outfit', sans-serif;
                    letter-spacing: 0.02em;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .premium-loader-status-text .loader-percent {
                    font-family: 'JetBrains Mono', monospace;
                    font-weight: 500;
                    color: rgba(6, 182, 212, 0.7);
                    font-size: 0.75rem;
                }

                /* Floating dots */
                .premium-loader-dots-row {
                    display: flex;
                    gap: 5px;
                    margin-top: 0.6rem;
                }

                .premium-loader-dot {
                    width: 4px; height: 4px;
                    border-radius: 50%;
                    background: rgba(6, 182, 212, 0.5);
                    animation: dotFade 1.8s ease-in-out infinite;
                }
                .premium-loader-dot:nth-child(2) { animation-delay: 0.2s; }
                .premium-loader-dot:nth-child(3) { animation-delay: 0.4s; }

                @keyframes dotFade {
                    0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
                    40% { opacity: 1; transform: scale(1.2); }
                }

                /* Noise texture overlay */
                .premium-loader-noise {
                    position: absolute;
                    inset: 0;
                    opacity: 0.015;
                    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
                    pointer-events: none;
                    z-index: 1;
                }
            `}</style>

            {/* Noise texture */}
            <div className='premium-loader-noise' />

            {/* Ambient glow orbs */}
            <div className='premium-loader-ambient-1' />
            <div className='premium-loader-ambient-2' />
            <div className='premium-loader-ambient-3' />

            <div className='premium-loader-card'>
                {/* Orbital spinner */}
                <div className='premium-loader-orbit-wrapper'>
                    <div className='premium-loader-orbit-ring' />
                    <div className='premium-loader-orbit-ring-2' />
                    <div className='premium-loader-orbit-ring-3' />
                    <div className='premium-loader-orbit-core' />
                    <div className='premium-loader-orbit-dot' />
                </div>

                <h1 className='premium-loader-brand'>Dylan</h1>
                <p className='premium-loader-subtitle'>Trades</p>

                {/* Progress bar */}
                <div className='premium-loader-progress-track'>
                    <div
                        className='premium-loader-progress-fill'
                        style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                </div>

                <div className='premium-loader-status-text'>
                    {message && <span>{message}</span>}
                    <span className='loader-percent'>{Math.round(Math.min(progress, 100))}%</span>
                </div>

                <div className='premium-loader-dots-row'>
                    <span className='premium-loader-dot' />
                    <span className='premium-loader-dot' />
                    <span className='premium-loader-dot' />
                </div>
            </div>
        </div>
    );
}
