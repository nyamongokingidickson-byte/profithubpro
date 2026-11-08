import './app-logo.scss';

export const AppLogo = () => {
    return (
        <div className='app-header__logo-container'>
            <div className='header-branding-modern'>
                <div className='brand-text-wrap'>
                    <div className='brand-main'>
                        <span className='char-p'>D</span>YLAN
                    </div>
                    <div className='brand-sub'>TRADES</div>
                </div>
                <div className='brand-glow-effect' />
            </div>
        </div>
    );
};
