#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { compile } from 'vite-plugin-ripple/compiler';

/**
 * Pre-compile all .ripple files to .js for bundling
 */
export async function compileRippleFiles(rootDir, outputDir) {
	const files = [];

	function findRippleFiles(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				findRippleFiles(fullPath);
			} else if (entry.name.endsWith('.ripple')) {
				files.push(fullPath);
			}
		}
	}

	// Find all .ripple files in pages and components
	const pagesDir = path.join(rootDir, 'pages');
	const componentsDir = path.join(rootDir, 'components');

	if (fs.existsSync(pagesDir)) findRippleFiles(pagesDir);
	if (fs.existsSync(componentsDir)) findRippleFiles(componentsDir);

	// Compile each file
	const compiledFiles = {};
	for (const filePath of files) {
		const relativePath = path.relative(rootDir, filePath);
		const source = fs.readFileSync(filePath, 'utf-8');

		try {
			// Use Ripple's compiler
			const result = await compile(source, {
				filename: relativePath,
				dev: false,
				generate: 'server' // Server-side code generation
			});

			// Save compiled JS
			const outputPath = path.join(outputDir, relativePath.replace('.ripple', '.js'));
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, result.js.code);

			compiledFiles[relativePath] = outputPath;
		} catch (error) {
			console.error(`Failed to compile ${relativePath}:`, error);
			throw error;
		}
	}

	return compiledFiles;
}
