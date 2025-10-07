#!/usr/bin/env node
import { build as viteBuild, loadConfigFromFile } from 'vite';
import { build as esbuild } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import colors from 'colors';
import { ripplePlugin } from './esbuild-plugin-ripple.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.cwd());
const DIST = path.join(ROOT, 'dist');

// Load user's vite config
const configFile = await loadConfigFromFile(
	{ command: 'build', mode: 'production' },
	undefined,
	ROOT
);

async function main() {
	console.log(colors.cyan('Building RippleX project...\n'));

	// Clean dist directory
	if (fs.existsSync(DIST)) {
		fs.rmSync(DIST, { recursive: true });
	}
	fs.mkdirSync(DIST, { recursive: true });

	// Step 1: Build client bundle with esbuild
	console.log(colors.white('1. Building client bundle...'));

	const PKG_ROOT = path.resolve(__dirname, '..');
	const clientEntry = createClientEntry(ROOT);

	try {
		const result = await esbuild({
			entryPoints: [clientEntry],
			bundle: true,
			platform: 'browser',
			format: 'esm',
			target: 'es2020',
			outfile: path.join(DIST, 'client', 'assets', 'client.js'),
			external: [],
			plugins: [ripplePlugin({ mode: 'dom' })],
			minify: true,
			sourcemap: false,
			metafile: true,
			logLevel: 'warning'
		});

		// Calculate client bundle size
		const clientBundlePath = path.join(DIST, 'client', 'assets', 'client.js');
		const clientStats = fs.statSync(clientBundlePath);
		const clientSizeKB = (clientStats.size / 1024).toFixed(2);

		console.log(colors.green(`✓ Client bundle built ${colors.dim(`(${clientSizeKB} KB)`)}\n`));
	} finally {
		if (fs.existsSync(clientEntry)) {
			fs.unlinkSync(clientEntry);
		}
	}

	// Step 2: Build SSR bundle with esbuild and Ripple plugin
	console.log(colors.white('2. Building SSR bundle...'));

	// Create a server entry point that imports all pages
	const serverEntry = createServerEntry(ROOT);

	try {
		const result = await esbuild({
			entryPoints: [serverEntry],
			bundle: true,
			platform: 'node',
			format: 'esm',
			target: 'node18',
			outfile: path.join(DIST, 'server', 'index.js'),
			external: ['ripple', 'ripple/server', 'polka', 'sirv', 'colors', 'vite'],
			plugins: [ripplePlugin({ mode: 'server' })],
			minify: true,
			sourcemap: false,
			metafile: true,
			logLevel: 'warning'
		});

		// Calculate SSR bundle size
		const ssrBundlePath = path.join(DIST, 'server', 'index.js');
		const ssrStats = fs.statSync(ssrBundlePath);
		const ssrSizeKB = (ssrStats.size / 1024).toFixed(2);

		console.log(colors.green(`✓ SSR bundle built ${colors.dim(`(${ssrSizeKB} KB)`)}\n`));
	} finally {
		// Clean up temp entry file
		if (fs.existsSync(serverEntry)) {
			fs.unlinkSync(serverEntry);
		}
	}

	// Create HTML template (store in server dir, not client dir to avoid static serving)
	const htmlTemplate = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>RippleX</title>
		<link rel="stylesheet" href="/global.css">
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="/assets/client.js"></script>
	</body>
</html>`;
	fs.writeFileSync(path.join(DIST, 'server', 'index.html'), htmlTemplate);

	// Step 3: Copy public directory to dist/client
	console.log(colors.white('3. Copying public assets...'));
	const publicDir = path.join(ROOT, 'public');
	if (fs.existsSync(publicDir)) {
		copy(publicDir, path.join(DIST, 'client'));
		console.log(colors.green('✓ Public assets copied\n'));
	} else {
		console.log(colors.gray('  No public directory found\n'));
	}

	// Step 4: Production server is ready (no need to copy, CLI will use it from ripplex package)
	console.log(colors.white('4. Setting up production server...'));
	console.log(colors.green('✓ Production server ready\n'));

	// Step 5: Copy necessary runtime files
	console.log(colors.white('5. Copying runtime files...'));
	const toCopy = ['api', 'middleware.js'];
	for (const item of toCopy) {
		const srcPath = path.join(ROOT, item);
		if (!fs.existsSync(srcPath)) continue;
		const destPath = path.join(DIST, item);
		if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
			copy(srcPath, destPath);
		} else if (fs.existsSync(srcPath)) {
			fs.copyFileSync(srcPath, destPath);
		}
	}
	console.log(colors.green('✓ Runtime files copied\n'));

	// Step 5: Create route manifest
	console.log(colors.white('5. Creating route manifest...'));
	const routes = {
		pages: getPageRoutes(ROOT),
		api: getApiRoutes(ROOT)
	};
	fs.writeFileSync(
		path.join(DIST, 'routes.json'),
		JSON.stringify(routes, null, 2)
	);
	console.log(colors.green('✓ Route manifest created\n'));

	console.log(colors.bold.green('✓ Build complete!\n'));
	console.log(colors.white('Run'), colors.cyan('ripplex start'), colors.white('to start the production server.'));
}

function createClientEntry(root) {
	const pagesDir = path.join(root, 'pages');
	const entries = [];

	function scanDirectory(dir, prefix = '') {
		if (!fs.existsSync(dir)) return;
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				scanDirectory(fullPath, `${prefix}/${file}`);
			} else if (file.endsWith('.ripple')) {
				const relativePath = path.relative(root, fullPath);
				entries.push(relativePath);
			}
		}
	}

	scanDirectory(pagesDir);

	// Create temporary client entry file
	const entryPath = path.join(root, '.ripplex-client-entry.js');
	const imports = entries.map((e, i) => `import * as page${i} from './${e}';`).join('\n');
	const registry = entries.map((e, i) => `  '${e}': page${i}.default || page${i}`).join(',\n');

	const clientCode = `${imports}

import { mount } from 'ripple';

// Page components registry
const pages = {
${registry}
};

// Client-side hydration
let currentComponent = null;

async function hydrate() {
	const rippleData = window.__RIPPLE;
	if (!rippleData?.routePath) {
		console.error('No routePath found in window.__RIPPLE');
		return;
	}

	// Convert routePath to pages/ path
	const pagePath = rippleData.routePath.startsWith('/')
		? rippleData.routePath.slice(1)
		: rippleData.routePath;

	const Component = pages[pagePath];
	if (!Component) {
		console.error('Component not found for:', pagePath);
		return;
	}

	currentComponent = mount(Component, {
		props: rippleData.routeProps,
		target: document.getElementById('root'),
		hydrate: true
	});
}

// Run hydration when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', hydrate);
} else {
	hydrate();
}
`;

	fs.writeFileSync(entryPath, clientCode);
	return entryPath;
}

function createServerEntry(root) {
	const pagesDir = path.join(root, 'pages');
	const entries = [];

	function scanDirectory(dir, prefix = '') {
		if (!fs.existsSync(dir)) return;
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				scanDirectory(fullPath, `${prefix}/${file}`);
			} else if (file.endsWith('.ripple')) {
				const relativePath = path.relative(root, fullPath);
				entries.push(relativePath);
			}
		}
	}

	scanDirectory(pagesDir);

	// Create temporary entry file that imports all pages
	const entryPath = path.join(root, '.ripplex-server-entry.js');
	const imports = entries.map((e, i) => `import * as page${i} from './${e}';`).join('\n');
	const exports = entries.map((e, i) => `  '${e}': page${i}`).join(',\n');

	fs.writeFileSync(entryPath, `${imports}\n\nexport default {\n${exports}\n};\n`);

	return entryPath;
}

function getPageRoutes(root) {
	const pagesDir = path.join(root, 'pages');
	const routes = [];

	function scanDirectory(dir, prefix = '') {
		if (!fs.existsSync(dir)) return;
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				scanDirectory(fullPath, `${prefix}/${file}`);
			} else if (file.endsWith('.ripple')) {
				let routePath = prefix + '/' + file.replace('.ripple', '');

				if (file === 'index.ripple') {
					routePath = prefix || '/';
				}

				routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');
				const relativePath = path.relative(root, fullPath);

				routes.push({
					path: routePath,
					file: relativePath
				});
			}
		}
	}

	scanDirectory(pagesDir);
	return routes;
}

function getApiRoutes(root) {
	const apiDir = path.join(root, 'api');
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
				routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1');
				const relativePath = path.relative(root, fullPath);

				routes.push({
					path: routePath,
					file: relativePath
				});
			}
		}
	}

	scanDirectory(apiDir);
	return routes;
}

function copy(src, dest) {
	const stat = fs.statSync(src);
	if (stat.isDirectory()) {
		fs.mkdirSync(dest, { recursive: true });
		for (const entry of fs.readdirSync(src)) {
			copy(path.join(src, entry), path.join(dest, entry));
		}
	} else {
		fs.copyFileSync(src, dest);
	}
}

main().catch((err) => {
	console.error(colors.red('Build failed:'), err);
	process.exit(1);
});
