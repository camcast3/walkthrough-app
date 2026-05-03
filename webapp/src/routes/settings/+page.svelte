<script lang="ts">
	import type { PageData } from './$types.js';
	import { updateClientConfig } from '$lib/sync.js';
	import { onMount, onDestroy, tick } from 'svelte';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import GamepadHintBar from '$lib/GamepadHintBar.svelte';

	let { data }: { data: PageData } = $props();

	// Form field values — initialised from server-loaded data
	let serverUrl = $state(data.serverUrl);
	let refreshInterval = $state(data.refreshInterval);
	let syncInterval = $state(data.syncInterval);
	let cacheDir = $state(data.cacheDir);
	let powerSaverMode = $state(data.powerSaverMode);

	// Form state
	let saving = $state(false);
	let saved = $state(false);
	let saveError = $state('');
	let validationErrors = $state<Record<string, string>>({});

	// Gamepad / keyboard focus management
	const FIELD_COUNT = 6; // 4 inputs + 1 PSM toggle + 1 save button
	let focusedIdx = $state(0);
	let fieldRefs: (HTMLElement | null)[] = Array(FIELD_COUNT).fill(null);
	let gamepad: GamepadNavigator | null = null;

	onMount(() => {
		gamepad = new GamepadNavigator(handleGamepadAction);
		gamepad.start();
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		gamepad?.stop();
		window.removeEventListener('keydown', handleKeydown);
	});

	function setFieldRef(el: HTMLElement, idx: number) {
		fieldRefs[idx] = el;
		return {
			update(newIdx: number) {
				fieldRefs[newIdx] = el;
			},
			destroy() {}
		};
	}

	function focusField(idx: number) {
		focusedIdx = idx;
		tick().then(() => {
			fieldRefs[focusedIdx]?.focus();
		});
	}

	function handleGamepadAction(action: string) {
		switch (action) {
			case 'focus-up':
				focusField(Math.max(0, focusedIdx - 1));
				break;
			case 'focus-down':
				focusField(Math.min(FIELD_COUNT - 1, focusedIdx + 1));
				break;
			case 'check':
				if (focusedIdx === FIELD_COUNT - 1) {
					// Save button
					fieldRefs[focusedIdx]?.click();
				} else if (focusedIdx === 4) {
					// PSM toggle
					powerSaverMode = !powerSaverMode;
				} else {
					fieldRefs[focusedIdx]?.focus();
				}
				break;
			case 'back':
				window.location.href = '/';
				break;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			handleGamepadAction('focus-up');
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			handleGamepadAction('focus-down');
		}
	}

	// ── Validation ────────────────────────────────────────────────────────────

	function validateDuration(s: string, minSec: number, maxSec: number): string | null {
		if (!s) return null;
		// Accept Go duration strings: e.g. "10m", "1h30m", "30s", "1h"
		// Each unit group requires at least one digit before the unit letter.
		const match = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/);
		if (!match) return 'Invalid format (e.g. 10m, 1h, 30s)';
		const h = parseInt(match[1] ?? '0');
		const m = parseInt(match[2] ?? '0');
		const sec = parseInt(match[3] ?? '0');
		const ms = parseInt(match[4] ?? '0');
		const totalSec = h * 3600 + m * 60 + sec + ms / 1000;
		if (totalSec === 0) return 'Invalid format (e.g. 10m, 1h, 30s)';
		if (totalSec < minSec)
			return `Must be at least ${minSec >= 60 ? minSec / 60 + 'm' : minSec + 's'}`;
		if (totalSec > maxSec)
			return `Must be at most ${maxSec >= 3600 ? maxSec / 3600 + 'h' : maxSec / 60 + 'm'}`;
		return null;
	}

	function validate(): boolean {
		const errors: Record<string, string> = {};

		if (serverUrl && !serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
			errors.serverUrl = 'Must start with http:// or https://';
		}

		const refreshErr = validateDuration(refreshInterval, 60, 86400); // 1m – 24h
		if (refreshErr) errors.refreshInterval = refreshErr;

		const syncErr = validateDuration(syncInterval, 10, 3600); // 10s – 1h
		if (syncErr) errors.syncInterval = syncErr;

		validationErrors = errors;
		return Object.keys(errors).length === 0;
	}

	async function handleSave(e?: SubmitEvent) {
		e?.preventDefault();
		if (!validate()) return;

		saving = true;
		saveError = '';
		saved = false;

		try {
			const result = await updateClientConfig({
				serverUrl: serverUrl || undefined,
				refreshInterval: refreshInterval || undefined,
				syncInterval: syncInterval || undefined,
				cacheDir: cacheDir || undefined,
				powerSaverMode
			});
			// Surface any persistence warnings (settings applied but may not survive restart)
			if (result.persistWarnings && result.persistWarnings.length > 0) {
				saveError = '⚠ Settings applied but could not be persisted: ' + result.persistWarnings.join('; ');
			} else {
				saved = true;
				setTimeout(() => {
					saved = false;
				}, 3000);
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save settings';
		} finally {
			saving = false;
		}
	}

	const settingsHints = [
		{ badge: '↕', label: 'Navigate' },
		{ badge: 'A', label: 'Select' },
		{ badge: 'B', label: 'Back' }
	];
</script>

<svelte:head>
	<title>Settings — Walkthrough Checklist</title>
</svelte:head>

<div class="page">
	<header class="hero">
		<a href="/" class="back-link" aria-label="Back to walkthroughs">← Back</a>
		<div class="hero-icon" aria-hidden="true">⚙️</div>
		<h1 class="hero-title">Settings</h1>
		<p class="subtitle">Runtime configuration for client mode</p>
	</header>

	{#if data.appMode !== 'client'}
		<div class="banner warning" role="alert">
			<span>⚠ Settings are only configurable in client mode.</span>
		</div>
	{:else}
		<form class="settings-form" onsubmit={handleSave} novalidate>
			<!-- Server URL -->
			<div class="field" class:field-error={!!validationErrors.serverUrl}>
				<label class="field-label" for="serverUrl">
					<span class="label-icon" aria-hidden="true">📡</span>
					Server URL
				</label>
				<p class="field-desc">URL of the walkthrough server to sync from.</p>
				<input
					id="serverUrl"
					class="field-input"
					class:focused={focusedIdx === 0}
					type="url"
					placeholder="http://walkthroughs.local"
					bind:value={serverUrl}
					disabled={saving}
					autocomplete="off"
					spellcheck={false}
					onfocus={() => (focusedIdx = 0)}
					use:setFieldRef={0}
				/>
				{#if validationErrors.serverUrl}
					<span class="field-error-msg" role="alert">{validationErrors.serverUrl}</span>
				{/if}
			</div>

			<!-- Refresh Interval -->
			<div class="field" class:field-error={!!validationErrors.refreshInterval}>
				<label class="field-label" for="refreshInterval">
					<span class="label-icon" aria-hidden="true">🔄</span>
					Refresh Interval
				</label>
				<p class="field-desc">
					How often to re-fetch walkthroughs from the server. Range: 1m – 24h.
				</p>
				<input
					id="refreshInterval"
					class="field-input"
					class:focused={focusedIdx === 1}
					type="text"
					placeholder="10m"
					bind:value={refreshInterval}
					disabled={saving}
					autocomplete="off"
					spellcheck={false}
					onfocus={() => (focusedIdx = 1)}
					use:setFieldRef={1}
				/>
				{#if validationErrors.refreshInterval}
					<span class="field-error-msg" role="alert">{validationErrors.refreshInterval}</span>
				{/if}
			</div>

			<!-- Sync Interval -->
			<div class="field" class:field-error={!!validationErrors.syncInterval}>
				<label class="field-label" for="syncInterval">
					<span class="label-icon" aria-hidden="true">⬆️</span>
					Progress Sync Interval
				</label>
				<p class="field-desc">
					How often to push progress changes to the server. Range: 10s – 1h.
				</p>
				<input
					id="syncInterval"
					class="field-input"
					class:focused={focusedIdx === 2}
					type="text"
					placeholder="30s"
					bind:value={syncInterval}
					disabled={saving}
					autocomplete="off"
					spellcheck={false}
					onfocus={() => (focusedIdx = 2)}
					use:setFieldRef={2}
				/>
				{#if validationErrors.syncInterval}
					<span class="field-error-msg" role="alert">{validationErrors.syncInterval}</span>
				{/if}
			</div>

			<!-- Cache Directory -->
			<div class="field" class:field-error={!!validationErrors.cacheDir}>
				<label class="field-label" for="cacheDir">
					<span class="label-icon" aria-hidden="true">💾</span>
					Cache Directory
				</label>
				<p class="field-desc">Local directory for caching walkthrough data.</p>
				<input
					id="cacheDir"
					class="field-input"
					class:focused={focusedIdx === 3}
					type="text"
					placeholder="/data"
					bind:value={cacheDir}
					disabled={saving}
					autocomplete="off"
					spellcheck={false}
					onfocus={() => (focusedIdx = 3)}
					use:setFieldRef={3}
				/>
				{#if validationErrors.cacheDir}
					<span class="field-error-msg" role="alert">{validationErrors.cacheDir}</span>
				{/if}
			</div>

			<!-- Power Saver Mode -->
			<div class="field">
				<div class="field-label-row">
					<label class="field-label" for="powerSaverMode">
						<span class="label-icon" aria-hidden="true">🔋</span>
						Power Saver Mode
					</label>
					<button
						id="powerSaverMode"
						role="switch"
						aria-checked={powerSaverMode}
						class="toggle-btn"
						class:on={powerSaverMode}
						class:focused={focusedIdx === 4}
						type="button"
						disabled={saving}
						onclick={() => (powerSaverMode = !powerSaverMode)}
						onfocus={() => (focusedIdx = 4)}
						use:setFieldRef={4}
					>
						<span class="toggle-track">
							<span class="toggle-thumb"></span>
						</span>
						<span class="toggle-label">{powerSaverMode ? 'On' : 'Off'}</span>
					</button>
				</div>
				<p class="field-desc">
					Reduces refresh, sync, and connectivity probe frequency to conserve battery. No restart
					required.
				</p>
			</div>

			{#if saveError}
				<div class="banner warning" role="alert">
					<span>⚠ {saveError}</span>
				</div>
			{/if}

			{#if saved}
				<div class="banner success" role="status">
					<span>✓ Settings saved</span>
				</div>
			{/if}

			<div class="actions">
				<button
					class="save-btn"
					class:focused={focusedIdx === 5}
					type="submit"
					disabled={saving}
					onfocus={() => (focusedIdx = 5)}
					use:setFieldRef={5}
				>
					{#if saving}
						<span class="spinner" aria-hidden="true"></span>
						Saving…
					{:else}
						💾 Save Settings
					{/if}
				</button>
			</div>
		</form>
	{/if}
</div>

<GamepadHintBar hints={settingsHints} />

<style>
	.page {
		max-width: 680px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4.5rem;
	}

	.hero {
		text-align: center;
		padding: 2rem 0 1.75rem;
		position: relative;
	}

	.back-link {
		position: absolute;
		left: 0;
		top: 2rem;
		font-size: 0.9rem;
		color: #7c6af7;
		opacity: 0.8;
		transition: opacity 0.15s;
	}
	.back-link:hover {
		opacity: 1;
	}

	.hero-icon {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
		filter: drop-shadow(0 0 10px rgba(124, 106, 247, 0.35));
	}

	.hero-title {
		font-size: 2.1rem;
		font-weight: 700;
		background: linear-gradient(135deg, #a89df7 0%, #7c6af7 40%, #54d66a 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		margin-top: 0.4rem;
		color: #6a6a8a;
		font-size: 0.9rem;
	}

	.banner {
		border-radius: 12px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.banner.warning {
		background: rgba(255, 180, 0, 0.08);
		border: 1px solid rgba(255, 180, 0, 0.25);
		color: #ffd060;
	}

	.banner.success {
		background: rgba(84, 214, 106, 0.08);
		border: 1px solid rgba(84, 214, 106, 0.25);
		color: #54d66a;
	}

	/* ── Settings form ─────────────────────────────────────────────────────── */
	.settings-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.field {
		background: rgba(20, 20, 36, 0.7);
		border: 1px solid rgba(124, 106, 247, 0.12);
		border-radius: 16px;
		padding: 1.1rem 1.25rem;
		transition: border-color 0.2s;
	}

	.field:focus-within {
		border-color: rgba(124, 106, 247, 0.4);
	}

	.field.field-error {
		border-color: rgba(220, 60, 60, 0.4);
	}

	.field-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: #c8c0f8;
		margin-bottom: 0.3rem;
		cursor: pointer;
	}

	.label-icon {
		font-size: 1rem;
	}

	.field-desc {
		font-size: 0.8rem;
		color: #6a6a8a;
		margin-bottom: 0.65rem;
	}

	/* ── Power Saver toggle ─────────────────────────────────────────────────── */
	.field-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.3rem;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0;
		color: #8888aa;
		transition: color 0.2s;
	}

	.toggle-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.toggle-track {
		position: relative;
		display: flex;
		align-items: center;
		width: 2.5rem;
		height: 1.25rem;
		border-radius: 0.625rem;
		background: rgba(42, 42, 68, 0.8);
		border: 1px solid rgba(124, 106, 247, 0.2);
		transition: background 0.2s, border-color 0.2s;
	}

	.toggle-btn.on .toggle-track {
		background: rgba(84, 214, 106, 0.18);
		border-color: rgba(84, 214, 106, 0.5);
	}

	.toggle-thumb {
		position: absolute;
		left: 0.125rem;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		background: #55556a;
		transition: transform 0.2s, background 0.2s;
	}

	.toggle-btn.on .toggle-thumb {
		transform: translateX(1.25rem);
		background: #54d66a;
	}

	.toggle-label {
		font-size: 0.85rem;
		font-weight: 600;
		min-width: 1.75rem;
	}

	.toggle-btn.focused .toggle-track,
	.toggle-btn:focus-visible .toggle-track {
		outline: 3px solid rgba(124, 106, 247, 0.4);
		outline-offset: 2px;
	}

	.toggle-btn:focus-visible {
		outline: none;
	}

	.field-input {
		width: 100%;
		background: rgba(10, 10, 20, 0.5);
		border: 1px solid rgba(124, 106, 247, 0.18);
		border-radius: 10px;
		color: #e8e8f0;
		font-size: 0.9rem;
		font-family: 'Courier New', monospace;
		padding: 0.6rem 0.9rem;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.field-input::placeholder {
		color: #3a3a5c;
	}

	.field-input:focus,
	.field-input.focused {
		outline: none;
		border-color: rgba(124, 106, 247, 0.5);
		box-shadow: 0 0 0 2px rgba(124, 106, 247, 0.12);
	}

	.field-input:disabled {
		opacity: 0.5;
	}

	.field-error-msg {
		display: block;
		margin-top: 0.4rem;
		font-size: 0.78rem;
		color: #e05555;
	}

	/* ── Actions ───────────────────────────────────────────────────────────── */
	.actions {
		display: flex;
		justify-content: flex-end;
	}

	.save-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(124, 106, 247, 0.18);
		border: 1px solid rgba(124, 106, 247, 0.45);
		border-radius: 12px;
		color: #c8c0f8;
		font-size: 0.95rem;
		font-weight: 600;
		padding: 0.65rem 1.5rem;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
	}

	.save-btn:hover:not(:disabled),
	.save-btn.focused:not(:disabled) {
		background: rgba(124, 106, 247, 0.28);
		border-color: rgba(124, 106, 247, 0.7);
		box-shadow: 0 0 16px rgba(124, 106, 247, 0.2);
	}

	.save-btn:focus-visible {
		outline: none;
		border-color: rgba(124, 106, 247, 0.7);
		box-shadow: 0 0 0 3px rgba(124, 106, 247, 0.3);
	}

	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Spinner ───────────────────────────────────────────────────────────── */
	.spinner {
		display: inline-block;
		width: 0.85rem;
		height: 0.85rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
