import React, { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { FloatingWindow } from '@/components/shared/components/floating-window/floating-window';
import { useDevice } from '@deriv-com/ui';
import EasyTool from '@/pages/easy-tool';
import SignalsTab from '@/pages/signals/signals-tab';
import { useStore } from '@/hooks/useStore';
import {
    LabelPairedArrowRotateLeftMdRegularIcon,
    LabelPairedArrowRotateRightMdRegularIcon,
    LabelPairedArrowsRotateMdRegularIcon,
    LabelPairedChartLineMdRegularIcon,
    LabelPairedChartTradingviewMdRegularIcon,
    LabelPairedFloppyDiskMdRegularIcon,
    LabelPairedFolderOpenMdRegularIcon,
    LabelPairedMagnifyingGlassMinusMdRegularIcon,
    LabelPairedMagnifyingGlassPlusMdRegularIcon,
    LabelPairedObjectsAlignLeftMdRegularIcon,
} from '@deriv/quill-icons/LabelPaired';

import { localize } from '@deriv-com/translations';
import ToolbarIcon from './toolbar-icon';
import RemoteLinkGroup from './remote-link-group';

const WorkspaceGroup = observer(() => {
    const { isDesktop } = useDevice();
    const { dashboard, toolbar, load_modal, save_modal } = useStore();
    const { setChartModalVisibility, setTradingViewModalVisibility } = dashboard;
    const { has_redo_stack, has_undo_stack, onResetClick, onSortClick, onUndoClick, onZoomInOutClick } = toolbar;
    const { toggleSaveModal } = save_modal;
    const { toggleLoadModal } = load_modal;

    const [openWindows, setOpenWindows] = useState<string[]>([]);
    const [topWindow, setTopWindow] = useState<string | null>(null);

    const toggleWindow = (id: string) => {
        if (!openWindows.includes(id)) {
            setOpenWindows([...openWindows, id]);
        }
        setTopWindow(id);
    };

    const closeWindow = (id: string) => {
        setOpenWindows(openWindows.filter(w => w !== id));
    };

    return (
        <React.Fragment>
            <div className='toolbar__wrapper'>
                <div className='toolbar__group toolbar__group-btn' data-testid='dt_toolbar_group_btn'>
                    <ToolbarIcon
                        popover_message={localize('Reset')}
                        icon={
                            <span
                                id='db-toolbar__reset-button'
                                className='toolbar__icon'
                                onClick={onResetClick}
                                data-testid='dt_toolbar_reset_button'
                            >
                                <LabelPairedArrowsRotateMdRegularIcon />
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('Import')}
                        icon={
                            <span
                                id='db-toolbar__import-button'
                                className='toolbar__icon'
                                onClick={() => toggleLoadModal()}
                                data-testid='dt_toolbar_import_button'
                            >
                                <LabelPairedFolderOpenMdRegularIcon />
                            </span>
                        }
                    />
                    {isDesktop && (
                        <ToolbarIcon
                            popover_message={localize('Save')}
                            icon={
                                <span
                                    id='db-toolbar__save-button'
                                    className='toolbar__icon'
                                    onClick={() => toggleSaveModal()}
                                    data-testid='dt_toolbar_save_button'
                                >
                                    <LabelPairedFloppyDiskMdRegularIcon />
                                </span>
                            }
                        />
                    )}
                    <div className='toolbar__separator' />
                    <ToolbarIcon
                        popover_message={localize('Undo')}
                        icon={
                            <span
                                id='db-toolbar__undo-button'
                                className={classNames('toolbar__icon', {
                                    'toolbar__icon--disabled': !has_undo_stack,
                                })}
                                onClick={() => onUndoClick(false)}
                                data-testid='dt_toolbar_undo_button'
                            >
                                <LabelPairedArrowRotateLeftMdRegularIcon />
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('Redo')}
                        icon={
                            <span
                                id='db-toolbar__redo-button'
                                className={classNames('toolbar__icon', {
                                    'toolbar__icon--disabled': !has_redo_stack,
                                })}
                                onClick={() => onUndoClick(true)}
                                data-testid='dt_toolbar_redo_button'
                            >
                                <LabelPairedArrowRotateRightMdRegularIcon />
                            </span>
                        }
                    />
                    <div className='toolbar__separator' />
                    <ToolbarIcon
                        popover_message={localize('Sort block')}
                        icon={
                            <span
                                id='db-toolbar__sort-button'
                                className='toolbar__icon'
                                onClick={onSortClick}
                                data-testid='dt_toolbar_sort_button'
                            >
                                <LabelPairedObjectsAlignLeftMdRegularIcon />
                            </span>
                        }
                    />
                    {isDesktop && (
                        <React.Fragment>
                            <ToolbarIcon
                                popover_message={localize('Zoom in')}
                                icon={
                                    <span
                                        id='db-toolbar__zoom-in-button'
                                        className='toolbar__icon'
                                        onClick={() => onZoomInOutClick(true)}
                                        data-testid='dt_toolbar_zoom_in_button'
                                    >
                                        <LabelPairedMagnifyingGlassPlusMdRegularIcon />
                                    </span>
                                }
                            />
                            <ToolbarIcon
                                popover_message={localize('Zoom out')}
                                icon={
                                    <span
                                        id='db-toolbar__zoom_out_button'
                                        className='toolbar__icon'
                                        onClick={() => onZoomInOutClick(false)}
                                        data-testid='dt_toolbar_zoom_out_button'
                                    >
                                        <LabelPairedMagnifyingGlassMinusMdRegularIcon />
                                    </span>
                                }
                            />
                        </React.Fragment>
                    )}
                    <div className='toolbar__separator' />
                    <ToolbarIcon
                        popover_message={localize('Easy Tool')}
                        icon={
                            <span className='toolbar__icon' onClick={() => toggleWindow('easytool')}>
                                <span style={{ fontSize: '18px', display: 'flex', alignItems: 'center' }}>🚀</span>
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('Signals')}
                        icon={
                            <span className='toolbar__icon' onClick={() => toggleWindow('signals')}>
                                <span style={{ fontSize: '18px', display: 'flex', alignItems: 'center' }}>📡</span>
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('Dylan Trades Easytool')}
                        icon={
                            <span className='toolbar__icon' onClick={() => toggleWindow('analysishub')}>
                                <span style={{ fontSize: '18px', display: 'flex', alignItems: 'center' }}>🌐</span>
                            </span>
                        }
                    />
                    <div className='toolbar__separator' />
                    <ToolbarIcon
                        popover_message={localize('Chart')}
                        icon={
                            <span
                                id='db-toolbar__chart-button'
                                className='toolbar__icon'
                                onClick={() => setChartModalVisibility()}
                                data-testid='dt_toolbar_chart_button'
                            >
                                <LabelPairedChartLineMdRegularIcon />
                            </span>
                        }
                    />
                    <ToolbarIcon
                        popover_message={localize('TradingView Chart')}
                        icon={
                            <span
                                className='toolbar__icon'
                                id='db-toolbar__tradingview-button'
                                onClick={() => setTradingViewModalVisibility()}
                            >
                                <LabelPairedChartTradingviewMdRegularIcon />
                            </span>
                        }
                    />
                    <RemoteLinkGroup />
                </div>
            </div>

            {/* Floating Windows Portals/Renderers */}
            {openWindows.includes('easytool') && (
                <FloatingWindow
                    id='easytool'
                    title='Easy Tool'
                    onClose={() => closeWindow('easytool')}
                    onFocus={() => setTopWindow('easytool')}
                    isTop={topWindow === 'easytool'}
                    initialWidth={1000}
                    initialHeight={800}
                    initialX={150}
                    initialY={100}
                >
                    <div style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                        <EasyTool />
                    </div>
                </FloatingWindow>
            )}

            {openWindows.includes('signals') && (
                <FloatingWindow
                    id='signals'
                    title='Signals Tab'
                    onClose={() => closeWindow('signals')}
                    onFocus={() => setTopWindow('signals')}
                    isTop={topWindow === 'signals'}
                    initialWidth={800}
                    initialHeight={600}
                    initialX={250}
                    initialY={150}
                >
                    <div style={{ height: '100%', overflow: 'auto' }}>
                        <SignalsTab />
                    </div>
                </FloatingWindow>
            )}

            {openWindows.includes('analysishub') && (
                <FloatingWindow
                    id='analysishub'
                    title='Dylan Trades Easytool'
                    onClose={() => closeWindow('analysishub')}
                    onFocus={() => setTopWindow('analysishub')}
                    isTop={topWindow === 'analysishub'}
                    initialWidth={900}
                    initialHeight={700}
                    initialX={200}
                    initialY={120}
                >
                    <iframe
                        src='https://analysisprofithub.vercel.app/'
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title='Dylan Trades Easytool'
                    />
                </FloatingWindow>
            )}
        </React.Fragment>
    );
});

export default WorkspaceGroup;
