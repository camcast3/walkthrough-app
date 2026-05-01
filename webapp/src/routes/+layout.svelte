<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(async () => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch(() => {
				// SW registration is best-effort; app works without it
			});
		}

		// In client mode (e.g. ROG Ally) disable expensive GPU effects to save battery
		try {
			const res = await fetch('/api/config');
			if (res.ok) {
				const config = await res.json();
				if (config.appMode === 'client') {
					document.body.setAttribute('data-power-save', '');
				}
			}
		} catch {
			// Offline or unavailable — default to power-save to be safe
			document.body.setAttribute('data-power-save', '');
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#0a0a14" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

{@render children()}

<style>
	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: system-ui, -apple-system, sans-serif;
		background: #0a0a14;
		color: #e8e8f0;
		min-height: 100dvh;
		overflow-x: hidden;
		position: relative;
	}

	/* Gradient mesh background — animated by default, static in power-save mode */
	:global(body)::before {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(ellipse 80% 60% at 20% 20%, rgba(124,106,247,0.08) 0%, transparent 60%),
			radial-gradient(ellipse 60% 80% at 80% 80%, rgba(84,214,106,0.05) 0%, transparent 50%),
			radial-gradient(ellipse 70% 50% at 60% 10%, rgba(238,90,90,0.04) 0%, transparent 50%);
		animation: meshShift 20s ease-in-out infinite alternate;
	}

	:global(body[data-power-save])::before {
		animation: none;
	}

	@keyframes meshShift {
		0% {
			background:
				radial-gradient(ellipse 80% 60% at 20% 20%, rgba(124,106,247,0.08) 0%, transparent 60%),
				radial-gradient(ellipse 60% 80% at 80% 80%, rgba(84,214,106,0.05) 0%, transparent 50%),
				radial-gradient(ellipse 70% 50% at 60% 10%, rgba(238,90,90,0.04) 0%, transparent 50%);
		}
		100% {
			background:
				radial-gradient(ellipse 80% 60% at 40% 40%, rgba(124,106,247,0.06) 0%, transparent 60%),
				radial-gradient(ellipse 60% 80% at 60% 60%, rgba(84,214,106,0.07) 0%, transparent 50%),
				radial-gradient(ellipse 70% 50% at 30% 80%, rgba(238,90,90,0.05) 0%, transparent 50%);
		}
	}

	/* Heading font */
	:global(h1, h2, h3) {
		font-family: 'Rajdhani', system-ui, sans-serif;
		letter-spacing: 0.5px;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
	}

	:global(:focus-visible) {
		outline: 3px solid #7c6af7;
		outline-offset: 2px;
		border-radius: 4px;
		box-shadow: 0 0 12px rgba(124,106,247,0.4);
	}

	/* Respect reduced motion */
	@media (prefers-reduced-motion: reduce) {
		:global(body)::before {
			animation: none;
		}
		:global(*) {
			animation-duration: 0.01ms !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>

