import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor';
import Tabs from './components/Tabs';
import CompareView from './components/CompareView';
import MarkdownPreview from './components/MarkdownPreview';
import {
    FilePlus, Save, FolderOpen, Edit3, Trash2,
    ZoomIn, ZoomOut, RefreshCw, GitCompare, Eye, LogOut, User, Lock, Unlock
} from 'lucide-react';

export interface FileTab {
    id: string;
    name: string;
    content: string;
    language: string;
    isDirty: boolean;
    isNew: boolean;
    isPublic?: boolean;
    publicId?: string;
}

const DEFAULT_CONTENT = `// Welcome to HostNote
// Create a new file or open an existing one from the server

`;

// User info type
interface UserInfo {
    username: string | null;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
}

// API functions
const api = {
    async request(url: string, options: RequestInit = {}): Promise<Response> {
        const res = await fetch(url, options);
        if (res.status === 401) {
            // Session expired
            // The state is already persisted to localStorage by the useEffect hook
            // So we just need to reload to trigger the OAuth flow
            window.location.reload();
            // Return a never-resolving promise to prevent further error handling while reloading
            return new Promise(() => { });
        }
        return res;
    },

    async getUser(): Promise<UserInfo | null> {
        try {
            // Use redirect: 'manual' to prevent following OAuth redirects which violate CSP
            const res = await this.request('/api/user', {
                credentials: 'same-origin',
                redirect: 'manual'
            });
            // If redirected (opaque redirect response) or not ok, return null
            if (res.type === 'opaqueredirect' || !res.ok) return null;
            return res.json();
        } catch {
            return null;
        }
    },
    async listFiles(): Promise<{ name: string; size: number; modified: string; isPublic?: boolean; publicId?: string }[]> {
        const res = await this.request('/api/files', { credentials: 'same-origin' });
        return res.json();
    },
    async readFile(filename: string): Promise<{ name: string; content: string }> {
        const res = await this.request(`/api/files/${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error('File not found');
        return res.json();
    },
    async saveFile(filename: string, content: string): Promise<void> {
        const res = await this.request(`/api/files/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error('Failed to save');
    },
    async deleteFile(filename: string): Promise<void> {
        const res = await this.request(`/api/files/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete');
    },
    async renameFile(oldName: string, newName: string): Promise<void> {
        const res = await this.request(`/api/files/${encodeURIComponent(oldName)}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName }),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to rename');
        }
    },
    async shareFile(filename: string): Promise<{ publicId: string; publicUrl: string }> {
        const res = await this.request(`/api/files/${encodeURIComponent(filename)}/share`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to share');
        return res.json();
    },
    async unshareFile(filename: string): Promise<void> {
        const res = await this.request(`/api/files/${encodeURIComponent(filename)}/unshare`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to unshare');
    },
};

const STORAGE_KEY = 'hostnote_tabs';
const ACTIVE_TAB_KEY = 'hostnote_active_tab';
const ZOOM_KEY = 'hostnote_zoom';
const AUTOSAVE_DELAY = 1500; // Autosave delay in ms

function App() {
    // User info state
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [showUserMenu, setShowUserMenu] = useState(false);

    // Share dialog state
    const [showShareDialog, setShowShareDialog] = useState(false);
    const [shareDialogFile, setShareDialogFile] = useState<{ name: string; isPublic: boolean; publicId?: string } | null>(null);

    // Initialize state from localStorage (only for tab IDs, not content)
    const [tabs, setTabs] = useState<FileTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(() => {
        return localStorage.getItem(ACTIVE_TAB_KEY);
    });
    const [serverFiles, setServerFiles] = useState<{ name: string; size: number; modified: string; isPublic?: boolean; publicId?: string }[]>([]);
    const [showFileList, setShowFileList] = useState(false);
    const [zoom, setZoom] = useState(() => {
        const saved = localStorage.getItem(ZOOM_KEY);
        return saved ? parseInt(saved, 10) : 14;
    });
    const [statusMessage, setStatusMessage] = useState('Ready');
    const [compareMode, setCompareMode] = useState(false);
    const [compareFiles, setCompareFiles] = useState<{ left: string | null; right: string | null }>({ left: null, right: null });
    const [previewMode, setPreviewMode] = useState(false);

    // Ref for autosave timers
    const autosaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Fetch user info on mount
    useEffect(() => {
        api.getUser().then(setUserInfo);
    }, []);

    // Handle logout
    const handleLogout = () => {
        // OAuth2 proxy sign_out endpoint
        window.location.href = '/oauth2/sign_out';
    };

    // Close user menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.user-menu-wrapper')) {
                setShowUserMenu(false);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    // Persist full tab state to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    }, [tabs]);

    // Persist active tab to localStorage
    useEffect(() => {
        if (activeTabId) {
            localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
        } else {
            localStorage.removeItem(ACTIVE_TAB_KEY);
        }
    }, [activeTabId]);

    // Turn off preview mode when switching to non-markdown file
    useEffect(() => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.language !== 'markdown' && previewMode) {
            setPreviewMode(false);
        }
    }, [activeTabId, tabs, previewMode]);

    // Persist zoom level
    useEffect(() => {
        localStorage.setItem(ZOOM_KEY, zoom.toString());
    }, [zoom]);

    // Load saved tabs from localStorage on mount including content
    useEffect(() => {
        const loadSavedTabs = async () => {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const loadedTabs: FileTab[] = JSON.parse(saved);
                    setTabs(loadedTabs);

                    // Set active tab if it exists
                    const savedActiveTab = localStorage.getItem(ACTIVE_TAB_KEY);
                    if (savedActiveTab && loadedTabs.some(t => t.id === savedActiveTab)) {
                        setActiveTabId(savedActiveTab);
                    } else if (loadedTabs.length > 0) {
                        setActiveTabId(loadedTabs[0].id);
                    }
                }
            } catch (err) {
                console.error('Error loading saved tabs:', err);
            }
        };

        loadSavedTabs();
    }, []);

    // Load file list from server
    const refreshFileList = useCallback(async () => {
        try {
            const files = await api.listFiles();
            setServerFiles(files);
            return files;
        } catch {
            setServerFiles([]);
            return [];
        }
    }, []);

    // Handle hover for file list - fetch files and show dropdown
    const handleFileListHover = useCallback(() => {
        refreshFileList();
        setShowFileList(true);
    }, [refreshFileList]);

    const handleFileListLeave = useCallback(() => {
        setShowFileList(false);
    }, []);

    const detectLanguage = (filename: string): string => {
        const ext = filename.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js': return 'javascript';
            case 'ts': case 'tsx': return 'typescript';
            case 'html': return 'html';
            case 'css': return 'css';
            case 'json': return 'json';
            case 'md': return 'markdown';
            case 'yaml': case 'yml': return 'yaml';
            case 'py': return 'python';
            case 'sh': case 'bash': return 'shell';
            case 'xml': return 'xml';
            case 'sql': return 'sql';
            case 'go': return 'go';
            case 'rs': return 'rust';
            case 'java': return 'java';
            case 'c': case 'h': return 'c';
            case 'cpp': case 'cc': case 'hpp': return 'cpp';
            case 'php': return 'php';
            case 'rb': return 'ruby';
            case 'dockerfile': return 'dockerfile';
            default: return 'plaintext';
        }
    };

    const createNewTab = () => {
        const count = tabs.filter(t => t.name.startsWith('untitled')).length;
        const newTab: FileTab = {
            id: crypto.randomUUID(),
            name: `untitled${count > 0 ? count : ''}.txt`,
            content: DEFAULT_CONTENT,
            language: 'plaintext',
            isDirty: true,
            isNew: true,
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
        setStatusMessage('New file created');
    };

    const openFileFromServer = async (filename: string) => {
        // Check if already open
        const existing = tabs.find(t => t.name === filename);
        if (existing) {
            setActiveTabId(existing.id);
            setShowFileList(false);
            return;
        }

        try {
            const file = await api.readFile(filename);
            // Get public status from server files list
            const fileInfo = serverFiles.find(f => f.name === filename);
            const newTab: FileTab = {
                id: crypto.randomUUID(),
                name: file.name,
                content: file.content,
                language: detectLanguage(file.name),
                isDirty: false,
                isNew: false,
                isPublic: fileInfo?.isPublic || false,
                publicId: fileInfo?.publicId,
            };
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTab.id);
            setShowFileList(false);
            setStatusMessage(`Opened: ${filename}`);
        } catch {
            setStatusMessage(`Error opening: ${filename}`);
        }
    };

    const closeTab = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);

        if (activeTabId === id) {
            setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
        }
    };

    const updateTabContent = (id: string, content: string) => {
        setTabs(prev => {
            const tab = prev.find(t => t.id === id);

            // Trigger autosave for non-new files
            if (tab && !tab.isNew) {
                // Clear existing timer
                const existingTimer = autosaveTimers.current.get(id);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                }

                // Set new autosave timer
                const timer = setTimeout(async () => {
                    try {
                        await api.saveFile(tab.name, content);
                        setTabs(p => p.map(t =>
                            t.id === id ? { ...t, isDirty: false } : t
                        ));
                        setStatusMessage(`Auto-saved: ${tab.name}`);
                    } catch {
                        setStatusMessage(`Auto-save failed: ${tab.name}`);
                    }
                    autosaveTimers.current.delete(id);
                }, AUTOSAVE_DELAY);

                autosaveTimers.current.set(id, timer);
            }

            return prev.map(t =>
                t.id === id ? { ...t, content, isDirty: true } : t
            );
        });
    };

    const saveFile = async () => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (!activeTab) return;

        // If new file, prompt for name
        let filename = activeTab.name;
        if (activeTab.isNew) {
            const newName = prompt('Enter filename:', activeTab.name);
            if (!newName) return;
            filename = newName;
        }

        try {
            await api.saveFile(filename, activeTab.content);
            setTabs(prev => prev.map(t =>
                t.id === activeTabId ? { ...t, isDirty: false, isNew: false, name: filename, language: detectLanguage(filename) } : t
            ));
            setStatusMessage(`Saved: ${filename}`);
            refreshFileList();
        } catch {
            setStatusMessage(`Error saving: ${filename}`);
        }
    };

    const renameCurrentFile = async () => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (!activeTab) return;

        const newName = prompt('Enter new filename:', activeTab.name);
        if (!newName || newName === activeTab.name) return;

        try {
            // If file exists on server, rename it there too
            if (!activeTab.isNew) {
                await api.renameFile(activeTab.name, newName);
            }

            setTabs(prev => prev.map(t =>
                t.id === activeTabId ? { ...t, name: newName, language: detectLanguage(newName) } : t
            ));
            setStatusMessage(`Renamed to: ${newName}`);
            refreshFileList();
        } catch (err) {
            setStatusMessage(`Error renaming: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const deleteFileFromServer = async (filename: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete "${filename}" from server?`)) return;

        try {
            await api.deleteFile(filename);
            // Close tab if open
            const openTab = tabs.find(t => t.name === filename);
            if (openTab) {
                closeTab(openTab.id);
            }
            setStatusMessage(`Deleted: ${filename}`);
            refreshFileList();
        } catch {
            setStatusMessage(`Error deleting: ${filename}`);
        }
    };

    const renameFileOnServer = async (filename: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newName = prompt('Enter new filename:', filename);
        if (!newName || newName === filename) return;

        try {
            await api.renameFile(filename, newName);
            // Update tab if open
            setTabs(prev => prev.map(t =>
                t.name === filename ? { ...t, name: newName, language: detectLanguage(newName) } : t
            ));
            setStatusMessage(`Renamed: ${filename} → ${newName}`);
            refreshFileList();
        } catch (err) {
            setStatusMessage(`Error renaming: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    // Share/unshare handlers
    const handleShareToggle = (filename: string, isPublic: boolean, publicId?: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setShareDialogFile({ name: filename, isPublic, publicId });
        setShowShareDialog(true);
    };

    const handleShareConfirm = async () => {
        if (!shareDialogFile) return;

        try {
            if (shareDialogFile.isPublic) {
                // Unshare
                await api.unshareFile(shareDialogFile.name);
                // Update tab if open
                setTabs(prev => prev.map(t =>
                    t.name === shareDialogFile.name ? { ...t, isPublic: false, publicId: undefined } : t
                ));
                // Update the dialog to show it's now private
                setShareDialogFile({ name: shareDialogFile.name, isPublic: false, publicId: undefined });
                setStatusMessage(`Made private: ${shareDialogFile.name}`);
            } else {
                // Share
                const result = await api.shareFile(shareDialogFile.name);
                // Update tab if open
                setTabs(prev => prev.map(t =>
                    t.name === shareDialogFile.name ? { ...t, isPublic: true, publicId: result.publicId } : t
                ));
                // Update the dialog to show the public link
                setShareDialogFile({ name: shareDialogFile.name, isPublic: true, publicId: result.publicId });
                setStatusMessage(`Made public: ${shareDialogFile.name}`);
            }
            refreshFileList();
        } catch (err) {
            setStatusMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const copyPublicLink = () => {
        if (!shareDialogFile?.publicId) return;
        const publicUrl = `${window.location.origin}/public/${shareDialogFile.publicId}`;
        navigator.clipboard.writeText(publicUrl);
        setStatusMessage('Link copied to clipboard!');
    };

    // Compare mode functions
    const toggleCompareMode = async () => {
        if (compareMode) {
            setCompareMode(false);
            setCompareFiles({ left: null, right: null });
        } else {
            // Refresh file list first and use returned files directly
            const files = await refreshFileList();

            // Use active tab as left file, second open tab as right file
            const activeTab = tabs.find(t => t.id === activeTabId);
            const otherTab = tabs.find(t => t.id !== activeTabId);

            const leftFile = activeTab?.name || (files.length > 0 ? files[0].name : null);
            const rightFile = otherTab?.name || (files.length > 1 ? files[1].name : null);

            if (leftFile && rightFile) {
                setCompareMode(true);
                setCompareFiles({ left: leftFile, right: rightFile });
            } else {
                setStatusMessage('Need at least 2 files to compare');
            }
        }
    };

    const selectCompareFile = (side: 'left' | 'right', name: string) => {
        setCompareFiles(prev => ({ ...prev, [side]: name }));
    };

    // Load file content for compare view
    const loadFileContent = useCallback(async (filename: string): Promise<string> => {
        // First check if file is already open in a tab
        const openTab = tabs.find(t => t.name === filename);
        if (openTab) {
            return openTab.content;
        }
        // Otherwise fetch from server
        const file = await api.readFile(filename);
        return file.content;
    }, [tabs]);

    // Toggle markdown preview
    const togglePreview = () => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.language === 'markdown') {
            setPreviewMode(!previewMode);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 's':
                        e.preventDefault();
                        saveFile();
                        break;
                    case 'n':
                        e.preventDefault();
                        createNewTab();
                        break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [tabs, activeTabId]);

    const activeTab = tabs.find(t => t.id === activeTabId);

    return (
        <div className="app-container">
            {/* Toolbar */}
            <div className="toolbar">
                <button className="tool-btn" onClick={createNewTab} title="New File (Ctrl+N)">
                    <FilePlus size={18} />
                </button>
                <div
                    className="file-list-wrapper"
                    onMouseEnter={handleFileListHover}
                    onMouseLeave={handleFileListLeave}
                >
                    <button className="tool-btn" title="Open from Server">
                        <FolderOpen size={18} />
                    </button>
                    {/* File List Dropdown - shows on hover */}
                    {showFileList && (
                        <div className="file-list-dropdown">
                            <div className="file-list-dropdown-content">
                                <div className="file-list-header">Server Files (/data)</div>
                                {serverFiles.length === 0 ? (
                                    <div className="file-list-empty">No files on server</div>
                                ) : (
                                    serverFiles.map(file => (
                                        <div key={file.name} className="file-list-item" onClick={() => openFileFromServer(file.name)}>
                                            <span className="file-name">
                                                {file.isPublic ? <Unlock size={16} className="file-list-lock-icon public" /> : <Lock size={16} className="file-list-lock-icon private" />}
                                                {file.name}
                                            </span>
                                            <div className="file-actions">
                                                <button
                                                    className={`file-action-btn ${file.isPublic ? 'public' : 'private'}`}
                                                    onClick={(e) => handleShareToggle(file.name, file.isPublic || false, file.publicId, e)}
                                                    title={file.isPublic ? 'Public - click to manage' : 'Private - click to share'}
                                                >
                                                    {file.isPublic ? <Unlock size={16} /> : <Lock size={16} />}
                                                </button>
                                                <button
                                                    className="file-action-btn"
                                                    onClick={(e) => renameFileOnServer(file.name, e)}
                                                    title="Rename"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    className="file-action-btn delete"
                                                    onClick={(e) => deleteFileFromServer(file.name, e)}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
                <button className="tool-btn" onClick={saveFile} title="Save to Server (Ctrl+S)" disabled={!activeTab}>
                    <Save size={18} />
                </button>
                <button className="tool-btn" onClick={renameCurrentFile} title="Rename File" disabled={!activeTab}>
                    <Edit3 size={18} />
                </button>
                <div className="separator" />
                <button
                    className={`tool-btn ${previewMode ? 'active' : ''}`}
                    onClick={togglePreview}
                    title="Markdown Preview"
                    disabled={!activeTab || activeTab.language !== 'markdown'}
                >
                    <Eye size={18} />
                </button>
                <div className="separator" />
                <button className="tool-btn" onClick={() => setZoom(z => Math.min(z + 2, 32))} title="Zoom In">
                    <ZoomIn size={18} />
                </button>
                <button className="tool-btn" onClick={() => setZoom(z => Math.max(z - 2, 8))} title="Zoom Out">
                    <ZoomOut size={18} />
                </button>
                <span className="zoom-level">{zoom}px</span>
                <div className="separator" />
                <button className="tool-btn" onClick={refreshFileList} title="Refresh File List">
                    <RefreshCw size={18} />
                </button>
                <button
                    className={`tool-btn ${compareMode ? 'active' : ''}`}
                    onClick={toggleCompareMode}
                    title="Compare Files"
                >
                    <GitCompare size={18} />
                </button>

                {/* Spacer to push user menu to right */}
                <div style={{ flex: 1 }} />

                {/* User Profile Menu */}
                {userInfo && (
                    <div className="user-menu-wrapper">
                        <button
                            className="user-avatar-btn"
                            onClick={() => setShowUserMenu(!showUserMenu)}
                            title={userInfo.displayName || userInfo.email || 'User'}
                        >
                            {userInfo.avatarUrl ? (
                                <img
                                    src={userInfo.avatarUrl}
                                    alt="Profile"
                                    className="user-avatar"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                    }}
                                />
                            ) : null}
                            <User size={18} className={userInfo.avatarUrl ? 'hidden' : ''} />
                        </button>
                        {showUserMenu && (
                            <div className="user-menu-dropdown">
                                <div className="user-menu-header">
                                    {userInfo.avatarUrl && (
                                        <img src={userInfo.avatarUrl} alt="Profile" className="user-menu-avatar" />
                                    )}
                                    <div className="user-menu-info">
                                        <div className="user-menu-name">{userInfo.displayName || userInfo.username}</div>
                                        <div className="user-menu-email">{userInfo.email}</div>
                                    </div>
                                </div>
                                <div className="user-menu-divider" />
                                <button className="user-menu-item logout" onClick={handleLogout}>
                                    <LogOut size={16} />
                                    <span>Sign out</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <Tabs
                tabs={tabs}
                activeTabId={activeTabId}
                onTabClick={setActiveTabId}
                onTabClose={closeTab}
                onShareToggle={handleShareToggle}
            />

            {/* Editor Area */}
            <div className="editor-area">
                {compareMode ? (
                    <CompareView
                        serverFiles={serverFiles}
                        leftFileName={compareFiles.left}
                        rightFileName={compareFiles.right}
                        onSelectLeft={(name) => selectCompareFile('left', name)}
                        onSelectRight={(name) => selectCompareFile('right', name)}
                        loadFileContent={loadFileContent}
                        fontSize={zoom}
                    />
                ) : activeTab ? (
                    <div className="editor-with-banner">
                        {activeTab.isPublic && (
                            <div className="public-file-banner">
                                <Unlock size={18} />
                                <div className="public-file-banner-content">
                                    <strong>Public File:</strong> This file is publicly accessible. Anyone with the link can view it.
                                </div>
                            </div>
                        )}
                        <div className="editor-with-banner-editor">
                            {previewMode && activeTab.language === 'markdown' ? (
                                <div className="split-view">
                                    <div className="split-editor">
                                        <Editor
                                            content={activeTab.content}
                                            language={activeTab.language}
                                            onChange={(val) => updateTabContent(activeTab.id, val || '')}
                                            fontSize={zoom}
                                        />
                                    </div>
                                    <div className="split-preview">
                                        <MarkdownPreview
                                            content={activeTab.content}
                                            fontSize={zoom}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <Editor
                                    content={activeTab.content}
                                    language={activeTab.language}
                                    onChange={(val) => updateTabContent(activeTab.id, val || '')}
                                    fontSize={zoom}
                                />
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="empty-state">
                        <p>No files open</p>
                        <p>Click <strong>New</strong> to create a file or <strong>Open</strong> to load from server</p>
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="status-bar">
                <div className="status-item">{statusMessage}</div>
                <div className="status-item">{activeTab ? activeTab.language : ''}</div>
                <div className="status-item">{activeTab?.isDirty ? '● Modified' : ''}</div>
            </div>

            {/* Share Dialog */}
            {showShareDialog && shareDialogFile && (
                <div className="modal-overlay" onClick={() => setShowShareDialog(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>Share File: {shareDialogFile.name}</h2>
                        <div className="modal-body">
                            {shareDialogFile.isPublic ? (
                                <>
                                    <p>This file is currently <strong>public</strong>. Anyone with the link can view it.</p>
                                    {shareDialogFile.publicId && (
                                        <div className="public-link-section">
                                            <label>Public Link:</label>
                                            <div className="public-link-input">
                                                <input
                                                    type="text"
                                                    value={`${window.location.origin}/public/${shareDialogFile.publicId}`}
                                                    readOnly
                                                />
                                                <button className="btn-primary" onClick={copyPublicLink}>Copy</button>
                                            </div>
                                        </div>
                                    )}
                                    <button className="btn-danger" onClick={handleShareConfirm}>
                                        <Lock size={16} /> Make Private
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p>This file is currently <strong>private</strong>. Only you can view it.</p>
                                    <button className="btn-primary" onClick={handleShareConfirm}>
                                        <Unlock size={16} /> Make Public & Generate Link
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowShareDialog(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
