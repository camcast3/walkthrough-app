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
			<span class="progress-frac">{checkedCount}/{totalCheckable}</span>
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
						<span class="check-box" aria-hidden="true">{isChecked ? '☑' : '☐'}</span>
					{/if}
				</div>
				<div class="step-body">
					<!-- Render markdown-like bold using a simple replace -->
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
		background: #0f0f1a;
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 1px solid #2a2a44;
	}

	.back-btn {
		font-size: 1.8rem;
		line-height: 1;
		color: #7c6af7;
		flex-shrink: 0;
		padding: 0.2rem 0.4rem;
		border-radius: 8px;
		transition: background 0.15s;
	}

	.back-btn:hover { background: rgba(124,106,247,0.15); }

	.header-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.game-title {
		font-size: 0.95rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wt-title {
		font-size: 0.75rem;
		color: #8888aa;
	}

	.progress-info {
		flex-shrink: 0;
	}

	.progress-frac {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		color: #9898b8;
	}

	/* ── Progress bar ── */
	.progress-bar-track {
		height: 3px;
		background: #2a2a44;
	}

	.progress-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c6af7, #a89df7);
		transition: width 0.3s ease;
	}

	/* ── Section tabs ── */
	.section-tabs {
		display: flex;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 0 0.5rem;
		border-bottom: 1px solid #2a2a44;
	}

	.section-tabs::-webkit-scrollbar { display: none; }

	.section-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #8888aa;
		padding: 0.75rem 0.9rem;
		font-size: 0.82rem;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s, border-color 0.15s;
		flex-shrink: 0;
	}

	.section-tab.active {
		color: #a89df7;
		border-bottom-color: #7c6af7;
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
		border-radius: 12px;
		padding: 0.9rem 1rem;
		background: #1a1a2e;
		border: 2px solid transparent;
		transition: border-color 0.15s, background 0.15s, opacity 0.15s;
		cursor: default;
	}

	.step-card.checkable {
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.step-card.checkable:hover,
	.step-card.focused {
		border-color: #7c6af7;
		background: #1f1f38;
	}

	.step-card.checked {
		opacity: 0.55;
		border-color: #3a3a5c;
	}

	.step-card.checked .step-text {
		text-decoration: line-through;
		text-decoration-color: #666688;
	}

	/* Type-specific accents */
	.step-card.type-warning { border-left: 3px solid #ff9f43; }
	.step-card.type-collectible { border-left: 3px solid #54d66a; }
	.step-card.type-boss { border-left: 3px solid #ee5a5a; }
	.step-card.type-note {
		background: rgba(124,106,247,0.07);
		border-color: rgba(124,106,247,0.15);
	}

	.step-icon-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		padding-top: 0.1rem;
	}

	.type-badge {
		font-size: 0.75rem;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.type-step { background: rgba(124,106,247,0.2); color: #a89df7; }
	.type-note { background: rgba(124,106,247,0.1); color: #7c6af7; }
	.type-warning { background: rgba(255,159,67,0.2); color: #ff9f43; }
	.type-collectible { background: rgba(84,214,106,0.2); color: #54d66a; }
	.type-boss { background: rgba(238,90,90,0.2); color: #ee5a5a; }

	.check-box {
		font-size: 1rem;
		color: #666688;
		line-height: 1;
	}

	.step-card.checked .check-box { color: #7c6af7; }

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
		color: #777799;
		line-height: 1.4;
	}

	.step-img {
		margin-top: 0.6rem;
		width: 100%;
		border-radius: 8px;
		max-height: 200px;
		object-fit: cover;
	}

	/* ── Attribution ── */
	.attribution {
		margin: 2rem 1rem 0;
		padding: 1rem;
		border-top: 1px solid #2a2a44;
		font-size: 0.78rem;
		color: #666688;
		line-height: 1.5;
	}

	.source-link {
		display: inline-block;
		margin-top: 0.4rem;
		color: #7c6af7;
		text-decoration: underline;
	}

	/* ── Stale overlay ── */
	.stale-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.stale-card {
		background: #1a1a2e;
		border: 1px solid #3a3a5c;
		border-radius: 16px;
		padding: 2rem 1.5rem;
		max-width: 380px;
		width: 100%;
		text-align: center;
	}

	.stale-icon { font-size: 2rem; margin-bottom: 0.75rem; }

	.stale-card h2 {
		font-size: 1.15rem;
		font-weight: 700;
		margin-bottom: 0.6rem;
	}

	.stale-desc {
		font-size: 0.88rem;
		color: #9898b8;
		line-height: 1.5;
		margin-bottom: 1.25rem;
	}

	.stale-actions {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.btn-primary {
		background: #7c6af7;
		color: #fff;
		border: none;
		border-radius: 10px;
		padding: 0.8rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-primary:hover { background: #6a58e5; }

	.btn-ghost {
		background: transparent;
		color: #9898b8;
		border: 1px solid #3a3a5c;
		border-radius: 10px;
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.btn-ghost:hover { border-color: #666688; }
</style>
