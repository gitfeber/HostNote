import React from 'react';
import { Editor as MonacoEditor } from '@monaco-editor/react';

interface EditorProps {
    content: string;
    language: string;
    onChange: (value: string | undefined) => void;
    fontSize: number;
    readOnly?: boolean;
}

const Editor: React.FC<EditorProps> = ({ content, language, onChange, fontSize, readOnly = false }) => {
    return (
        <MonacoEditor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            onChange={onChange}
            options={{
                minimap: { enabled: true },
                fontSize: fontSize,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
                tabSize: 2,
                readOnly: readOnly,
            }}
        />
    );
};

export default Editor;
