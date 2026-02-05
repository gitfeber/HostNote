import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import PublicViewer from './components/PublicViewer.tsx'
import './styles/main.css'

// Check if we're viewing a public file
const path = window.location.pathname;
const publicMatch = path.match(/^\/public\/([a-zA-Z0-9]+)$/);

// If path starts with /public but doesn't match the pattern, show error
const isInvalidPublicPath = path.startsWith('/public') && !publicMatch;

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        {isInvalidPublicPath ? (
            <div className="app-container">
                <div className="public-viewer-header">
                    <span>Error</span>
                </div>
                <div className="empty-state">
                    <p>Invalid public URL</p>
                    <p>Public files must be accessed with a valid share link.</p>
                </div>
            </div>
        ) : publicMatch ? (
            <PublicViewer publicId={publicMatch[1]} />
        ) : (
            <App />
        )}
    </React.StrictMode>,
)
