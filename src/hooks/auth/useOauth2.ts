import { useCallback, useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { redirectToLogin } from '@/components/shared/utils/login/login';
import RootStore from '@/stores/root-store';
import { handleOidcAuthFailure } from '@/utils/auth-utils';
import { clearPKCEVerifier } from '@/utils/pkce';
import { Analytics } from '@deriv-com/analytics';

/**
 * Provides OAuth 2.0 PKCE login retrigger and clean local/server logout
 * without relying on deriv.com-only OIDC iframe helpers.
 */
export const useOauth2 = ({
    handleLogout,
    client,
}: {
    handleLogout?: () => Promise<void>;
    client?: RootStore['client'];
} = {}) => {
    const [isSingleLoggingIn, setIsSingleLoggingIn] = useState(false);
    const isLoggingOutRef = useRef(false);

    useEffect(() => {
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (event?.reason?.error?.code === 'InvalidToken') {
                setIsSingleLoggingIn(false);
            }
        };
        window.addEventListener('unhandledrejection', onUnhandledRejection);
        return () => {
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, []);

    const logoutHandler = useCallback(async () => {
        if (isLoggingOutRef.current) return;
        isLoggingOutRef.current = true;
        client?.setIsLoggingOut(true);

        try {
            const accessToken = localStorage.getItem('authToken');
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
            }).catch(() => undefined);

            localStorage.removeItem('refreshToken');
            clearPKCEVerifier();
            Cookies.set('logged_state', 'false', { path: '/' });

            if (handleLogout) {
                await handleLogout().catch(err => {
                    // eslint-disable-next-line no-console
                    console.error('Error during logout handler:', err);
                });
            } else {
                await client?.logout().catch(err => {
                    // eslint-disable-next-line no-console
                    console.error('Error during client logout:', err);
                });
            }

            Analytics.reset();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error);
        } finally {
            client?.setIsLoggingOut(false);
            isLoggingOutRef.current = false;
        }
    }, [client, handleLogout]);

    const retriggerOAuth2Login = useCallback(async () => {
        try {
            await redirectToLogin(false);
        } catch (error) {
            handleOidcAuthFailure(error);
        }
    }, []);

    return { oAuthLogout: logoutHandler, retriggerOAuth2Login, isSingleLoggingIn, isOAuth2Enabled: true };
};
