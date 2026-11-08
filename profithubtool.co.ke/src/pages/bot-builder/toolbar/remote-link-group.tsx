import { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Popover } from 'react-tiny-popover';
import { localize } from '@deriv-com/translations';
import { Link, Link2Off, Globe, Layout, Settings } from 'lucide-react';
import ToolbarIcon from './toolbar-icon';
import './toolbar.scss';

const RemoteLinkGroup = observer(() => {
    const [is_open, setIsOpen] = useState(false);
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
                timeout = setTimeout(() => setIsConnected(false), 5000);
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
        <Popover
            isOpen={is_open}
            positions={['bottom']}
            align='end'
            padding={8}
            onClickOutside={() => setIsOpen(false)}
            content={
                <div className='connectivity-popover'>
                    <div className='connectivity-popover__header'>
                        <h3>{localize('Connectivity Center')}</h3>
                        <div className={`status-badge ${is_connected ? 'online' : 'offline'}`}>
                            {is_connected ? localize('CONNECTED') : localize('OFFLINE')}
                        </div>
                    </div>
                    
                    <div className='connectivity-popover__content'>
                        <div className='input-group'>
                            <label><Layout size={14} /> {localize('Connect to Tab')}</label>
                            <select value={selected_tab} onChange={(e) => setSelectedTab(e.target.value)}>
                                <option value="">{localize('Select Tab...')}</option>
                                {internal_tabs.map(tab => (
                                    <option key={tab.label} value={tab.label}>{tab.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className='input-group'>
                            <label><Globe size={14} /> {localize('External Analysis URL')}</label>
                            <input 
                                type='text' 
                                value={remote_url} 
                                onChange={(e) => setRemoteUrl(e.target.value)}
                                placeholder='https://...'
                            />
                        </div>

                        <div className='input-group'>
                            <label><Settings size={14} /> {localize('Pairing Key')}</label>
                            <input 
                                type='text' 
                                value={pairing_key} 
                                onChange={(e) => setPairingKey(e.target.value)}
                            />
                        </div>

                        <button className='link-button' onClick={handleLink}>
                            {localize('Link Bot')}
                        </button>
                    </div>
                </div>
            }
        >
            <div className='remote-link-trigger'>
                <ToolbarIcon
                    popover_message={localize('Cross-tab Connectivity')}
                    icon={
                        <span className='toolbar__icon remote-link-icon' onClick={() => setIsOpen(!is_open)}>
                            {is_connected ? <Link size={20} color='#4caf50' /> : <Link2Off size={20} />}
                            {is_connected && <span className='connection-pulse' />}
                        </span>
                    }
                />
            </div>
        </Popover>
    );
});

export default RemoteLinkGroup;
