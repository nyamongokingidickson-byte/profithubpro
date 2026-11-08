import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { localize } from '@deriv-com/translations';
import { getAppId } from '@/components/shared/utils/config/config';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = ({ backgroundUrl }: { backgroundUrl?: string }) => {
    return <ChunkLoader message={localize('Loading...')} backgroundUrl={backgroundUrl} />;
};

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);
    const [is_api_initialized, setIsApiInitialized] = useState(false);
    const [is_tmb_check_complete, setIsTmbCheckComplete] = useState(false);
    const [, setIsTmbEnabled] = useState(false);
    const { isTmbEnabled } = useTMB();
    const [branding, setBranding] = useState<any>(null);

    // Effect to load branding based on app ID
    useEffect(() => {
        const appId = getAppId();
        if (appId) {
            fetch(`/sites/${appId}/branding.json`)
                .then(response => (response.ok ? response.json() : null))
                .then(data => {
                    if (data) {
                        setBranding(data);

                        const titleText = data.title || data.name;
                        if (titleText) {
                            document.title = titleText;
                            const titleMeta = document.querySelector('meta[name="title"]') as HTMLMetaElement;
                            const ogTitleMeta = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
                            if (titleMeta) titleMeta.content = titleText;
                            if (ogTitleMeta) ogTitleMeta.content = titleText;
                        }

                        if (data.logo_url) {
                            const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
                            const shortcutIcon = document.querySelector('link[rel="shortcut icon"]') as HTMLLinkElement;
                            if (favicon) favicon.href = data.logo_url;
                            if (shortcutIcon) shortcutIcon.href = data.logo_url;
                        }
                    }
                })
                .catch(error => console.warn('Failed to load branding:', error));
        }
    }, []);

    // Check TMB status in background without blocking API initialization
    useEffect(() => {
        isTmbEnabled()
            .then(tmb_status => {
                setIsTmbEnabled(tmb_status || window.is_tmb_enabled === true);
                setIsTmbCheckComplete(true);
            })
            .catch(() => {
                setIsTmbCheckComplete(true);
            });
    }, []);

    // Initialize API immediately on mount with timeout fallback
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setIsApiInitialized(true);
        }, 3500);

        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                try {
                    await api_base.init();
                    api_base_initialized.current = true;
                } catch (error) {
                    console.error('API initialization failed:', error);
                    api_base_initialized.current = false;
                } finally {
                    setIsApiInitialized(true);
                    clearTimeout(timeoutId);
                }
            }
        };

        initializeApi();
        return () => clearTimeout(timeoutId);
    }, []);

    if (!store || !is_api_initialized) return <AppRootLoader backgroundUrl={branding?.background_url} />;

    return (
        <Suspense fallback={<AppRootLoader backgroundUrl={branding?.background_url} />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;
