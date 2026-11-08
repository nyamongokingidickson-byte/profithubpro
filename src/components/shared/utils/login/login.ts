import { DERIV_OAUTH_URL, generateOAuthURL, getClientId, getRedirectUri } from '../config/config';
import { isStorageSupported } from '../storage/storage';

export const redirectToLogin = (is_logged_in: boolean, _language?: string, has_params = true, redirect_delay = 0) => {
    if (!is_logged_in) {
        if (isStorageSupported(sessionStorage)) {
            const l = window.location;
            const redirect_url = has_params ? window.location.href : `${l.protocol}//${l.host}${l.pathname}`;
            sessionStorage.setItem('redirect_url', redirect_url);
            sessionStorage.setItem('auth_return_origin', window.location.origin);
        }
        setTimeout(async () => {
            try {
                const new_href = await generateOAuthURL();
                window.location.href = new_href;
            } catch (error) {
                console.error('Failed to redirect to login:', error);
            }
        }, redirect_delay);
    }
};

export const redirectToSignUp = () => {
    generateOAuthURL('registration')
        .then(url => {
            window.location.href = url;
        })
        .catch(error => {
            console.error('Failed to redirect to signup:', error);
        });
};

type TLoginUrl = {
    language?: string;
};

export const loginUrl = ({ language }: TLoginUrl = {}) => {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: getClientId(),
        redirect_uri: getRedirectUri(),
        scope: 'trade',
    });
    if (language) {
        params.set('l', language);
    }
    return `${DERIV_OAUTH_URL}?${params.toString()}`;
};
