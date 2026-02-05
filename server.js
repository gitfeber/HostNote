import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 8080;
const DATA_DIR = '/data';

// Rate limiting: Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // max requests per window

function rateLimit(req, res, next) {
    // Use X-Forwarded-For header set by oauth2-proxy, fallback to connection IP
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        'unknown';

    const now = Date.now();
    const clientData = rateLimitMap.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    if (now > clientData.resetTime) {
        clientData.count = 1;
        clientData.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
        clientData.count++;
    }

    rateLimitMap.set(clientIp, clientData);

    // Clean up old entries periodically
    if (Math.random() < 0.01) {
        for (const [ip, data] of rateLimitMap.entries()) {
            if (now > data.resetTime) rateLimitMap.delete(ip);
        }
    }

    if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
}

// Encryption settings
if (!process.env.ENCRYPTION_KEY) {
    console.error('FATAL: ENCRYPTION_KEY environment variable is missing. Server cannot start securely.');
    process.exit(1);
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Maximum filename length
const MAX_FILENAME_LENGTH = 255;
// Allowed filename pattern: alphanumeric, dash, underscore, dot (no leading dot for hidden files)
const FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// Validate filename for security
function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') return false;
    if (filename.length > MAX_FILENAME_LENGTH) return false;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false;
    if (!FILENAME_REGEX.test(filename)) return false;
    // Block hidden files and special names
    if (filename.startsWith('.') || filename === '.' || filename === '..') return false;
    return true;
}

// Get user identifier from request headers (set by OAuth2 proxy)
function getUserId(req) {
    const email = req.headers['x-auth-request-email'];
    const user = req.headers['x-auth-request-user'];
    // Require authentication - don't fall back to anonymous
    return email || user || null;
}

// Middleware to require authentication for protected routes
function requireAuth(req, res, next) {
    const userId = getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.userId = userId;
    next();
}

// Get user-specific directory path
function getUserDataDir(userId) {
    // Hash the user ID to create a safe directory name
    const userHash = crypto.createHash('sha256').update(userId).digest('hex').substring(0, 16);
    return path.join(DATA_DIR, userHash);
}

// Get metadata file path for a user's file
function getMetadataPath(userId, filename) {
    const userDataDir = getUserDataDir(userId);
    return path.join(userDataDir, `.${filename}.meta.json`);
}

// Read file metadata
async function getFileMetadata(userId, filename) {
    try {
        const metaPath = getMetadataPath(userId, filename);
        const data = await fs.readFile(metaPath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { isPublic: false, publicId: null };
    }
}

// Save file metadata
async function saveFileMetadata(userId, filename, metadata) {
    const metaPath = getMetadataPath(userId, filename);
    await fs.writeFile(metaPath, JSON.stringify(metadata), 'utf-8');
}

// Generate public file ID
function generatePublicId() {
    return crypto.randomBytes(16).toString('hex');
}

// Public files registry (in-memory, could be moved to database)
const publicFilesRegistry = new Map(); // publicId -> { userId, filename }

// Load public files registry on startup
async function loadPublicFilesRegistry() {
    try {
        const users = await fs.readdir(DATA_DIR);
        for (const userHash of users) {
            const userDir = path.join(DATA_DIR, userHash);
            const files = await fs.readdir(userDir);
            for (const file of files) {
                if (file.endsWith('.meta.json')) {
                    const metaPath = path.join(userDir, file);
                    const data = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(data);
                    if (meta.isPublic && meta.publicId) {
                        // Extract original filename (remove .{filename}.meta.json pattern)
                        const filename = file.slice(1, -10); // Remove leading '.' and '.meta.json'
                        publicFilesRegistry.set(meta.publicId, { userId: meta.userId, filename });
                    }
                }
            }
        }
        console.log(`Loaded ${publicFilesRegistry.size} public files`);
    } catch (err) {
        console.error('Error loading public files registry:', err);
    }
}

// Derive a per-user encryption key from master key + user ID
function getUserEncryptionKey(userId) {
    // Use HKDF-like derivation: PBKDF2 with master key + user ID
    return crypto.pbkdf2Sync(ENCRYPTION_KEY, `user:${userId}`, 100000, 32, 'sha512');
}

// Derive a key from the user's encryption key and salt
function getKey(userKey, salt) {
    return crypto.pbkdf2Sync(userKey, salt, 100000, 32, 'sha512');
}

// Encrypt content with user-specific key
function encrypt(text, userId) {
    const userKey = getUserEncryptionKey(userId);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey(userKey, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

// Decrypt content with user-specific key
function decrypt(encryptedData, userId) {
    const userKey = getUserEncryptionKey(userId);
    const buffer = Buffer.from(encryptedData, 'base64');

    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, TAG_POSITION);
    const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = buffer.subarray(ENCRYPTED_POSITION);

    const key = getKey(userKey, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

// Security headers middleware
function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Content Security Policy (Monaco editor requires unsafe-inline/eval and CDN access)
    // Allow images from github.com for profile avatars
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "img-src 'self' data: blob: https://github.com https://*.githubusercontent.com; " +
        "font-src 'self' data: https://cdn.jsdelivr.net; " +
        "connect-src 'self' https://cdn.jsdelivr.net; " +
        "worker-src 'self' blob:; " +
        "manifest-src 'self'; " +
        "frame-ancestors 'none';"
    );
    next();
}

// Apply rate limiting to API routes
app.use('/api', rateLimit);

// Apply security headers to all routes
app.use(securityHeaders);

// Limit request body size to prevent large payload attacks
app.use(express.json({ limit: '6mb' }));

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating data directory:', err);
    }
}

// API: Get current user info from OAuth2 proxy headers
app.get('/api/user', (req, res) => {
    const user = req.headers['x-auth-request-user'] || null;
    const email = req.headers['x-auth-request-email'] || null;
    const preferredUsername = req.headers['x-auth-request-preferred-username'] || user;

    if (!user && !email) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
        username: user,
        email: email,
        displayName: preferredUsername || user,
        // GitHub avatar URL (works for GitHub OAuth)
        avatarUrl: user ? `https://github.com/${user}.png?size=80` : null
    });
});

// API: List files in data directory
app.get('/api/files', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const userDataDir = getUserDataDir(userId);

        // Ensure user directory exists
        await fs.mkdir(userDataDir, { recursive: true });

        const files = await fs.readdir(userDataDir);
        const fileDetails = await Promise.all(
            files.map(async (name) => {
                // Skip metadata files
                if (name.startsWith('.') && name.endsWith('.meta.json')) {
                    return null;
                }

                const filePath = path.join(userDataDir, name);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    const metadata = await getFileMetadata(userId, name);
                    return {
                        name,
                        size: stats.size,
                        modified: stats.mtime,
                        isPublic: metadata.isPublic,
                        publicId: metadata.publicId
                    };
                }
                return null;
            })
        );
        res.json(fileDetails.filter(Boolean));
    } catch (err) {
        res.json([]);
    }
});

// API: Read a file
app.get('/api/files/:filename', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const filename = req.params.filename;
        // Security: validate filename
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        const userDataDir = getUserDataDir(userId);
        const filePath = path.join(userDataDir, filename);
        const encryptedContent = await fs.readFile(filePath, 'utf-8');
        const content = decrypt(encryptedContent, userId);
        res.json({ name: filename, content });
    } catch (err) {
        res.status(404).json({ error: 'File not found' });
    }
});

// API: Save a file
app.post('/api/files/:filename', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const filename = req.params.filename;
        // Security: validate filename
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        const { content } = req.body;
        // Security: validate content
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content' });
        }
        if (content.length > MAX_FILE_SIZE) {
            return res.status(413).json({ error: 'File too large (max 5MB)' });
        }
        const userDataDir = getUserDataDir(userId);
        await fs.mkdir(userDataDir, { recursive: true });

        const encryptedContent = encrypt(content, userId);
        const filePath = path.join(userDataDir, filename);
        await fs.writeFile(filePath, encryptedContent, 'utf-8');
        console.log(`ACTION: User ${userId} saved file - ${filename}`);
        res.json({ success: true, name: filename });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// API: Delete a file
app.delete('/api/files/:filename', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const filename = req.params.filename;
        // Security: validate filename
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        const userDataDir = getUserDataDir(userId);
        const filePath = path.join(userDataDir, filename);

        // Clean up public registry if file was shared
        const metadata = await getFileMetadata(userId, filename);
        if (metadata.isPublic && metadata.publicId) {
            publicFilesRegistry.delete(metadata.publicId);
        }

        // Delete the file
        await fs.unlink(filePath);

        // Delete metadata file if exists
        try {
            const metaPath = getMetadataPath(userId, filename);
            await fs.unlink(metaPath);
        } catch {
            // Metadata file may not exist, ignore
        }

        console.log(`ACTION: User ${userId} deleted file - ${filename}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// API: Rename a file
app.put('/api/files/:filename/rename', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const oldFilename = req.params.filename;
        const { newName } = req.body;

        // Security: validate both filenames
        if (!isValidFilename(oldFilename) || !isValidFilename(newName)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const userDataDir = getUserDataDir(userId);
        const oldPath = path.join(userDataDir, oldFilename);
        const newPath = path.join(userDataDir, newName);

        // Check if new name already exists
        try {
            await fs.access(newPath);
            return res.status(409).json({ error: 'File already exists' });
        } catch {
            // File doesn't exist, we can proceed
        }

        // Rename the file
        await fs.rename(oldPath, newPath);

        // Rename metadata file if exists and update registry
        try {
            const oldMetaPath = getMetadataPath(userId, oldFilename);
            const newMetaPath = getMetadataPath(userId, newName);
            const metadata = await getFileMetadata(userId, oldFilename);

            if (metadata.isPublic && metadata.publicId) {
                // Update registry with new filename
                publicFilesRegistry.set(metadata.publicId, { userId, filename: newName });
            }

            // Rename metadata file
            await fs.rename(oldMetaPath, newMetaPath);
        } catch {
            // Metadata file may not exist, ignore
        }

        console.log(`ACTION: User ${userId} renamed file - ${oldFilename} -> ${newName}`);
        res.json({ success: true, newName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to rename file' });
    }
});

// API: Share a file (make it public)
app.post('/api/files/:filename/share', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const filename = req.params.filename;

        // Security: validate filename
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const userDataDir = getUserDataDir(userId);
        const filePath = path.join(userDataDir, filename);

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get or create metadata
        const metadata = await getFileMetadata(userId, filename);

        // If already public, return existing publicId
        if (metadata.isPublic && metadata.publicId) {
            return res.json({
                success: true,
                isPublic: true,
                publicId: metadata.publicId,
                publicUrl: `/public/${metadata.publicId}`
            });
        }

        // Generate new public ID
        const publicId = generatePublicId();
        metadata.isPublic = true;
        metadata.publicId = publicId;
        metadata.userId = userId; // Store userId for registry recovery after restart

        // Save metadata
        await saveFileMetadata(userId, filename, metadata);

        // Add to registry
        publicFilesRegistry.set(publicId, { userId, filename });

        console.log(`ACTION: User ${userId} made file public - ${filename} (${publicId})`);

        res.json({
            success: true,
            isPublic: true,
            publicId,
            publicUrl: `/public/${publicId}`
        });
    } catch (err) {
        console.error('Error sharing file:', err);
        res.status(500).json({ error: 'Failed to share file' });
    }
});

// API: Unshare a file (make it private)
app.post('/api/files/:filename/unshare', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const filename = req.params.filename;

        // Security: validate filename
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const userDataDir = getUserDataDir(userId);
        const filePath = path.join(userDataDir, filename);

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get metadata
        const metadata = await getFileMetadata(userId, filename);

        // Remove from registry if public
        if (metadata.isPublic && metadata.publicId) {
            publicFilesRegistry.delete(metadata.publicId);
        }

        // Update metadata
        metadata.isPublic = false;
        metadata.publicId = null;
        await saveFileMetadata(userId, filename, metadata);

        console.log(`ACTION: User ${userId} made file private - ${filename}`);

        res.json({ success: true, isPublic: false });
    } catch (err) {
        console.error('Error unsharing file:', err);
        res.status(500).json({ error: 'Failed to unshare file' });
    }
});

// API: Access a public file (no authentication required)
// Rate limiting applied to prevent enumeration attacks
app.get('/api/public/:publicId', rateLimit, async (req, res) => {
    try {
        const { publicId } = req.params;

        // Validate publicId format (32 hex characters)
        if (!/^[a-f0-9]{32}$/.test(publicId)) {
            return res.status(400).json({ error: 'Invalid public ID format' });
        }

        // Look up file in registry
        const fileInfo = publicFilesRegistry.get(publicId);

        if (!fileInfo) {
            return res.status(404).json({ error: 'Public file not found' });
        }

        const { userId, filename } = fileInfo;
        const userDataDir = getUserDataDir(userId);
        const filePath = path.join(userDataDir, filename);

        // Read and decrypt the file
        const encryptedContent = await fs.readFile(filePath, 'utf-8');
        const content = decrypt(encryptedContent, userId);

        res.json({
            name: filename,
            content,
            isPublic: true
        });
    } catch (err) {
        console.error('Error accessing public file:', err);
        res.status(404).json({ error: 'Public file not found or no longer available' });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Global error handler - prevents stack traces from leaking
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

ensureDataDir().then(async () => {
    // Load public files registry on startup
    await loadPublicFilesRegistry();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`HostNote server running on port ${PORT}`);
    });
});
