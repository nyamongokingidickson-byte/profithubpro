/**
 * Admin Onboarding Wizard for OAuth 2.0 Configuration
 * Allows administrators to configure OAuth settings dynamically
 */

import React, { useState } from 'react';
import classNames from 'classnames';
import { Localize, localize } from '@deriv-com/translations';
import Button from '@/components/shared_ui/button';
import Input from '@/components/shared_ui/input';
import Text from '@/components/shared_ui/text';
import Dialog from '@/components/shared_ui/dialog';
import {
    AdminOnboardingConfig,
    OnboardingStep,
    OAuthScope,
} from '@/types/oauth-types';
import './admin-onboarding-wizard.scss';

interface AdminOnboardingWizardProps {
    isOpen: boolean;
    onComplete: (config: AdminOnboardingConfig) => void;
    onCancel: () => void;
    initialConfig?: Partial<AdminOnboardingConfig>;
}

const defaultSteps: OnboardingStep[] = [
    {
        id: 'site-info',
        title: 'Site Information',
        description: 'Configure your trading platform details',
        completed: false,
        optional: false,
    },
    {
        id: 'oauth-credentials',
        title: 'OAuth Credentials',
        description: 'Set up your OAuth Client ID and Legacy App ID',
        completed: false,
        optional: false,
    },
    {
        id: 'oauth-urls',
        title: 'OAuth URLs',
        description: 'Configure OAuth authorization and token endpoints',
        completed: false,
        optional: false,
    },
    {
        id: 'scopes',
        title: 'OAuth Scopes',
        description: 'Select required permissions for trading operations',
        completed: false,
        optional: false,
    },
    {
        id: 'security',
        title: 'Security Settings',
        description: 'Configure security and legacy mode compatibility',
        completed: false,
        optional: false,
    },
    {
        id: 'review',
        title: 'Review Configuration',
        description: 'Review and verify your OAuth configuration',
        completed: false,
        optional: false,
    },
];

const allScopes: { value: OAuthScope; label: string }[] = [
    { value: 'read', label: 'Read (Account information)' },
    { value: 'trade', label: 'Trade (Place and manage trades)' },
    { value: 'payments', label: 'Payments (Deposit and withdrawal)' },
    { value: 'trading_information', label: 'Trading Information (Market data)' },
    { value: 'admin', label: 'Admin (Administrative access)' },
];

const AdminOnboardingWizard: React.FC<AdminOnboardingWizardProps> = ({
    isOpen,
    onComplete,
    onCancel,
    initialConfig,
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [steps, setSteps] = useState<OnboardingStep[]>(defaultSteps);
    const [config, setConfig] = useState<AdminOnboardingConfig>(
        initialConfig as AdminOnboardingConfig || {
            siteUrl: 'https://dylantrades.site',
            clientId: '34J0u7zObmeCX5lnl8zm7',
            legacyAppId: '34J0u7zObmeCX5lnl8zm7',
            redirectUri: 'https://www.dylantrades.site/callback',
            authUrl: 'https://auth.deriv.com/oauth2/auth',
            tokenUrl: 'https://auth.deriv.com/oauth2/token',
            revokeUrl: 'https://auth.deriv.com/oauth2/revoke',
            scopes: ['trade'],
            enableLegacyMode: false,
        }
    );
    const [selectedScopes, setSelectedScopes] = useState<OAuthScope[]>(config.scopes);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const updateConfig = (updates: Partial<AdminOnboardingConfig>) => {
        setConfig(prev => ({ ...prev, ...updates }));
    };

    const validateStep = (stepId: string): boolean => {
        const newErrors: Record<string, string> = {};

        switch (stepId) {
            case 'site-info':
                if (!config.siteUrl) newErrors.siteUrl = 'Site URL is required';
                if (!config.siteUrl.startsWith('https://') && config.siteUrl !== 'http://localhost:8443') {
                    newErrors.siteUrl = 'Site URL must use HTTPS or be localhost';
                }
                break;
            case 'oauth-credentials':
                if (!config.clientId) newErrors.clientId = 'OAuth Client ID is required';
                if (!config.legacyAppId) newErrors.legacyAppId = 'Legacy App ID is required';
                break;
            case 'oauth-urls':
                if (!config.authUrl) newErrors.authUrl = 'Authorization URL is required';
                if (!config.tokenUrl) newErrors.tokenUrl = 'Token URL is required';
                if (!config.redirectUri) newErrors.redirectUri = 'Redirect URI is required';
                break;
            case 'scopes':
                if (selectedScopes.length === 0) {
                    newErrors.scopes = 'At least one scope must be selected';
                }
                break;
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateStep(steps[currentStep].id)) {
            const newSteps = [...steps];
            newSteps[currentStep].completed = true;
            setSteps(newSteps);

            if (currentStep < steps.length - 1) {
                setCurrentStep(currentStep + 1);
            }
        }
    };

    const handlePrevious = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleFinish = () => {
        if (validateStep(steps[currentStep].id)) {
            const finalConfig: AdminOnboardingConfig = {
                ...config,
                scopes: selectedScopes,
                redirectUri: config.redirectUri || `${config.siteUrl}/callback`,
            };
            onComplete(finalConfig);
        }
    };

    const handleScopeChange = (scope: OAuthScope) => {
        setSelectedScopes(prev => 
            prev.includes(scope) 
                ? prev.filter(s => s !== scope)
                : [...prev, scope]
        );
    };

    const renderStepContent = () => {
        const step = steps[currentStep];

        switch (step.id) {
            case 'site-info':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='Configure Site Information' />
                        </Text>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='Trading Site URL' />
                            </label>
                            <Input
                                type='url'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.siteUrl })}
                                value={config.siteUrl}
                                onChange={e => updateConfig({ siteUrl: e.target.value })}
                                placeholder='https://your-trading-site.com'
                            />
                            {errors.siteUrl && <Text className='wizard-form__error'>{errors.siteUrl}</Text>}
                        </div>
                    </div>
                );

            case 'oauth-credentials':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='OAuth Credentials' />
                        </Text>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='OAuth Client ID' />
                            </label>
                            <Input
                                type='text'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.clientId })}
                                value={config.clientId}
                                onChange={e => updateConfig({ clientId: e.target.value })}
                                placeholder='Your OAuth Client ID'
                            />
                            {errors.clientId && <Text className='wizard-form__error'>{errors.clientId}</Text>}
                        </div>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='Legacy App ID' />
                            </label>
                            <Input
                                type='text'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.legacyAppId })}
                                value={config.legacyAppId}
                                onChange={e => updateConfig({ legacyAppId: e.target.value })}
                                placeholder='Your Legacy App ID'
                            />
                            {errors.legacyAppId && <Text className='wizard-form__error'>{errors.legacyAppId}</Text>}
                        </div>
                    </div>
                );

            case 'oauth-urls':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='Configure OAuth URLs' />
                        </Text>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='Authorization URL' />
                            </label>
                            <Input
                                type='url'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.authUrl })}
                                value={config.authUrl}
                                onChange={e => updateConfig({ authUrl: e.target.value })}
                                placeholder='https://oauth.example.com/authorize'
                            />
                            {errors.authUrl && <Text className='wizard-form__error'>{errors.authUrl}</Text>}
                        </div>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='Token URL' />
                            </label>
                            <Input
                                type='url'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.tokenUrl })}
                                value={config.tokenUrl}
                                onChange={e => updateConfig({ tokenUrl: e.target.value })}
                                placeholder='https://oauth.example.com/token'
                            />
                            {errors.tokenUrl && <Text className='wizard-form__error'>{errors.tokenUrl}</Text>}
                        </div>
                        <div className='wizard-form__group'>
                            <label className='wizard-form__label'>
                                <Localize i18n_default_text='Redirect URI' />
                            </label>
                            <Input
                                type='url'
                                className={classNames('wizard-form__input', { 'wizard-form__input--error': errors.redirectUri })}
                                value={config.redirectUri}
                                onChange={e => updateConfig({ redirectUri: e.target.value })}
                                placeholder={`${config.siteUrl}/callback`}
                            />
                            {errors.redirectUri && <Text className='wizard-form__error'>{errors.redirectUri}</Text>}
                        </div>
                    </div>
                );

            case 'scopes':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='Select OAuth Scopes' />
                        </Text>
                        <Text className='wizard-step__description'>
                            <Localize i18n_default_text='Choose the permissions your application requires:' />
                        </Text>
                        {errors.scopes && <Text className='wizard-form__error'>{errors.scopes}</Text>}
                        <div className='wizard-scopes'>
                            {allScopes.map(scope => (
                                <label key={scope.value} className='wizard-scopes__item'>
                                    <input
                                        type='checkbox'
                                        checked={selectedScopes.includes(scope.value)}
                                        onChange={() => handleScopeChange(scope.value)}
                                        className='wizard-scopes__checkbox'
                                    />
                                    <Text className='wizard-scopes__label'>{scope.label}</Text>
                                </label>
                            ))}
                        </div>
                    </div>
                );

            case 'security':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='Security Settings' />
                        </Text>
                        <label className='wizard-security__item'>
                            <input
                                type='checkbox'
                                checked={config.enableLegacyMode}
                                onChange={e => updateConfig({ enableLegacyMode: e.target.checked })}
                                className='wizard-security__checkbox'
                            />
                            <Text className='wizard-security__label'>
                                <Localize i18n_default_text='Enable Legacy App ID Mode (for backward compatibility)' />
                            </Text>
                        </label>
                    </div>
                );

            case 'review':
                return (
                    <div className='wizard-step'>
                        <Text weight='bold' size='large' className='wizard-step__title'>
                            <Localize i18n_default_text='Review Configuration' />
                        </Text>
                        <div className='wizard-review'>
                            <div className='wizard-review__item'>
                                <Text weight='bold'><Localize i18n_default_text='Site URL:' /></Text>
                                <Text>{config.siteUrl}</Text>
                            </div>
                            <div className='wizard-review__item'>
                                <Text weight='bold'><Localize i18n_default_text='OAuth Client ID:' /></Text>
                                <Text>{config.clientId}</Text>
                            </div>
                            <div className='wizard-review__item'>
                                <Text weight='bold'><Localize i18n_default_text='Legacy App ID:' /></Text>
                                <Text>{config.legacyAppId}</Text>
                            </div>
                            <div className='wizard-review__item'>
                                <Text weight='bold'><Localize i18n_default_text='Redirect URI:' /></Text>
                                <Text>{config.redirectUri || `${config.siteUrl}/callback`}</Text>
                            </div>
                            <div className='wizard-review__item'>
                                <Text weight='bold'><Localize i18n_default_text='Scopes:' /></Text>
                                <Text>{selectedScopes.join(', ')}</Text>
                            </div>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <Dialog
            is_visible={isOpen}
            title={localize('OAuth 2.0 Configuration Wizard')}
            className='admin-onboarding-wizard'
            width='600px'
        >
            <Dialog.Body>
                <div className='wizard-container'>
                    <div className='wizard-progress'>
                        {steps.map((step, idx) => (
                            <div key={step.id} className='wizard-progress__step'>
                                <div className={classNames('wizard-progress__dot', {
                                    'wizard-progress__dot--completed': step.completed,
                                    'wizard-progress__dot--active': idx === currentStep,
                                })}>
                                    {idx + 1}
                                </div>
                                {idx < steps.length - 1 && (
                                    <div className={classNames('wizard-progress__line', {
                                        'wizard-progress__line--completed': step.completed,
                                    })} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className='wizard-content'>
                        {renderStepContent()}
                    </div>
                </div>
            </Dialog.Body>
            <Dialog.Footer>
                <div className='wizard-footer'>
                    <Button
                        className='wizard-footer__button'
                        onClick={handlePrevious}
                        disabled={currentStep === 0}
                        secondary
                        text={localize('Previous')}
                    />
                    {currentStep < steps.length - 1 && (
                        <Button
                            className='wizard-footer__button'
                            onClick={handleNext}
                            text={localize('Next')}
                            primary
                        />
                    )}
                    {currentStep === steps.length - 1 && (
                        <Button
                            className='wizard-footer__button'
                            onClick={handleFinish}
                            text={localize('Complete Setup')}
                            primary
                        />
                    )}
                    <Button
                        className='wizard-footer__button'
                        onClick={onCancel}
                        text={localize('Cancel')}
                        secondary
                    />
                </div>
            </Dialog.Footer>
        </Dialog>
    );
};

export default AdminOnboardingWizard;
