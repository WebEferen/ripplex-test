# RippleX Deployment Guide

This guide explains how to build and deploy your RippleX application for production.

## Overview

RippleX provides a production-ready build system similar to Next.js. The build process:
1. Bundles client-side code using Vite (minified and optimized)
2. Bundles server-side code for SSR (minified)
3. Pre-renders static assets
4. Creates a production server that handles SSR and serves static assets

## Building for Production

### 1. Build Your Application

Run the build command in your project directory:

```bash
ripplex build
```

This will:
- Create a `dist/` directory in your project
- Build optimized client bundles in `dist/client/`
- Build SSR bundles in `dist/server/`
- Copy runtime files (API routes, middleware)
- Generate a route manifest

**Output structure:**
```
dist/
├── client/              # Client-side bundles (static assets)
│   ├── index.html      # HTML template
│   ├── assets/         # JS, CSS bundles (hashed filenames)
│   └── .vite/          # Vite manifests
├── server/             # Server-side bundles (SSR)
│   └── .ripplex-server-entry.js
├── api/                # API routes (copied from project)
├── middleware.js       # Middleware (if exists)
└── routes.json         # Route manifest
```

### 2. Start the Production Server

After building, start the production server:

```bash
ripplex start
```

The server will:
- Serve static assets from `dist/client/`
- Handle SSR for dynamic routes
- Process API routes
- Run in production mode with optimizations

**Options:**
```bash
# Start on a different port
ripplex start --port 3000
ripplex start -p 3000
```

## Deployment Options

### Option 1: Deploy to a Node.js Server

1. **Build locally:**
   ```bash
   ripplex build
   ```

2. **Transfer files to server:**
   - Upload your entire project directory (or at minimum: `dist/`, `node_modules/`, `package.json`)
   - Ensure `node_modules` includes ripplex and all dependencies

3. **Install dependencies on server:**
   ```bash
   npm install --production
   ```

4. **Start the server:**
   ```bash
   ripplex start
   ```

5. **Run with a process manager (recommended):**
   ```bash
   # Using PM2
   pm2 start "ripplex start" --name myapp

   # Using systemd
   # Create /etc/systemd/system/myapp.service
   ```

### Option 2: Deploy with Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application files
COPY . .

# Build the application
RUN npx ripplex build

# Expose port
EXPOSE 5173

# Start the production server
CMD ["npx", "ripplex", "start"]
```

Build and run:
```bash
docker build -t myapp .
docker run -p 5173:5173 myapp
```

### Option 3: Deploy to Vercel, Netlify, etc.

RippleX is designed for Node.js servers with SSR. For edge platforms:
- Vercel: Use serverless functions (requires custom adapter)
- Netlify: Use Netlify Functions (requires custom adapter)
- Note: These platforms may require additional configuration

### Option 4: Static Export (SSG Only)

If your application is fully static (no SSR), you can:
1. Build with `ripplex build`
2. Deploy only the `dist/client/` directory to any static hosting (Netlify, Vercel, S3, etc.)
3. Note: This only works if you don't need server-side rendering or API routes

## Environment Variables

Set environment variables for your production server:

```bash
# Port (default: 5173)
PORT=3000

# Node environment (automatically set by ripplex)
NODE_ENV=production
```

## Performance Optimizations

The production build includes:

1. **Minification**: All JavaScript and CSS is minified
2. **Code Splitting**: Automatic code splitting for optimal loading
3. **Tree Shaking**: Dead code elimination
4. **Asset Hashing**: Cache-busting with content hashes
5. **Compression**: Use a reverse proxy (nginx, etc.) for gzip/brotli compression

## Nginx Configuration (Recommended)

Use nginx as a reverse proxy in front of your Node.js server:

```nginx
server {
    listen 80;
    server_name example.com;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # Serve static assets directly
    location /assets/ {
        alias /path/to/your/app/dist/client/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Proxy to Node.js server
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Monitoring and Logs

Monitor your production server:

```bash
# View logs with PM2
pm2 logs myapp

# View server status
pm2 status
```

## Troubleshooting

### Build fails
- Ensure all dependencies are installed: `npm install`
- Check for syntax errors in your code
- Verify `pages/` directory exists with `.ripple` files

### Server won't start
- Run `ripplex build` first
- Ensure `dist/` directory exists
- Check port is not already in use: `lsof -i :5173`

### 404 errors in production
- Verify routes are correctly defined in `pages/`
- Check `dist/routes.json` for route manifest
- Ensure middleware isn't blocking requests

### Static assets not loading
- Check `dist/client/` contains built assets
- Verify asset paths in HTML
- Check reverse proxy configuration if using one

## Best Practices

1. **Always build before deploying**: Never deploy without running `ripplex build`
2. **Use a process manager**: PM2, systemd, or Docker for production
3. **Set up monitoring**: Track errors and performance
4. **Enable compression**: Use nginx or similar for gzip/brotli
5. **Use HTTPS**: Always serve production apps over HTTPS
6. **Cache static assets**: Set long cache times for hashed assets
7. **Test the build locally**: Run `ripplex start` locally before deploying

## Example: Complete Deployment Workflow

```bash
# 1. Development
ripplex dev

# 2. Build for production
ripplex build

# 3. Test production build locally
ripplex start

# 4. Deploy to server
rsync -avz --exclude node_modules . user@server:/var/www/myapp/

# 5. On server
cd /var/www/myapp
npm install --production
ripplex build  # Build on server (or use pre-built dist/)
pm2 start "ripplex start" --name myapp
```

## Support

For issues or questions:
- Check the [RippleX documentation](https://github.com/your-repo)
- Open an issue on GitHub
- Review the [examples](https://github.com/your-repo/examples)
