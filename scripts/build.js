#!/usr/bin/env node
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DIST = path.join(ROOT, 'dist');

async function main() {
	if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);

	await build({
		entryPoints: ['server.js'],
		bundle: true,
		platform: 'node',
		target: 'node18',
		format: 'esm',
		outfile: path.join(DIST, 'server.js'),
		external: ['vite', 'sirv', 'polka', 'colors', 'vite-plugin-ripple', 'ripple']
	});

	const toCopy = ['index.html', 'public', 'pages', 'components', 'api', 'middleware.js', 'vite.config.js'];
	for (const item of toCopy) {
		const srcPath = path.join(ROOT, item);
		if (!fs.existsSync(srcPath)) continue;
		const destPath = path.join(DIST, item);
		copy(srcPath, destPath);
	}

	console.log('Built server to dist/. Use "pnpm start" to run.');
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
	console.error(err);
	process.exit(1);
});


