import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { Link, Link2Off, Globe, Layout, Info } from 'lucide-react';

import './connectivity-bar.scss';

const ConnectivityBar = observer(() => {
    const [is_connected, setIsConnected] = useState(false);
    const [remote_url, setRemoteUrl] = useState('');
    const [pairing_key, setPairingKey] = useState('default_key');
    const [selected_tab, setSelectedTab] = useState('');

    const internal_tabs = [
        { label: localize('Signals Tab'), url: '', key: 'signals_key' },
        { label: localize('Easy Tool'), url: '', key: 'easy_tool_key' },
        { label: localize('Dylan Trades Analysis'), url: 'https://analysisprofithub.vercel.app/', key: 'analysis_hub_key' },
    ];

    useEffect(() => {
        const bc = new BroadcastChannel('bot_communication');
        let timeout: NodeJS.Timeout;

        bc.onmessage = (event) => {
            if (event.data && event.data.key === pairing_key) {
                setIsConnected(true);
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(() => setIsConnected(false), 10000);
            }
        };

        return () => {
            bc.close();
            if (timeout) clearTimeout(timeout);
        };
    }, [pairing_key]);

    const handleLink = () => {
        if (remote_url) {
            window.open(remote_url, '_blank');
        } else if (selected_tab) {
            const tab = internal_tabs.find(t => t.label === selected_tab);
            if (tab) {
                setPairingKey(tab.key);
                if (tab.url) window.open(tab.url, '_blank');
            }
        }
    };

    return (
        <div className='connectivity-bar'>
            <div className='connectivity-bar__section'>
                <div className='connectivity-bar__item'>
                    <Layout size={16} className='connectivity-bar__icon' />
                    <select 
                        className='connectivity-bar__select'
                        value={selected_tab} 
                        onChange={(e) => setSelectedTab(e.target.value)}
                    >
                        <option value="">{localize('Connect to Tab')}</option>
                        {internal_tabs.map(tab => (
                            <option key={tab.label} value={tab.label}>{tab.label}</option>
                        ))}
                    </select>
                </div>

                <div className='connectivity-bar__divider' />

                <div className='connectivity-bar__item connectivity-bar__item--expand'>
                    <Globe size={16} className='connectivity-bar__icon' />
                    <input 
                        type='text' 
                        className='connectivity-bar__input'
                        value={remote_url} 
                        onChange={(e) => setRemoteUrl(e.target.value)}
                        placeholder={localize('Enter External URL (Optional)')}
                    />
                </div>

                <div className='connectivity-bar__divider' />

                <div className='connectivity-bar__item'>
                    <span className='connectivity-bar__label'>{localize('Key:')}</span>
                    <input 
                        type='text' 
                        className='connectivity-bar__input connectivity-bar__input--small'
                        value={pairing_key} 
                        onChange={(e) => setPairingKey(e.target.value)}
                        placeholder='Pairing Key'
                    />
                </div>
            </div>

            <div className='connectivity-bar__section'>
                <div className={`connectivity-bar__status ${is_connected ? 'connected' : 'disconnected'}`}>
                    {is_connected ? <Link size={16} /> : <Link2Off size={16} />}
                    <span>{is_connected ? localize('LINKED') : localize('DISCONNECTED')}</span>
                </div>
                
                <button className='connectivity-bar__button' onClick={handleLink}>
                    {localize('Link Bot')}
                </button>
            </div>
        </div>
    );
});

export default ConnectivityBar;
