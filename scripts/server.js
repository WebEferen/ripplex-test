import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import polka from 'polka';
import sirv from 'sirv';
import { createServer as createViteServer } from 'vite';
import colors from 'colors';

// Startup timing
let middlewareLoadedNs = null;
let routesScannedNs = null;
let viteReadyNs = null;
let lastHmrStartNs = null;
let lastHmrFile = null;

const PORT = process.env.PORT || '5173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Always resolve to the user's current working directory (the project using ripplex)
const ROOT_DIR = process.cwd();

// Create Vite server
// Custom Vite logger to format HMR/reload messages with timings
/** @type {import('vite').Logger} */
const viteLogger = {
	info(...args) {
		const text = args.map(a => (typeof a === 'string' ? a : (a && a.message) || String(a))).join(' ');
		const lower = text.toLowerCase();
		const isHmr = /(hmr|hot|reload|updated|page reload|full reload|changed)/.test(lower);
		if (isHmr) return;
		console.log(text);
	},
	warn(...args) { console.warn(colors.yellow(args.map(String).join(' '))); },
	warnOnce(...args) { console.warn(colors.yellow(args.map(String).join(' '))); },
	error(...args) { console.error(colors.red(args.map(String).join(' '))); },
	clearScreen() { },
	hasErrorLogged: false,
	hasWarned: false
};

const vite = await createViteServer({
	server: { middlewareMode: true },
	appType: 'custom',
	root: ROOT_DIR,
	customLogger: viteLogger
});
viteReadyNs = process.hrtime.bigint();

vite.watcher.on('change', (file) => {
	lastHmrStartNs = process.hrtime.bigint();
	const relFile = '/' + path.relative(ROOT_DIR, file).split(path.sep).join('/');
	lastHmrFile = relFile;
	console.log(`${colors.green('UPDATE')} ${colors.gray(relFile)}`);
});

vite.watcher.on('add', (file) => {
	lastHmrStartNs = process.hrtime.bigint();
	const relFile = '/' + path.relative(ROOT_DIR, file).split(path.sep).join('/');
	lastHmrFile = relFile;
	console.log(`${colors.green('ADD')} ${colors.gray(relFile)}`);
});

vite.watcher.on('unlink', (file) => {
	lastHmrStartNs = process.hrtime.bigint();
	const relFile = '/' + path.relative(ROOT_DIR, file).split(path.sep).join('/');
	lastHmrFile = relFile;
	console.log(`${colors.green('REMOVE')} ${colors.gray(relFile)}`);
});

// Serve static files from public directory
const serveStatic = sirv(path.join(ROOT_DIR, 'public'), {
	dev: true,
	single: false,
});

// Optional page middleware (root-level middleware.js)
const MIDDLEWARE_PATH = path.join(ROOT_DIR, 'middleware.js');
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
middlewareLoadedNs = process.hrtime.bigint();

// File-based routing utilities
function getPageRoutes() {
	const pagesDir = path.join(ROOT_DIR, 'pages');
	const routes = [];

	function scanDirectory(dir, prefix = '') {
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				scanDirectory(fullPath, `${prefix}/${file}`);
			} else if (file.endsWith('.ripple')) {
				let routePath = prefix + '/' + file.replace('.ripple', '');

				// Convert index.ripple to /
				if (file === 'index.ripple') {
					routePath = prefix || '/';
				}

				// Convert [param].ripple to :param for polka
				routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');

				routes.push({
					path: routePath,
					filePath: fullPath
				});
			}
		}
	}

	scanDirectory(pagesDir);
	return routes;
}

// API routes utilities
function getApiRoutes() {
	const apiDir = path.join(ROOT_DIR, 'api');
	if (!fs.existsSync(apiDir)) return [];

	const routes = [];

	function scanDirectory(dir, prefix = '') {
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				scanDirectory(fullPath, `${prefix}/${file}`);
			} else if (file.endsWith('.js')) {
				let routePath = '/api' + prefix + '/' + file.replace('.js', '');

				// Convert [param].js to :param for polka
				routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');

				routes.push({
					path: routePath,
					filePath: fullPath
				});
			}
		}
	}

	scanDirectory(apiDir);
	return routes;
}

// Create the server
const app = polka();

// Serve static files
app.use(serveStatic);

// Use Vite middleware
app.use(vite.middlewares);

// Register API routes
const apiRoutes = getApiRoutes();
routesScannedNs = process.hrtime.bigint();
for (const route of apiRoutes) {
	app.get(route.path, async (req, res) => {
		try {
			const handler = await import(route.filePath);
			if (handler.default) {
				await handler.default(req, res);
			} else {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'No default export in API route' }));
			}
		} catch (error) {
			console.error('API route error:', error);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: error.message }));
		}
	});
}

// Register page routes
const pageRoutes = getPageRoutes();
for (const route of pageRoutes) {
	app.get(route.path, async (req, res) => {
		try {
			const reqStartNs = process.hrtime.bigint();
			const PACKAGE_ROOT = path.resolve(__dirname, '..');
			const cwdIndex = path.join(ROOT_DIR, 'index.html');
			const pkgIndex = path.join(PACKAGE_ROOT, 'index.html');
			const templatePath = fs.existsSync(cwdIndex) ? cwdIndex : pkgIndex;
			const template = fs.readFileSync(templatePath, 'utf-8');
			const transformedTemplate = await vite.transformIndexHtml(req.url, template);

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
			let head = '';
			let body = '';

			const clientRoutePath = '/' + path.relative(ROOT_DIR, route.filePath).split(path.sep).join('/');

			const { render } = await vite.ssrLoadModule('ripple/server');
			const module = await vite.ssrLoadModule(clientRoutePath);
			const Component = module.default || module[Object.keys(module)[0]];

			if (!Component) {
				throw new Error(`No component found in ${route.filePath}`);
			}

			const rendered = await render(Component, { props });
			head = rendered.head;
			body = rendered.body;

			const propsJson = JSON.stringify(props);
			const runtimeScript = `<script>window.__RIPPLE={routePath:${JSON.stringify(clientRoutePath)},routeProps:${propsJson}};<\/script>`;

			let html = transformedTemplate;
			// Inject SSR head just before </head>
			html = html.replace(/<\/head>/i, `${head}\n${runtimeScript}\n</head>`);
			// Inject SSR body into the #root element
			html = html.replace(/(<div\s+id="root"[^>]*>)([\s\S]*?)(<\/div>)/i, `$1${body}$3`);

			res.writeHead(200, { 'Content-Type': 'text/html' });
			const nowNs = process.hrtime.bigint();
			const deltaMs = Number((nowNs - reqStartNs) / 1000000n);
			const isDynamic = route.path.includes(':');
			console.log(`${colors.white(req.method)} ${colors.gray(req.url)} ${colors.white('→')} ${colors.gray(clientRoutePath)} ${colors.dim(`[${isDynamic ? 'dynamic' : 'static'}]`)} ${colors.dim(`+${deltaMs}ms`)}`);
			return res.end(html);
		} catch (error) {
			console.error('Page render error:', error);
			res.writeHead(500, { 'Content-Type': 'text/html' });
			res.end(`<h1>Error rendering page</h1><pre>${error.message}\n\n${error.stack}</pre>`);
		}
	});
}

// Start server
app.listen(PORT, () => {
	const bullet = colors.dim('└─');
	const branch = colors.dim('├─');

	const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
	const modeBadge = mode === 'production' ? colors.green(' Production ') : colors.gray(' Development ');
	const header = `\n${colors.bold(colors.cyan('RippleX'))} ${colors.dim('🌊')}\n\n${colors.white('Local:')} ${colors.green(`http://localhost:${PORT}`)}\n${colors.white('Mode:')} ${modeBadge}\n`;

	const pagesLines = [];
	pagesLines.push(colors.bold('Pages'));
	if (pageRoutes.length === 0) {
		pagesLines.push(`${bullet} ${colors.gray('(none)')}`);
	} else {
		pageRoutes.forEach((r, i) => {
			const isLast = i === pageRoutes.length - 1;
			const isDynamic = r.path.includes(':');
			const tag = isDynamic ? colors.gray('[dynamic]') : colors.gray('[static]');
			pagesLines.push(`${isLast ? bullet : branch} ${colors.white(r.path)} ${colors.dim(tag)}`);
		});
	}

	const apiLines = [];
	apiLines.push(colors.bold('API Routes'));
	if (apiRoutes.length === 0) {
		apiLines.push(`${bullet} ${colors.gray('(none)')}`);
	} else {
		apiRoutes.forEach((r, i) => {
			const isLast = i === apiRoutes.length - 1;
			apiLines.push(`${isLast ? bullet : branch} ${colors.white(r.path)}`);
		});
	}

	console.log(header + '\n' + pagesLines.join('\n') + '\n\n' + apiLines.join('\n') + '\n');
});
