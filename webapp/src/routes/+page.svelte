<script lang="ts">
	import type { PageData } from './$types.js';
	import { countCheckableSteps, computeProgress, loadProgress, formatHours, HLTB_MODE_LABELS, HLTB_MODE_FULL_TITLES } from '$lib/state.js';
	import { checkout, checkin } from '$lib/sync.js';
	import { onMount, onDestroy, tick } from 'svelte';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import GamepadHintBar from '$lib/GamepadHintBar.svelte';

	let { data }: { data: PageData } = $props();

	// Per-walkthrough progress percentages loaded from IndexedDB
	let progressMap = $state<Record<string, number>>({});
	let loaded = $state(false);

	// Checkout state — mutable local copy so toggling updates immediately
	let checkedOutSet = $state<Set<string>>(new Set(data.checkedOutIds));
	// Track which walkthroughs are currently loading a checkout/checkin action
	let checkoutPending = $state<Set<string>>(new Set());

	onMount(async () => {
		const results: Record<string, number> = {};
		for (const wt of data.walkthroughs) {
			const record = await loadProgress(wt.id);
			if (record) {
				results[wt.id] = record.checkedSteps.length;
			}
		}
		progressMap = results;
		loaded = true;

		gamepad = new GamepadNavigator(handleGamepadAction);
		gamepad.start();
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		gamepad?.stop();
		window.removeEventListener('keydown', handleKeydown);
	});

	async function toggleCheckout(event: MouseEvent, id: string) {
		event.preventDefault();
		event.stopPropagation();
		if (checkoutPending.has(id)) return;

		checkoutPending = new Set([...checkoutPending, id]);
		try {
			if (checkedOutSet.has(id)) {
				await checkin(id);
				checkedOutSet = new Set([...checkedOutSet].filter((x) => x !== id));
			} else {
				await checkout(id);
				checkedOutSet = new Set([...checkedOutSet, id]);
			}
		} catch {
			// Action failed — state reverts (no optimistic update committed)
		} finally {
			checkoutPending = new Set([...checkoutPending].filter((x) => x !== id));
		}
	}

	const STEP_TYPE_ICONS: Record<string, string> = {
		step: '✓',
		note: 'ℹ',
		warning: '⚠',
		collectible: '◆',
		boss: '☠'
	};
	void STEP_TYPE_ICONS;

	// ── Gamepad / keyboard navigation ─────────────────────────────────────────
	let focusedCardIdx = $state(0);
	let cardRefs: HTMLElement[] = [];
	let gamepad: GamepadNavigator | null = null;

	function cardAction(el: HTMLElement, idx: number) {
		cardRefs[idx] = el;
		return {
			update(newIdx: number) { cardRefs[newIdx] = el; },
			destroy() {}
		};
	}

	function focusCard(idx: number) {
		focusedCardIdx = idx;
		tick().then(() => {
			const el = cardRefs[focusedCardIdx];
			if (el) {
				el.focus({ preventScroll: true });
				el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		});
	}

	function handleGamepadAction(action: string) {
		const count = data.walkthroughs.length;
		if (count === 0) return;
		switch (action) {
			case 'focus-up':
				focusCard(Math.max(0, focusedCardIdx - 1));
				break;
			case 'focus-down':
				focusCard(Math.min(count - 1, focusedCardIdx + 1));
				break;
			case 'check':
				cardRefs[focusedCardIdx]?.click();
				break;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		const count = data.walkthroughs.length;
		if (count === 0) return;
		if (e.key === 'ArrowUp') { e.preventDefault(); handleGamepadAction('focus-up'); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); handleGamepadAction('focus-down'); }
		else if (e.key === 'Enter' || e.key === ' ') {
			// Only intercept if a card is focused via gamepad (not inside input elements)
			if (document.activeElement === cardRefs[focusedCardIdx]) {
				e.preventDefault();
				handleGamepadAction('check');
			}
		}
	}

	const listHints = [
		{ badge: '↕', label: 'Navigate' },
		{ badge: 'A', label: 'Open' }
	];
</script>

<svelte:head>
	<title>Walkthrough Checklist</title>
</svelte:head>

<div class="page">
	<header class="hero">
		<div class="hero-icon" aria-hidden="true">🎮</div>
		<h1 class="hero-title">Walkthroughs</h1>
		<p class="subtitle">Select a walkthrough to continue</p>
	</header>

	{#if data.error}
		<div class="banner warning" role="alert">
			<span>⚠ {data.error}</span>
		</div>
	{/if}

	{#if data.appMode === 'client'}
		<div class="banner info" role="note">
			<span aria-hidden="true">📡</span>
			<span> Connected to server — select <strong>⊕</strong> to download a walkthrough for offline use.</span>
			<a href="/settings" class="manage-link">⚙ Settings →</a>
		</div>
	{/if}

	{#if data.appMode === 'server'}
		<div class="banner server" role="note">
			<span aria-hidden="true">🗂️</span>
			<span> Running as library server. </span>
			<a href="/server" class="manage-link">Manage Library →</a>
		</div>
	{/if}

	{#if data.walkthroughs.length === 0}
		<div class="empty">
			<p>No walkthroughs available.</p>
			<p class="hint">Add one by running the Copilot walkthrough-ingest skill and committing the JSON to <code>/walkthroughs/</code>.</p>
		</div>
	{:else}
		<ul class="list" role="list">
			{#each data.walkthroughs as wt, idx (wt.id)}
				{@const checked = progressMap[wt.id] ?? 0}
				{@const isCheckedOut = checkedOutSet.has(wt.id)}
				{@const isPending = checkoutPending.has(wt.id)}
				<li class="card-wrapper" style="--delay: {idx * 60}ms" class:visible={loaded}>
					<a
						href="/{wt.id}"
						class="card"
						class:focused={idx === focusedCardIdx}
						aria-label="{wt.game} — {wt.title}"
						use:cardAction={idx}
					>
						<div class="card-body">
							<span class="game-name">{wt.game}</span>
							<span class="wt-title">{wt.title}</span>
							<span class="author">by {wt.author}</span>
							{#if wt.hltb?.main_story != null || wt.hltb?.main_story_sides != null || wt.hltb?.completionist != null}
								<span class="hltb-meta" aria-label="HowLongToBeat time estimates">
									⏱
									{#if wt.hltb.main_story != null}
										<span title="{HLTB_MODE_FULL_TITLES.main_story}">{formatHours(wt.hltb.main_story)}</span>
									{/if}
									{#if wt.hltb.main_story != null && wt.hltb.main_story_sides != null}
										<span class="hltb-sep">·</span>
									{/if}
									{#if wt.hltb.main_story_sides != null}
										<span title="{HLTB_MODE_FULL_TITLES.main_story_sides}">{formatHours(wt.hltb.main_story_sides)} {HLTB_MODE_LABELS.main_story_sides}</span>
									{/if}
									{#if (wt.hltb.main_story != null || wt.hltb.main_story_sides != null) && wt.hltb.completionist != null}
										<span class="hltb-sep">·</span>
									{/if}
									{#if wt.hltb.completionist != null}
										<span title="{HLTB_MODE_FULL_TITLES.completionist}">{formatHours(wt.hltb.completionist)} {HLTB_MODE_LABELS.completionist}</span>
									{/if}
								</span>
							{/if}
						</div>
						{#if checked > 0}
							<div class="progress-chip" aria-label="{checked} steps completed">
								<span class="chip-glow"></span>
								{checked} ✓
							</div>
						{/if}
						{#if data.appMode === 'client'}
							<button
								class="checkout-btn"
								class:checked-out={isCheckedOut}
								class:pending={isPending}
								aria-label={isCheckedOut ? 'Remove from device' : 'Download for offline use'}
								title={isCheckedOut ? 'Remove from device' : 'Download for offline use'}
								onclick={(e) => toggleCheckout(e, wt.id)}
								disabled={isPending}
							>
								{#if isPending}
									<span class="spinner" aria-hidden="true"></span>
								{:else if isCheckedOut}
									<span aria-hidden="true">✓</span>
								{:else}
									<span aria-hidden="true">⊕</span>
								{/if}
							</button>
						{/if}
						<span class="chevron" aria-hidden="true">›</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<GamepadHintBar hints={listHints} />

<style>
	.page {
		max-width: 700px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4.5rem;
	}

	.hero {
		text-align: center;
		padding: 2.5rem 0 2rem;
	}

	.hero-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
		filter: drop-shadow(0 0 12px rgba(124,106,247,0.4));
	}

	.hero-title {
		font-size: 2.4rem;
		font-weight: 700;
		background: linear-gradient(135deg, #a89df7 0%, #7c6af7 40%, #54d66a 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		margin-top: 0.5rem;
		color: #6a6a8a;
		font-size: 0.95rem;
		letter-spacing: 0.3px;
	}

	.banner {
		border-radius: 12px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		backdrop-filter: blur(8px);
	}

	:global(body[data-power-save]) .banner {
		backdrop-filter: none;
	}

	.banner.warning {
		background: rgba(255, 180, 0, 0.08);
		border: 1px solid rgba(255, 180, 0, 0.25);
		color: #ffd060;
	}

	.banner.info {
		background: rgba(84, 214, 106, 0.06);
		border: 1px solid rgba(84, 214, 106, 0.2);
		color: #80d490;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.banner.server {
		background: rgba(124, 106, 247, 0.07);
		border: 1px solid rgba(124, 106, 247, 0.22);
		color: #a89df7;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.manage-link {
		margin-left: auto;
		color: #c8c0f8;
		font-weight: 600;
		font-size: 0.88rem;
		text-decoration: underline;
		text-underline-offset: 2px;
		flex-shrink: 0;
	}
	.manage-link:hover {
		color: #ffffff;
	}

	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card-wrapper {
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease, transform 0.4s ease;
		transition-delay: var(--delay);
	}

	.card-wrapper.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(20, 20, 36, 0.7);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(124,106,247,0.12);
		border-radius: 16px;
		padding: 1.1rem 1rem 1.1rem 1.25rem;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	:global(body[data-power-save]) .card {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.card:hover,
	.card:focus-visible,
	.card.focused {
		border-color: rgba(124,106,247,0.5);
		background: rgba(26, 26, 50, 0.85);
		box-shadow: 0 0 20px rgba(124,106,247,0.12), inset 0 1px 0 rgba(255,255,255,0.03);
		transform: translateY(-1px);
	}

	.card:active {
		transform: scale(0.98);
	}

	.card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.game-name {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 1.15rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #f0f0ff;
	}

	.wt-title {
		font-size: 0.85rem;
		color: #8888aa;
	}

	.author {
		font-size: 0.78rem;
		color: #555577;
	}

	.hltb-meta {
		font-size: 0.75rem;
		color: #3d7a4a;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.1rem;
	}

	.hltb-sep {
		color: #3a3a5c;
	}

	.progress-chip {
		position: relative;
		background: rgba(124, 106, 247, 0.15);
		border: 1px solid rgba(124, 106, 247, 0.35);
		color: #a89df7;
		border-radius: 20px;
		padding: 0.25rem 0.7rem;
		font-size: 0.78rem;
		white-space: nowrap;
		flex-shrink: 0;
		overflow: hidden;
	}

	.chip-glow {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 8px rgba(124,106,247,0.3);
		pointer-events: none;
	}

	.chevron {
		color: #3a3a5c;
		font-size: 1.5rem;
		flex-shrink: 0;
		line-height: 1;
		transition: color 0.2s, transform 0.2s;
	}

	.card:hover .chevron {
		color: #7c6af7;
		transform: translateX(2px);
	}

	/* Checkout / checkin button */
	.checkout-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1px solid rgba(84, 214, 106, 0.3);
		background: rgba(84, 214, 106, 0.06);
		color: #54d66a;
		font-size: 1.1rem;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s, color 0.2s;
		-webkit-tap-highlight-color: transparent;
	}

	.checkout-btn:hover {
		background: rgba(84, 214, 106, 0.16);
		border-color: rgba(84, 214, 106, 0.6);
	}

	.checkout-btn.checked-out {
		background: rgba(84, 214, 106, 0.18);
		border-color: rgba(84, 214, 106, 0.5);
		color: #54d66a;
	}

	.checkout-btn.checked-out:hover {
		background: rgba(220, 60, 60, 0.12);
		border-color: rgba(220, 60, 60, 0.4);
		color: #e05555;
	}

	.checkout-btn.pending {
		opacity: 0.6;
		cursor: wait;
	}

	.spinner {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.empty {
		text-align: center;
		color: #555577;
		padding: 3rem 1rem;
	}

	.empty .hint {
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #444466;
	}

	.empty code {
		background: rgba(42, 42, 68, 0.6);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.82rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.card-wrapper {
			opacity: 1;
			transform: none;
			transition: none;
		}
	}
</style>

