import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
				runtimeCaching: [
					{
						urlPattern: /^.*\/api\/walkthroughs.*/,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'walkthroughs-cache',
							expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
						}
					}
				]
			},
			manifest: {
				name: 'Walkthrough Checklist',
				short_name: 'Walkthroughs',
				description: 'Offline-first game walkthrough checklists',
				theme_color: '#1a1a2e',
				background_color: '#1a1a2e',
				display: 'standalone',
				orientation: 'any',
				start_url: '/',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
				]
			}
		})
	]
});
