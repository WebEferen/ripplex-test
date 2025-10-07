#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import polka from 'polka';
import sirv from 'sirv';
import colors from 'colors';

const PORT = process.env.PORT || '5173';
const ROOT_DIR = process.cwd(); // Project root (where we run from)
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Load route manifest
const routesManifest = JSON.parse(
	fs.readFileSync(path.join(DIST_DIR, 'routes.json'), 'utf-8')
);

// Read built index.html template
const indexPath = path.join(DIST_DIR, 'client', 'index.html');
const indexTemplate = fs.readFileSync(indexPath, 'utf-8');

// Optional page middleware
const MIDDLEWARE_PATH = path.join(DIST_DIR, 'middleware.js');
let pageMiddleware = null;
if (fs.existsSync(MIDDLEWARE_PATH)) {
	try {
		const mwModule = await import(MIDDLEWARE_PATH);
		pageMiddleware = mwModule.default || mwModule.middleware || null;
		if (typeof pageMiddleware !== 'function') pageMiddleware = null;
	} catch (err) {
		console.error('Failed to load middleware.js:', err);
	}
}

// Create the server
const app = polka();

// Body parser middleware for API routes
app.use((req, res, next) => {
	if (req.url.startsWith('/api') && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
		let body = '';
		req.on('data', chunk => { body += chunk.toString(); });
		req.on('end', () => {
			try {
				req.body = body ? JSON.parse(body) : {};
			} catch (e) {
				req.body = body;
			}
			next();
		});
	} else {
		next();
	}
});

// Register API routes
for (const route of routesManifest.api) {
	const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
	const apiPath = path.join(DIST_DIR, route.file);

	methods.forEach(method => {
		app.add(method, route.path, async (req, res) => {
			try {
				const handler = await import(apiPath);

				if (handler.default) {
					await handler.default(req, res);
				} else if (handler[method.toUpperCase()]) {
					await handler[method.toUpperCase()](req, res);
				} else {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'No default export or method handler in API route' }));
				}
			} catch (error) {
				console.error('API route error:', error);
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: error.message }));
			}
		});
	});
}

// Import Ripple server render functions
let renderFn, getCssFn;
try {
	const rippleServer = await import('ripple/server');
	renderFn = rippleServer.render;
	getCssFn = rippleServer.get_css_for_hashes;
} catch (err) {
	console.error('Failed to load ripple/server:', err);
	process.exit(1);
}

// Load SSR bundle
const ssrBundlePath = path.join(DIST_DIR, 'server', 'index.js');
let pageComponents = {};
if (fs.existsSync(ssrBundlePath)) {
	try {
		pageComponents = (await import(ssrBundlePath)).default;
	} catch (err) {
		console.error('Failed to load SSR bundle:', err.message);
		process.exit(1);
	}
} else {
	console.error('SSR bundle not found. Run "ripplex build" first.');
	process.exit(1);
}

// Register page routes
for (const route of routesManifest.pages) {
	app.get(route.path, async (req, res) => {
		try {
			const reqStartNs = process.hrtime.bigint();

			// Run page middleware if present
			let middlewareProps = {};
			if (pageMiddleware) {
				try {
					const result = await pageMiddleware(req, res);
					if (res.writableEnded) return;
					if (result && typeof result === 'object' && result.props && typeof result.props === 'object') {
						middlewareProps = result.props;
					}
				} catch (mwErr) {
					console.error('Page middleware error:', mwErr);
				}
			}

			const props = { ...(req.params || {}), ...middlewareProps };

			// Get the component from the bundled SSR code
			const componentModule = pageComponents[route.file];
			const Component = componentModule?.default || componentModule;

			if (!Component || typeof Component !== 'function') {
				throw new Error(`Component not found or invalid for ${route.file}`);
			}

			// Server-side render the component
			const rendered = await renderFn(Component);

			// Create RIPPLE data object
			const rippleData = {
				routePath: '/' + route.file,
				routeProps: props
			};
			const runtimeScript = `<script>window.__RIPPLE=${JSON.stringify(rippleData)};<\/script>`;

			// Get component CSS
			let componentCss = '';
			if (rendered.css && rendered.css.size > 0) {
				const cssContent = getCssFn(rendered.css);
				if (cssContent) {
					componentCss = `<style>${cssContent}</style>`;
				}
			}

			// Build final HTML
			let html = indexTemplate;
			html = html.replace(/<\/head>/i, `${componentCss}\n${rendered.head}\n${runtimeScript}\n</head>`);
			html = html.replace(/(<div\s+id="root"[^>]*>)([\s\S]*?)(<\/div>)/i, `$1${rendered.body}$3`);

			res.writeHead(200, { 'Content-Type': 'text/html' });
			const nowNs = process.hrtime.bigint();
			const deltaMs = Number((nowNs - reqStartNs) / 1000000n);
			const isDynamic = route.path.includes(':');
			console.log(`${colors.white(req.method)} ${colors.gray(req.url)} ${colors.white('→')} ${colors.gray(route.file)} ${colors.dim(`[${isDynamic ? 'dynamic' : 'static'}]`)} ${colors.dim(`+${deltaMs}ms`)}`);
			return res.end(html);
		} catch (error) {
			console.error('Page render error:', error);
			res.writeHead(500, { 'Content-Type': 'text/html' });
			res.end(`<h1>Error rendering page</h1><pre>${error.message}\n\n${error.stack}</pre>`);
		}
	});
}

// Serve static files (assets, etc.)
const serveAssets = sirv(path.join(DIST_DIR, 'client', 'assets'), {
	dev: false,
	single: false,
	maxAge: 31536000, // 1 year for hashed assets
	immutable: true
});
app.use('/assets', serveAssets);

// Start server
app.listen(PORT, () => {
	const bullet = colors.dim('└─');
	const branch = colors.dim('├─');

	const modeBadge = colors.green(' Production ');
	const header = `\n${colors.bold(colors.cyan('RippleX'))} ${colors.dim('🌊')}\n\n${colors.white('Local:')} ${colors.green(`http://localhost:${PORT}`)}\n${colors.white('Mode:')} ${modeBadge}\n`;

	const pagesLines = [];
	pagesLines.push(colors.bold('Pages'));
	if (routesManifest.pages.length === 0) {
		pagesLines.push(`${bullet} ${colors.gray('(none)')}`);
	} else {
		routesManifest.pages.forEach((r, i) => {
			const isLast = i === routesManifest.pages.length - 1;
			const isDynamic = r.path.includes(':');
			const tag = isDynamic ? colors.gray('[dynamic]') : colors.gray('[static]');
			pagesLines.push(`${isLast ? bullet : branch} ${colors.white(r.path)} ${colors.dim(tag)}`);
		});
	}

	const apiLines = [];
	apiLines.push(colors.bold('API Routes'));
	if (routesManifest.api.length === 0) {
		apiLines.push(`${bullet} ${colors.gray('(none)')}`);
	} else {
		routesManifest.api.forEach((r, i) => {
			const isLast = i === routesManifest.api.length - 1;
			apiLines.push(`${isLast ? bullet : branch} ${colors.white(r.path)}`);
		});
	}

	console.log(header + '\n' + pagesLines.join('\n') + '\n\n' + apiLines.join('\n') + '\n');
});
