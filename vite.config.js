import { defineConfig } from 'vite';
import { ripple } from 'vite-plugin-ripple';

export default defineConfig(({ mode }) => ({
	plugins: [ripple()],
	resolve: {
		conditions: ['browser']
	},
	assetsInclude: mode === 'production' ? ['**/*.ripple'] : false,
}));
