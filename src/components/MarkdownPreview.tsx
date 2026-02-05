import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
    content: string;
    fontSize: number;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, fontSize }) => {
    return (
        <div className="markdown-preview" style={{ fontSize: `${fontSize}px` }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default MarkdownPreview;
