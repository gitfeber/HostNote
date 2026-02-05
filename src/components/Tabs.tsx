import React from 'react';
import { FileTab } from '../App';
import { X, Save, Lock, Unlock } from 'lucide-react';

interface TabsProps {
    tabs: FileTab[];
    activeTabId: string | null;
    onTabClick: (id: string) => void;
    onTabClose: (id: string, e: React.MouseEvent) => void;
    onShareToggle?: (filename: string, isPublic: boolean, publicId?: string, e?: React.MouseEvent) => void;
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTabId, onTabClick, onTabClose, onShareToggle }) => {
    return (
        <div className="tabs-container">
            {tabs.map(tab => (
                <div
                    key={tab.id}
                    className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
                    onClick={() => onTabClick(tab.id)}
                >
                    {tab.isDirty && <Save size={12} className="tab-icon dirty-icon" />}
                    {!tab.isNew && onShareToggle && (
                        <button 
                            className={`share-icon-btn ${tab.isPublic ? 'public' : 'private'}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onShareToggle(tab.name, tab.isPublic || false, tab.publicId, e);
                            }}
                            title={tab.isPublic ? 'Public file - click to manage' : 'Private file - click to share'}
                        >
                            {tab.isPublic ? <Unlock size={16} /> : <Lock size={16} />}
                        </button>
                    )}
                    <span className="tab-name">{tab.name}</span>
                    <button className="close-tab-btn" onClick={(e) => onTabClose(tab.id, e)}>
                        <X size={12} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default Tabs;
