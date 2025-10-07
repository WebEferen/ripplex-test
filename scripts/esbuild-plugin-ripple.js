import { compile } from 'ripple/compiler';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Esbuild plugin for compiling .ripple files
 */
export function ripplePlugin(options = {}) {
	const mode = options.mode || 'server';

	return {
		name: 'esbuild-plugin-ripple',
		setup(build) {
			// Handle .ripple files
			build.onLoad({ filter: /\.ripple$/ }, async (args) => {
				try {
					const source = await fs.promises.readFile(args.path, 'utf8');
					const filename = path.basename(args.path);

					// Compile using Ripple's compiler with specified mode
					const result = compile(source, filename, { mode });

					return {
						contents: result.js.code,
						loader: 'js',
					};
				} catch (error) {
					return {
						errors: [{
							text: `Failed to compile Ripple file: ${error.message}`,
							detail: error
						}]
					};
				}
			});
		}
	};
}
