import React, { useState, useEffect } from 'react';
import Editor from './Editor';
import MarkdownPreview from './MarkdownPreview';
import { Eye, EyeOff, FileText } from 'lucide-react';

interface PublicViewerProps {
    publicId: string;
}

const PublicViewer: React.FC<PublicViewerProps> = ({ publicId }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>('');
    const [content, setContent] = useState<string>('');
    const [language, setLanguage] = useState<string>('plaintext');
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        const fetchPublicFile = async () => {
            try {
                const res = await fetch(`/api/public/${publicId}`);
                if (!res.ok) {
                    throw new Error('File not found or no longer available');
                }
                const data = await res.json();
                setFileName(data.name);
                setContent(data.content);
                setLanguage(detectLanguage(data.name));
                setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load file');
                setLoading(false);
            }
        };

        fetchPublicFile();
    }, [publicId]);

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

    if (loading) {
        return (
            <div className="app-container">
                <div className="public-viewer-header">
                    <FileText size={20} />
                    <span>Loading...</span>
                </div>
                <div className="empty-state">
                    <p>Loading public file...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="app-container">
                <div className="public-viewer-header">
                    <FileText size={20} />
                    <span>Error</span>
                </div>
                <div className="empty-state">
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            {/* Public Viewer Header */}
            <div className="public-viewer-header">
                <FileText size={20} />
                <span className="public-viewer-filename">{fileName}</span>
                <span className="public-viewer-badge">Public View (Read Only)</span>
                {language === 'markdown' && (
                    <>
                        <div style={{ flex: 1 }} />
                        <button 
                            className={`tool-btn ${showPreview ? 'active' : ''}`}
                            onClick={() => setShowPreview(!showPreview)}
                            title="Toggle Markdown Preview"
                        >
                            {showPreview ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </>
                )}
            </div>

            {/* Editor Area */}
            <div className="editor-area">
                {showPreview && language === 'markdown' ? (
                    <div className="split-view">
                        <div className="split-editor">
                            <Editor
                                content={content}
                                language={language}
                                onChange={() => {}} // Read-only, no changes
                                fontSize={14}
                                readOnly={true}
                            />
                        </div>
                        <div className="split-preview">
                            <MarkdownPreview
                                content={content}
                                fontSize={14}
                            />
                        </div>
                    </div>
                ) : (
                    <Editor
                        content={content}
                        language={language}
                        onChange={() => {}} // Read-only, no changes
                        fontSize={14}
                        readOnly={true}
                    />
                )}
            </div>

            {/* Status Bar */}
            <div className="status-bar">
                <div className="status-item">Public File - Read Only</div>
                <div className="status-item">{language}</div>
                <div className="status-item">{content.length} characters</div>
            </div>
        </div>
    );
};

export default PublicViewer;
