#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.cwd());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

function run(cmd, args, env = {}) {
	const child = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
	child.on('exit', code => process.exit(code ?? 0));
}

function parseArgs(argv) {
	const out = { cmd: 'dev', port: undefined };
	const rest = argv.slice(2);
	if (rest[0]) out.cmd = rest[0];
	for (let i = 1; i < rest.length; i++) {
		const a = rest[i];
		if (a === '--port' || a === '-p') { out.port = rest[i + 1]; i++; }
	}
	return out;
}

const { cmd, port } = parseArgs(process.argv);

if (cmd === 'dev') {
	const env = { NODE_ENV: 'development' };
	if (port) env.PORT = port;
	run('node', [path.join(PKG_ROOT, 'scripts', 'server.js')], env);
} else if (cmd === 'build') {
	run('node', [path.join(PKG_ROOT, 'scripts', 'build.js')]);
} else if (cmd === 'start') {
	// Check if dist directory exists
	const distDir = path.join(ROOT, 'dist');
	if (!fs.existsSync(distDir)) {
		console.error('Error: dist directory not found. Run "ripplex build" first.');
		process.exit(1);
	}
	// Run production server from ripplex package
	const serverPath = path.join(PKG_ROOT, 'scripts', 'prod-server.js');
	const env = { NODE_ENV: 'production' };
	if (port) env.PORT = port;
	run('node', [serverPath], env);
} else {
	console.error(`Unknown command: ${cmd}\nUsage: ripplex <dev|build|start> [--port <number>]`);
	process.exit(1);
}


