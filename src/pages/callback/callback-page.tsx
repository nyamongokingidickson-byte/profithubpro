import React, { useEffect, useState, useRef } from 'react';
import { Button } from '@deriv-com/ui';
import { handleCallback } from '@/lib/auth';

const CallbackPage: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState<string>('Processing authentication...');
    const hasProcessed = useRef(false);

    useEffect(() => {
        if (hasProcessed.current) return;
        hasProcessed.current = true;

        const processCallback = async () => {
            const result = await handleCallback();
            if (result.success) {
                setStatus('success');
                setMessage('Login successful! Redirecting...');
                setTimeout(() => {
                    window.location.href = '/';
                }, 300);
            } else {
                setStatus('error');
                setMessage(result.error || 'Authentication failed');
            }
        };

        processCallback();
    }, []);

    return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
            <h1>Authentication Callback</h1>
            <p>{message}</p>
            {status === 'error' && (
                <Button onClick={() => window.location.href = '/'}>
                    Return to Home
                </Button>
            )}
        </div>
    );
};

export default CallbackPage;
