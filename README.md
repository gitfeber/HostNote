# HostNote

A secure, multi-user code editor with GitHub OAuth authentication, built with React, Monaco Editor, and designed for self-hosting on Kubernetes or Docker.

![HostNote Banner](public/HostNote_Banner.png)

## 🎯 Features

### Core Functionality
- **Multi-tab Editing**: Open and edit multiple files simultaneously.
- **Syntax Highlighting**: Auto-detection for 20+ languages (JS, TS, Python, YAML, Markdown, etc.).
- **Per-User Encryption**: Files are encrypted with AES-256-GCM using unique per-user keys.
- **Persistent Storage**: Changes are automatically saved and stored securely.
- **Dark Mode**: VSCode-inspired dark theme for comfortable coding.

### Security
- **GitHub OAuth 2.0**: Secure authentication via GitHub (requires `oauth2-proxy`).
- **End-to-End Encryption**: Data is encrypted at rest. The server cannot read files without the user's derived key.
- **Isolated Enironments**: Each user gets their own sandboxed file directory.
- **Rate Limiting**: Built-in protection against abuse.

## 🚀 Quick Start (Docker Compose)

The easiest way to run HostNote is using Docker Compose.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/gitfeber/hostnote.git
    cd hostnote/deploy
    ```

2.  **Configure OAuth:**
    - Create a GitHub OAuth App (Settings -> Developer Settings -> OAuth Apps).
    - callback URL: `http://localhost:4180/oauth2/callback`

3.  **Edit `docker-compose.yml`:**
    - Replace `your_github_client_id` and `your_github_client_secret`.
    - Set a strong `COOKIE_SECRET` (generate with `python3 -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(16)).decode())'`).
    - Set a strong `ENCRYPTION_KEY` (32 bytes hex).

4.  **Run:**
    ```bash
    docker-compose up -d
    ```

5.  **Access:**
    Open http://localhost:4180 and sign in with GitHub.

## ☸️ Kubernetes Deployment

For production deployments on Kubernetes:

1.  **Navigate to manifests:**
    ```bash
    cd deploy/kubernetes
    ```

2.  **Configure Secrets:**
    Copy the secrets template and add your credentials:
    ```bash
    cp secrets.yaml.example secrets.yaml
    # Edit secrets.yaml with your keys
    kubectl apply -f secrets.yaml
    ```

3.  **Configure Ingress:**
    Edit `ingress.yaml` to match your domain and TLS issuer.

4.  **Deploy:**
    ```bash
    kubectl apply -f namespace.yaml
    kubectl apply -f pvc.yaml
    kubectl apply -f configmap.yaml
    kubectl apply -f deployment.yaml
    kubectl apply -f oauth2-proxy.yaml
    kubectl apply -f ingress.yaml
    ```

## 🛠️ Configuration

| Environment Variable | Description |
| -------------------- | ----------- |
| `ENCRYPTION_KEY`     | **Required**. 32-byte hex string used as master key for encryption. |
| `PORT`               | Server port (default: 8080). |
| `DATA_DIR`           | Path to store user data (default: `/data`). |

## 🏗️ Architecture

- **Frontend**: React, Vite, Monaco Editor.
- **Backend**: Node.js Express server.
- **Auth**: Relies on `X-Auth-Request-User` headers provided by an authenticating proxy (like OAuth2-Proxy).

## 🤝 Contributing

Contributions are welcome!

## 📝 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
