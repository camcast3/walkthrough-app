<script lang="ts">
	import type { PageData } from './$types.js';
	import { updateClientConfig, fetchUpdateStatus, applyUpdate, waitForVersionChange } from '$lib/sync.js';
	import type { UpdateInfo } from '$lib/sync.js';
	import { onMount, onDestroy, tick } from 'svelte';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import GamepadHintBar from '$lib/GamepadHintBar.svelte';

	let { data }: { data: PageData } = $props();

	// Form field values — initialised from server-loaded data
	let serverUrl = $state(data.serverUrl);
	let refreshInterval = $state(data.refreshInterval);
	let syncInterval = $state(data.syncInterval);
	let cacheDir = $state(data.cacheDir);

	// Form state
	let saving = $state(false);
	let saved = $state(false);
	let saveError = $state('');
	let validationErrors = $state<Record<string, string>>({});

	// Update state
	let checking = $state(false);
	let checkError = $state('');
	let updateInfo = $state<UpdateInfo | null>(null);
	let updating = $state(false);
	let updateProgress = $state('');
	let updateError = $state('');

	// Dynamic field count: 4 inputs + save button + check button + (optional) apply button
	const BASE_FIELD_COUNT = 6; // indices 0-4 = form fields/save, 5 = check
	let fieldCount = $derived(
		data.appMode === 'client' && updateInfo?.updateAvailable && !updating
			? BASE_FIELD_COUNT + 1
			: BASE_FIELD_COUNT
	);

	// Gamepad / keyboard focus management
	let focusedIdx = $state(0);
	// Fixed size of 7: indices 0-3 = inputs, 4 = save, 5 = check-updates, 6 = apply-update.
	// Index 6 is only navigable when fieldCount reaches 7 (update available).
	let fieldRefs: (HTMLElement | null)[] = Array(7).fill(null);
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
				focusField(Math.min(fieldCount - 1, focusedIdx + 1));
				break;
			case 'check':
				if (focusedIdx >= 4) {
					// Save / check-updates / apply-update buttons
					fieldRefs[focusedIdx]?.click();
				} else {
					// Input fields — activate for text entry
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
				cacheDir: cacheDir || undefined
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

	// ── Update actions ────────────────────────────────────────────────────────

	async function handleCheckUpdate() {
		checking = true;
		checkError = '';
		updateInfo = null;
		try {
			updateInfo = await fetchUpdateStatus();
		} catch (err) {
			checkError = err instanceof Error ? err.message : 'Failed to check for updates';
		} finally {
			checking = false;
		}
	}

	async function handleApplyUpdate() {
		if (!updateInfo) return;
		updating = true;
		updateError = '';
		updateProgress = 'Sending update request…';
		try {
			await applyUpdate();
			updateProgress = 'Downloading update… this may take a minute';
			await waitForVersionChange(data.version || 'dev');
			updateProgress = 'Update complete! Reloading…';
			await new Promise((r) => setTimeout(r, 1500));
			window.location.reload();
		} catch (err) {
			updateError = err instanceof Error ? err.message : 'Update failed';
			updating = false;
			updateProgress = '';
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
					class:focused={focusedIdx === 4}
					type="submit"
					disabled={saving}
					onfocus={() => (focusedIdx = 4)}
					use:setFieldRef={4}
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

		<!-- ── Software Update ──────────────────────────────────────────────── -->
		<div class="field update-card">
			<div class="field-label">
				<span class="label-icon" aria-hidden="true">🔁</span>
				Software Update
			</div>
			<p class="field-desc">
				Current version: <code class="version-badge">{data.version || 'unknown'}</code>
			</p>

			{#if updateInfo}
				{#if updateInfo.updateAvailable}
					<div class="banner warning update-banner" role="status">
						<span>⬆ Version <strong>{updateInfo.latestVersion}</strong> available</span>
						<a
							class="release-link"
							href={updateInfo.releaseUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							Release notes ↗
						</a>
					</div>
				{:else}
					<div class="banner success" role="status">
						<span>✓ Up to date ({updateInfo.latestVersion})</span>
					</div>
				{/if}
			{/if}

			{#if updateError}
				<div class="banner warning" role="alert">
					<span>⚠ {updateError}</span>
				</div>
			{/if}

			{#if updating}
				<div class="banner info" role="status">
					<span class="spinner spinner-sm" aria-hidden="true"></span>
					<span>{updateProgress}</span>
				</div>
			{/if}

			<div class="update-actions">
				{#if updateInfo?.updateAvailable && !updating}
					<button
						class="update-btn apply-btn"
						class:focused={focusedIdx === 6}
						onclick={handleApplyUpdate}
						disabled={updating}
						onfocus={() => (focusedIdx = 6)}
						use:setFieldRef={6}
					>
						⬆ Update Now
					</button>
				{/if}
				<button
					class="update-btn check-btn"
					class:focused={focusedIdx === 5}
					onclick={handleCheckUpdate}
					disabled={checking || updating}
					onfocus={() => (focusedIdx = 5)}
					use:setFieldRef={5}
				>
					{#if checking}
						<span class="spinner spinner-sm" aria-hidden="true"></span>
						Checking…
					{:else}
						🔍 Check for Updates
					{/if}
				</button>
			</div>
		</div>
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
		z-index: 1;
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

	/* ── Update card ───────────────────────────────────────────────────────── */
	.update-card {
		margin-top: 0.5rem;
	}

	.update-card .field-label {
		cursor: default;
		margin-bottom: 0.4rem;
	}

	.version-badge {
		font-family: 'Courier New', monospace;
		font-size: 0.82rem;
		background: rgba(124, 106, 247, 0.1);
		border: 1px solid rgba(124, 106, 247, 0.2);
		border-radius: 6px;
		padding: 0.1rem 0.45rem;
		color: #c8c0f8;
	}

	.update-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.release-link {
		font-size: 0.78rem;
		color: #a89df7;
		text-decoration: underline;
		text-decoration-color: rgba(168, 157, 247, 0.4);
	}
	.release-link:hover {
		text-decoration-color: rgba(168, 157, 247, 0.9);
	}

	.banner.info {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: rgba(124, 106, 247, 0.08);
		border: 1px solid rgba(124, 106, 247, 0.2);
		color: #a89df7;
		margin-bottom: 0.75rem;
	}

	.spinner-sm {
		width: 0.75rem;
		height: 0.75rem;
		border-width: 2px;
		flex-shrink: 0;
	}

	.update-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.update-btn {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border-radius: 12px;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.6rem 1.25rem;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
	}

	.check-btn {
		background: rgba(124, 106, 247, 0.1);
		border: 1px solid rgba(124, 106, 247, 0.3);
		color: #a89df7;
	}

	.check-btn:hover:not(:disabled),
	.check-btn.focused:not(:disabled) {
		background: rgba(124, 106, 247, 0.2);
		border-color: rgba(124, 106, 247, 0.6);
		box-shadow: 0 0 14px rgba(124, 106, 247, 0.18);
	}

	.apply-btn {
		background: rgba(84, 214, 106, 0.12);
		border: 1px solid rgba(84, 214, 106, 0.4);
		color: #54d66a;
	}

	.apply-btn:hover:not(:disabled),
	.apply-btn.focused:not(:disabled) {
		background: rgba(84, 214, 106, 0.22);
		border-color: rgba(84, 214, 106, 0.7);
		box-shadow: 0 0 14px rgba(84, 214, 106, 0.18);
	}

	.update-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px rgba(124, 106, 247, 0.3);
	}

	.update-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
