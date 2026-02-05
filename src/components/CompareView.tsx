import React, { useState, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';

interface ServerFile {
    name: string;
}

interface CompareViewProps {
    serverFiles: ServerFile[];
    leftFileName: string | null;
    rightFileName: string | null;
    onSelectLeft: (name: string) => void;
    onSelectRight: (name: string) => void;
    loadFileContent: (filename: string) => Promise<string>;
    fontSize: number;
}

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

const CompareView: React.FC<CompareViewProps> = ({
    serverFiles,
    leftFileName,
    rightFileName,
    onSelectLeft,
    onSelectRight,
    loadFileContent,
    fontSize,
}) => {
    const [leftContent, setLeftContent] = useState<string>('');
    const [rightContent, setRightContent] = useState<string>('');
    const [leftLoading, setLeftLoading] = useState(false);
    const [rightLoading, setRightLoading] = useState(false);
    const [leftLoaded, setLeftLoaded] = useState<string | null>(null);
    const [rightLoaded, setRightLoaded] = useState<string | null>(null);

    // Load left file content when selection changes
    useEffect(() => {
        if (leftFileName) {
            setLeftLoading(true);
            setLeftLoaded(null);
            loadFileContent(leftFileName)
                .then(content => {
                    setLeftContent(content);
                    setLeftLoaded(leftFileName);
                })
                .catch(() => {
                    setLeftContent('// Error loading file');
                    setLeftLoaded(leftFileName);
                })
                .finally(() => setLeftLoading(false));
        } else {
            setLeftContent('');
            setLeftLoaded(null);
        }
    }, [leftFileName, loadFileContent]);

    // Load right file content when selection changes
    useEffect(() => {
        if (rightFileName) {
            setRightLoading(true);
            setRightLoaded(null);
            loadFileContent(rightFileName)
                .then(content => {
                    setRightContent(content);
                    setRightLoaded(rightFileName);
                })
                .catch(() => {
                    setRightContent('// Error loading file');
                    setRightLoaded(rightFileName);
                })
                .finally(() => setRightLoading(false));
        } else {
            setRightContent('');
            setRightLoaded(null);
        }
    }, [rightFileName, loadFileContent]);

    // Check if both files are fully loaded and match current selection
    const isReady = leftFileName && rightFileName && 
                    leftLoaded === leftFileName && rightLoaded === rightFileName &&
                    !leftLoading && !rightLoading;

    // Determine language from right file, fallback to left
    const language = rightFileName 
        ? detectLanguage(rightFileName) 
        : leftFileName 
            ? detectLanguage(leftFileName) 
            : 'plaintext';

    return (
        <div className="compare-view">
            <div className="compare-header">
                <div className="compare-selector">
                    <label>Left:</label>
                    <select 
                        value={leftFileName || ''} 
                        onChange={(e) => onSelectLeft(e.target.value)}
                    >
                        <option value="" disabled>Select file...</option>
                        {serverFiles.map(file => (
                            <option key={file.name} value={file.name} disabled={file.name === rightFileName}>
                                {file.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="compare-selector">
                    <label>Right:</label>
                    <select 
                        value={rightFileName || ''} 
                        onChange={(e) => onSelectRight(e.target.value)}
                    >
                        <option value="" disabled>Select file...</option>
                        {serverFiles.map(file => (
                            <option key={file.name} value={file.name} disabled={file.name === leftFileName}>
                                {file.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="compare-editor">
                {!isReady ? (
                    <div className="compare-empty">
                        <p>{(leftLoading || rightLoading) ? 'Loading files...' : 'Select two files to compare'}</p>
                    </div>
                ) : (
                    <DiffEditor
                        key={`${leftLoaded}-${rightLoaded}`}
                        height="100%"
                        language={language}
                        original={leftContent}
                        modified={rightContent}
                        theme="vs-dark"
                        options={{
                            fontSize: fontSize,
                            readOnly: true,
                            renderSideBySide: true,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            diffWordWrap: 'on',
                            renderOverviewRuler: true,
                            ignoreTrimWhitespace: false,
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default CompareView;
