<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import GamepadHintBar from '$lib/GamepadHintBar.svelte';

	let gamepad: GamepadNavigator | null = null;

	function handleGamepadAction(action: string) {
		if (action === 'back' || action === 'check') {
			goto('/');
		} else if (action === 'settings') {
			goto('/settings');
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Backspace') {
			e.preventDefault();
			goto('/');
		}
	}

	onMount(() => {
		gamepad = new GamepadNavigator(handleGamepadAction);
		gamepad.start();
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		gamepad?.stop();
		window.removeEventListener('keydown', handleKeydown);
	});

	const errorHints = [
		{ badge: 'A', label: 'Home' },
		{ badge: 'B', label: 'Back' }
	];
</script>

<div class="error-page">
	<div class="error-icon" aria-hidden="true">⚠</div>
	<h1 class="error-title">{$page.status}</h1>
	<p class="error-message">{$page.error?.message ?? 'Something went wrong.'}</p>
	<a href="/" class="home-btn">← Back to walkthroughs</a>
</div>

<GamepadHintBar hints={errorHints} />

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 80dvh;
		text-align: center;
		padding: 2rem 1rem 4.5rem;
	}

	.error-icon {
		font-size: 3.5rem;
		margin-bottom: 1rem;
		filter: drop-shadow(0 0 12px rgba(238, 90, 90, 0.4));
	}

	.error-title {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 4rem;
		font-weight: 700;
		background: linear-gradient(135deg, #ee5a5a 0%, #ff9f43 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		line-height: 1.1;
	}

	.error-message {
		margin-top: 0.75rem;
		color: #8888aa;
		font-size: 1rem;
		max-width: 400px;
		line-height: 1.5;
	}

	.home-btn {
		margin-top: 2rem;
		display: inline-block;
		padding: 0.85rem 1.5rem;
		background: linear-gradient(135deg, #7c6af7, #6a58e5);
		color: #fff;
		border-radius: 12px;
		font-size: 0.95rem;
		font-weight: 600;
		transition: transform 0.15s, box-shadow 0.2s;
		box-shadow: 0 4px 16px rgba(124, 106, 247, 0.3);
	}

	.home-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(124, 106, 247, 0.4);
	}

	.home-btn:active {
		transform: scale(0.98);
	}
</style>
