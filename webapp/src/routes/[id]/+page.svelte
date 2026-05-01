<script lang="ts">
	import type { PageData } from './$types.js';
	import { onMount, onDestroy, tick } from 'svelte';
	import { loadProgress, saveProgress, countCheckableSteps, computeProgress } from '$lib/state.js';
	import { syncProgress, timeAgo } from '$lib/sync.js';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import type { SyncStatus } from '$lib/types.js';

	let { data }: { data: PageData } = $props();
	const wt = $derived(data.walkthrough);

	// ── State ──────────────────────────────────────────────────────────────────
	let checkedSteps = $state<Set<string>>(new Set());
	let currentSectionIdx = $state(0);
	let focusedStepIdx = $state(0);
	let syncStatus = $state<SyncStatus>({ online: false, lastSynced: null, stale: false, remoteUpdatedAt: null });
	let showStalePrompt = $state(false);
	let remoteRecord = $state<{ checkedSteps: string[]; updatedAt: string } | null>(null);

	// ── Derived ────────────────────────────────────────────────────────────────
	const totalCheckable = $derived(countCheckableSteps(wt.sections));
	const checkedCount = $derived([...checkedSteps].filter(id => {
		// Only count checkable steps
		for (const s of wt.sections) for (const step of s.steps) if (step.id === id && step.type !== 'note') return true;
		return false;
	}).length);
	const progressPct = $derived(computeProgress(new Set([...checkedSteps].filter(id => {
		for (const s of wt.sections) for (const step of s.steps) if (step.id === id && step.type !== 'note') return true;
		return false;
	})), totalCheckable));

	const currentSection = $derived(wt.sections[currentSectionIdx]);

	// ── Step DOM refs ──────────────────────────────────────────────────────────
	let stepRefs: HTMLElement[] = [];

	function stepAction(el: HTMLElement, idx: number) {
		stepRefs[idx] = el;
		return {
			update(newIdx: number) { stepRefs[newIdx] = el; },
			destroy() {}
		};
	}

	// ── Toggle step ────────────────────────────────────────────────────────────
	async function toggleStep(stepId: string, stepType: string) {
		if (stepType === 'note') return;
		const next = new Set(checkedSteps);
		if (next.has(stepId)) next.delete(stepId);
		else next.add(stepId);
		checkedSteps = next;
		const record = await saveProgress(wt.id, checkedSteps);
		// Background sync — non-blocking
		syncProgress(wt.id, record).then((status) => {
			syncStatus = status;
			if (status.stale && status.remoteUpdatedAt) {
				remoteRecord = null; // will be fetched on demand
				showStalePrompt = true;
			}
		});
	}

	// ── Stale prompt ──────────────────────────────────────────────────────────
	async function loadRemoteState() {
		const { pullProgress } = await import('$lib/sync.js');
		const remote = await pullProgress(wt.id);
		if (remote) {
			checkedSteps = new Set(remote.checkedSteps);
			await saveProgress(wt.id, checkedSteps);
		}
		showStalePrompt = false;
	}

	function dismissStalePrompt() {
		showStalePrompt = false;
	}

	// ── Gamepad navigation ─────────────────────────────────────────────────────
	let gamepad: GamepadNavigator | null = null;

	function handleGamepadAction(action: string) {
		const steps = currentSection?.steps ?? [];
		switch (action) {
			case 'focus-up':
				focusedStepIdx = Math.max(0, focusedStepIdx - 1);
				break;
			case 'focus-down':
				focusedStepIdx = Math.min(steps.length - 1, focusedStepIdx + 1);
				break;
			case 'check': {
				const step = steps[focusedStepIdx];
				if (step) toggleStep(step.id, step.type);
				break;
			}
			case 'prev-section':
				if (currentSectionIdx > 0) { currentSectionIdx--; focusedStepIdx = 0; }
				break;
			case 'next-section':
				if (currentSectionIdx < wt.sections.length - 1) { currentSectionIdx++; focusedStepIdx = 0; }
				break;
			case 'back':
				history.back();
				break;
		}
		tick().then(() => stepRefs[focusedStepIdx]?.focus());
	}

	// ── Keyboard navigation (mirrors gamepad) ─────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		const steps = currentSection?.steps ?? [];
		if (e.key === 'ArrowUp') { e.preventDefault(); handleGamepadAction('focus-up'); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); handleGamepadAction('focus-down'); }
		else if (e.key === 'ArrowLeft') handleGamepadAction('prev-section');
		else if (e.key === 'ArrowRight') handleGamepadAction('next-section');
		else if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			const step = steps[focusedStepIdx];
			if (step) toggleStep(step.id, step.type);
		}
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMount(async () => {
		const record = await loadProgress(wt.id);
		if (record) checkedSteps = new Set(record.checkedSteps);

		// Async background sync
		syncProgress(wt.id, record).then((status) => {
			syncStatus = status;
			if (status.stale && status.remoteUpdatedAt) showStalePrompt = true;
		});

		gamepad = new GamepadNavigator(handleGamepadAction);
		gamepad.start();

		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		gamepad?.stop();
		window.removeEventListener('keydown', handleKeydown);
	});

	// ── Step type helpers ─────────────────────────────────────────────────────
	const TYPE_ICON: Record<string, string> = {
		step: '✓',
		note: 'ℹ',
		warning: '⚠',
		collectible: '◆',
		boss: '☠'
	};

	const TYPE_LABEL: Record<string, string> = {
		step: 'Step',
		note: 'Note',
		warning: 'Warning',
		collectible: 'Collectible',
		boss: 'Boss'
	};
</script>

<svelte:head>
	<title>{wt.game} — {wt.title}</title>
</svelte:head>

<!-- Stale state prompt -->
{#if showStalePrompt && syncStatus.remoteUpdatedAt}
	<div class="stale-overlay" role="dialog" aria-modal="true" aria-labelledby="stale-title">
		<div class="stale-card">
			<p id="stale-title" class="stale-icon">🔄</p>
			<h2>Newer progress found</h2>
			<p class="stale-desc">
				A more recent save was found on the server from <strong>{timeAgo(syncStatus.remoteUpdatedAt)}</strong>.
				This can happen when you played on another device.
			</p>
			<div class="stale-actions">
				<button class="btn-primary" onclick={loadRemoteState}>Load newer state</button>
				<button class="btn-ghost" onclick={dismissStalePrompt}>Keep current progress</button>
			</div>
		</div>
	</div>
{/if}

<div class="page">
	<!-- Header -->
	<header class="top-bar">
		<a href="/" class="back-btn" aria-label="Back to list">‹</a>
		<div class="header-text">
			<span class="game-title">{wt.game}</span>
			<span class="wt-title">{wt.title}</span>
		</div>
		<div class="progress-info" aria-label="{checkedCount} of {totalCheckable} steps done">
			<span class="progress-frac">{checkedCount}<span class="progress-sep">/</span>{totalCheckable}</span>
		</div>
	</header>

	<!-- Progress bar -->
	<div class="progress-bar-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
		<div class="progress-bar-fill" style="width: {progressPct}%"></div>
	</div>

	<!-- Section tabs -->
	<nav class="section-tabs" aria-label="Sections">
		{#each wt.sections as section, i (section.id)}
			<button
				class="section-tab"
				class:active={i === currentSectionIdx}
				onclick={() => { currentSectionIdx = i; focusedStepIdx = 0; }}
				aria-current={i === currentSectionIdx ? 'true' : undefined}
			>
				{section.title}
			</button>
		{/each}
	</nav>

	<!-- Legend -->
	<details class="legend">
		<summary class="legend-toggle">Step type legend</summary>
		<ul class="legend-list" aria-label="Step type legend">
			{#each Object.entries(TYPE_ICON) as [type, icon]}
				<li class="legend-item">
					<span class="type-badge type-{type}" aria-hidden="true">{icon}</span>
					<span class="legend-label">
						<strong>{TYPE_LABEL[type]}</strong>
						{#if type === 'step'} — checkable action{/if}
						{#if type === 'note'} — tip or info (not checkable){/if}
						{#if type === 'warning'} — do not miss / be careful{/if}
						{#if type === 'collectible'} — missable item or trophy{/if}
						{#if type === 'boss'} — boss fight{/if}
					</span>
				</li>
			{/each}
		</ul>
	</details>

	<!-- Steps list -->
	<main class="steps-list" aria-label="Steps for {currentSection?.title}">
		{#each currentSection?.steps ?? [] as step, i (step.id)}
			{@const isCheckable = step.type !== 'note'}
			{@const isChecked = checkedSteps.has(step.id)}
			{@const isFocused = i === focusedStepIdx}
			<div
				class="step-card"
				class:checkable={isCheckable}
				class:checked={isChecked}
				class:focused={isFocused}
				class:type-note={step.type === 'note'}
				class:type-warning={step.type === 'warning'}
				class:type-collectible={step.type === 'collectible'}
				class:type-boss={step.type === 'boss'}
				role={isCheckable ? 'checkbox' : undefined}
				aria-checked={isCheckable ? isChecked : undefined}
				aria-label="{TYPE_LABEL[step.type]}: {step.text}"
				tabindex={isCheckable ? 0 : undefined}
				use:stepAction={i}
				onclick={() => toggleStep(step.id, step.type)}
				onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleStep(step.id, step.type); }}}
			>
				<div class="step-icon-col">
					<span class="type-badge type-{step.type}" aria-hidden="true">{TYPE_ICON[step.type]}</span>
					{#if isCheckable}
						<span class="custom-check" class:is-checked={isChecked} aria-hidden="true">
							<svg viewBox="0 0 20 20" fill="none">
								<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
								<polyline class="check-mark" points="5,10 9,14 15,6" />
							</svg>
						</span>
					{/if}
				</div>
				<div class="step-body">
					<p class="step-text">{@html step.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
					{#if step.note}
						<p class="step-note">{step.note}</p>
					{/if}
					{#if step.image_url}
						<img class="step-img" src={step.image_url} alt="Screenshot for this step" loading="lazy" />
					{/if}
				</div>
			</div>
		{/each}
	</main>

	<!-- Attribution -->
	<footer class="attribution">
		<p>📄 {wt.attribution}</p>
		<a href={wt.source_url} target="_blank" rel="noopener noreferrer" class="source-link">
			View original source ↗
		</a>
	</footer>
</div>

<style>
	.page {
		max-width: 700px;
		margin: 0 auto;
		padding-bottom: 3rem;
	}

	/* ── Top bar ── */
	.top-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: rgba(10, 10, 20, 0.85);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 1px solid rgba(124,106,247,0.1);
	}

	.back-btn {
		font-size: 1.8rem;
		line-height: 1;
		color: #7c6af7;
		flex-shrink: 0;
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		transition: background 0.2s, transform 0.15s;
	}

	.back-btn:hover {
		background: rgba(124,106,247,0.12);
		transform: translateX(-2px);
	}

	.header-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.game-title {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #f0f0ff;
	}

	.wt-title {
		font-size: 0.75rem;
		color: #6a6a8a;
	}

	.progress-info {
		flex-shrink: 0;
	}

	.progress-frac {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #a89df7;
	}

	.progress-sep {
		color: #3a3a5c;
		margin: 0 1px;
	}

	/* ── Progress bar ── */
	.progress-bar-track {
		height: 3px;
		background: rgba(42, 42, 68, 0.5);
		position: relative;
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c6af7, #a89df7, #54d66a);
		background-size: 200% 100%;
		transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 0 8px rgba(124,106,247,0.5);
		position: relative;
	}

	.progress-bar-fill::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
		animation: shimmer 2s infinite;
	}

	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	/* ── Section tabs ── */
	.section-tabs {
		display: flex;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 0 0.5rem;
		border-bottom: 1px solid rgba(42, 42, 68, 0.6);
	}

	.section-tabs::-webkit-scrollbar { display: none; }

	.section-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #6a6a8a;
		padding: 0.8rem 1rem;
		font-size: 0.82rem;
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.2s, border-color 0.2s, text-shadow 0.2s;
		flex-shrink: 0;
	}

	.section-tab:hover {
		color: #a89df7;
	}

	.section-tab.active {
		color: #a89df7;
		border-bottom-color: #7c6af7;
		text-shadow: 0 0 10px rgba(124,106,247,0.4);
	}

	/* ── Steps ── */
	.steps-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem;
	}

	.step-card {
		display: flex;
		gap: 0.75rem;
		border-radius: 14px;
		padding: 0.9rem 1rem;
		background: rgba(20, 20, 36, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 2px solid transparent;
		transition: border-color 0.2s, background 0.2s, opacity 0.3s, transform 0.15s, box-shadow 0.2s;
		cursor: default;
	}

	.step-card.checkable {
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.step-card.checkable:hover,
	.step-card.focused {
		border-color: rgba(124,106,247,0.5);
		background: rgba(26, 26, 50, 0.8);
		box-shadow: 0 0 16px rgba(124,106,247,0.1);
	}

	.step-card.checkable:active {
		transform: scale(0.99);
	}

	.step-card.checked {
		opacity: 0.5;
		border-color: rgba(58, 58, 92, 0.4);
	}

	.step-card.checked .step-text {
		text-decoration: line-through;
		text-decoration-color: rgba(124,106,247,0.4);
	}

	/* Type-specific accents */
	.step-card.type-warning {
		border-left: 3px solid #ff9f43;
		box-shadow: inset 3px 0 12px -6px rgba(255,159,67,0.15);
	}
	.step-card.type-collectible {
		border-left: 3px solid #54d66a;
		box-shadow: inset 3px 0 12px -6px rgba(84,214,106,0.15);
	}
	.step-card.type-boss {
		border-left: 3px solid #ee5a5a;
		box-shadow: inset 3px 0 12px -6px rgba(238,90,90,0.15);
	}
	.step-card.type-note {
		background: rgba(124,106,247,0.05);
		border-color: rgba(124,106,247,0.12);
	}

	.step-icon-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		padding-top: 0.1rem;
	}

	.type-badge {
		font-size: 0.75rem;
		width: 24px;
		height: 24px;
		border-radius: 7px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.type-step { background: rgba(124,106,247,0.15); color: #a89df7; }
	.type-note { background: rgba(124,106,247,0.08); color: #7c6af7; }
	.type-warning { background: rgba(255,159,67,0.15); color: #ff9f43; }
	.type-collectible { background: rgba(84,214,106,0.15); color: #54d66a; }
	.type-boss { background: rgba(238,90,90,0.15); color: #ee5a5a; }

	/* Custom checkbox */
	.custom-check {
		display: block;
		width: 20px;
		height: 20px;
	}

	.custom-check svg {
		width: 100%;
		height: 100%;
	}

	.check-bg {
		stroke: #3a3a5c;
		stroke-width: 1.5;
		fill: rgba(10,10,20,0.5);
		transition: stroke 0.2s, fill 0.2s;
	}

	.custom-check.is-checked .check-bg {
		stroke: #7c6af7;
		fill: rgba(124,106,247,0.15);
	}

	.check-mark {
		stroke: #3a3a5c;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 20;
		stroke-dashoffset: 20;
		transition: stroke-dashoffset 0.3s ease, stroke 0.2s;
	}

	.custom-check.is-checked .check-mark {
		stroke-dashoffset: 0;
		stroke: #7c6af7;
	}

	.step-body {
		flex: 1;
		min-width: 0;
	}

	.step-text {
		font-size: 0.92rem;
		line-height: 1.5;
		color: #e8e8f0;
	}

	.step-note {
		margin-top: 0.4rem;
		font-size: 0.8rem;
		color: #6a6a8a;
		line-height: 1.4;
	}

	.step-img {
		margin-top: 0.6rem;
		width: 100%;
		border-radius: 10px;
		max-height: 200px;
		object-fit: cover;
		border: 1px solid rgba(42,42,68,0.5);
	}

	/* ── Legend ── */
	.legend {
		margin: 0.5rem 0.75rem 0;
		border: 1px solid rgba(42, 42, 68, 0.6);
		border-radius: 12px;
		background: rgba(14, 14, 24, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.legend-toggle {
		padding: 0.6rem 1rem;
		font-size: 0.78rem;
		color: #6a6a8a;
		cursor: pointer;
		list-style: none;
		user-select: none;
		transition: color 0.2s;
	}

	.legend-toggle:hover {
		color: #a89df7;
	}

	.legend-toggle::-webkit-details-marker { display: none; }

	.legend[open] .legend-toggle {
		border-bottom: 1px solid rgba(42,42,68,0.5);
		color: #a89df7;
	}

	.legend-list {
		list-style: none;
		padding: 0.6rem 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.2rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.legend-label {
		font-size: 0.78rem;
		color: #8888aa;
		line-height: 1.3;
	}

	.legend-label strong {
		color: #c8c8e0;
	}

	/* ── Attribution ── */
	.attribution {
		margin: 2rem 1rem 0;
		padding: 1rem;
		border-top: 1px solid rgba(42,42,68,0.5);
		font-size: 0.78rem;
		color: #555577;
		line-height: 1.5;
	}

	.source-link {
		display: inline-block;
		margin-top: 0.4rem;
		color: #7c6af7;
		text-decoration: none;
		transition: color 0.2s, text-shadow 0.2s;
	}

	.source-link:hover {
		color: #a89df7;
		text-shadow: 0 0 8px rgba(124,106,247,0.3);
	}

	/* ── Stale overlay ── */
	.stale-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.7);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.stale-card {
		background: rgba(20, 20, 36, 0.95);
		border: 1px solid rgba(124,106,247,0.2);
		border-radius: 20px;
		padding: 2rem 1.5rem;
		max-width: 380px;
		width: 100%;
		text-align: center;
		box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(124,106,247,0.08);
		animation: slideUp 0.3s ease;
	}

	@keyframes slideUp {
		from { transform: translateY(20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	.stale-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }

	.stale-card h2 {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 1.3rem;
		font-weight: 700;
		margin-bottom: 0.6rem;
		color: #f0f0ff;
	}

	.stale-desc {
		font-size: 0.88rem;
		color: #8888aa;
		line-height: 1.5;
		margin-bottom: 1.25rem;
	}

	.stale-actions {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.btn-primary {
		background: linear-gradient(135deg, #7c6af7, #6a58e5);
		color: #fff;
		border: none;
		border-radius: 12px;
		padding: 0.85rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.15s, box-shadow 0.2s;
		box-shadow: 0 4px 16px rgba(124,106,247,0.3);
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(124,106,247,0.4);
	}

	.btn-primary:active { transform: scale(0.98); }

	.btn-ghost {
		background: transparent;
		color: #8888aa;
		border: 1px solid rgba(58, 58, 92, 0.5);
		border-radius: 12px;
		padding: 0.8rem 1rem;
		font-size: 0.9rem;
		cursor: pointer;
		transition: border-color 0.2s, color 0.2s;
	}

	.btn-ghost:hover {
		border-color: rgba(124,106,247,0.3);
		color: #a89df7;
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-bar-fill::after {
			animation: none;
		}
		.stale-overlay, .stale-card {
			animation: none;
		}
		.check-mark {
			transition: none;
		}
	}
</style>
