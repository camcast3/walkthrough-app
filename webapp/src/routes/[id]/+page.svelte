<script lang="ts">
	import type { PageData } from './$types.js';
	import { onMount, onDestroy, tick } from 'svelte';
	import { loadProgress, saveProgress, countCheckableSteps, computeProgress, estimateTimeRemaining, formatHours } from '$lib/state.js';
	import { syncProgress, timeAgo } from '$lib/sync.js';
	import { GamepadNavigator } from '$lib/gamepad.js';
	import type { SyncStatus } from '$lib/types.js';
	import { marked } from 'marked';

	let { data }: { data: PageData } = $props();
	const wt = $derived(data.walkthrough);

	// ── State ──────────────────────────────────────────────────────────────────
	let checkedSteps = $state<Set<string>>(new Set());
	let currentSectionIdx = $state(0);
	let focusedStepIdx = $state(0);
	let syncStatus = $state<SyncStatus>({ online: false, lastSynced: null, stale: false, remoteUpdatedAt: null });
	let showStalePrompt = $state(false);
	let remoteRecord = $state<{ checkedSteps: string[]; updatedAt: string } | null>(null);
	let showSteps = $state(false);
	let tabsEl: HTMLElement | null = null;

	// ── HLTB time mode: 'main_story', 'main_story_sides', or 'completionist' ──
	/** Minimum difference in hours between any two HLTB times to show the toggle. */
	const MIN_HLTB_DIFFERENCE_HOURS = 0.5;

	type HltbMode = 'main_story' | 'main_story_sides' | 'completionist';

	const HLTB_MODE_LABELS: Record<HltbMode, string> = {
		main_story: 'Story',
		main_story_sides: '+Sides',
		completionist: '100%'
	};

	const HLTB_MODE_FINISH_LABELS: Record<HltbMode, string> = {
		main_story: 'to finish',
		main_story_sides: 'with sides',
		completionist: 'to 100%'
	};

	/** Ordered list of HLTB modes that have a value in this walkthrough. */
	const hltbAvailableModes = $derived(
		(['main_story', 'main_story_sides', 'completionist'] as HltbMode[]).filter(
			(m) => wt.hltb?.[m] != null
		)
	);

	/** Whether there are at least 2 HLTB modes available to toggle between. */
	const hltbHasToggle = $derived(hltbAvailableModes.length >= 2);

	let hltbMode = $state<HltbMode>('main_story');

	/**
	 * Resolves the active HLTB total hours based on the selected mode.
	 * Falls back to the first available mode if the selected one has no value.
	 */
	function resolveHltbHours(mode: HltbMode): number | undefined {
		if (wt.hltb?.[mode] != null) return wt.hltb[mode];
		for (const m of ['main_story', 'main_story_sides', 'completionist'] as HltbMode[]) {
			if (wt.hltb?.[m] != null) return wt.hltb[m];
		}
		return undefined;
	}

	/** Cycles to the next available HLTB mode. */
	function cycleHltbMode() {
		const idx = hltbAvailableModes.indexOf(hltbMode);
		hltbMode = hltbAvailableModes[(idx + 1) % hltbAvailableModes.length];
	}

	const hltbTotalHours = $derived(resolveHltbHours(hltbMode));

	// Auto-scroll active tab into center view
	$effect(() => {
		void currentSectionIdx;
		tick().then(() => {
			if (!tabsEl) return;
			const activeTab = tabsEl.querySelector('.section-tab.active') as HTMLElement | null;
			if (activeTab) {
				const tabsRect = tabsEl.getBoundingClientRect();
				const tabRect = activeTab.getBoundingClientRect();
				const scrollLeft = tabsEl.scrollLeft + (tabRect.left - tabsRect.left) - (tabsRect.width / 2) + (tabRect.width / 2);
				tabsEl.scrollTo({ left: scrollLeft, behavior: 'smooth' });
			}
		});
	});

	// ── Helpers ────────────────────────────────────────────────────────────────
	function isCheckableId(id: string): boolean {
		for (const s of wt.sections) {
			for (const step of (s.steps ?? [])) if (step.id === id && step.type !== 'note') return true;
			for (const cp of (s.checkpoints ?? [])) if (cp.id === id) return true;
		}
		return false;
	}

	// ── Derived ────────────────────────────────────────────────────────────────
	const totalCheckable = $derived(countCheckableSteps(wt.sections));
	const checkedCount = $derived([...checkedSteps].filter(isCheckableId).length);
	const progressPct = $derived(computeProgress(new Set([...checkedSteps].filter(isCheckableId)), totalCheckable));

	const currentSection = $derived(wt.sections[currentSectionIdx]);

	// HLTB-derived: time remaining estimate
	const timeRemainingHours = $derived(estimateTimeRemaining(hltbTotalHours, progressPct));
	const timeRemainingLabel = $derived(timeRemainingHours != null ? formatHours(timeRemainingHours) : null);

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

	// ── Toggle checkpoint ──────────────────────────────────────────────────────
	async function toggleCheckpoint(cpId: string) {
		const next = new Set(checkedSteps);
		if (next.has(cpId)) next.delete(cpId);
		else next.add(cpId);
		checkedSteps = next;
		const record = await saveProgress(wt.id, checkedSteps);
		syncProgress(wt.id, record).then((status) => {
			syncStatus = status;
			if (status.stale && status.remoteUpdatedAt) {
				remoteRecord = null;
				showStalePrompt = true;
			}
		});
	}

	// ── Markdown rendering with checkpoint placeholders ───────────────────────
	const CHECKPOINT_RE = /<!--\s*checkpoint:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:\|\s*(.*?))?\s*-->/g;
	const CHECKPOINT_PLACEHOLDER = '___CHECKPOINT___';

	function renderContentHtml(content: string): string {
		const checkpoints: { id: string; label: string }[] = [];
		const withPlaceholders = content.replace(CHECKPOINT_RE, (_match, id, label) => {
			checkpoints.push({ id, label: label?.trim() || id });
			return `\n\n${CHECKPOINT_PLACEHOLDER}${checkpoints.length - 1}\n\n`;
		});

		let html = marked.parse(withPlaceholders, { async: false }) as string;

		checkpoints.forEach((cp, idx) => {
			const placeholder = `${CHECKPOINT_PLACEHOLDER}${idx}`;
			const placeholderInP = new RegExp(`<p>${placeholder}</p>`, 'g');
			const placeholderBare = new RegExp(placeholder, 'g');
			const replacement = `<div class="checkpoint-slot" data-checkpoint-id="${cp.id}" data-checkpoint-label="${cp.label.replace(/"/g, '&quot;')}"></div>`;
			html = html.replace(placeholderInP, replacement);
			html = html.replace(placeholderBare, replacement);
		});

		return html;
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
	let contentEl: HTMLElement | null = null;

	function bindCheckpointSlots() {
		if (!contentEl) return;
		const slots = contentEl.querySelectorAll<HTMLElement>('.checkpoint-slot');
		slots.forEach((slot) => {
			const cpId = slot.dataset.checkpointId!;
			const cpLabel = slot.dataset.checkpointLabel!;
			const isChecked = checkedSteps.has(cpId);

			slot.innerHTML = `
				<button class="checkpoint-btn ${isChecked ? 'is-checked' : ''}" aria-label="Milestone: ${cpLabel}" role="checkbox" aria-checked="${isChecked}">
					<span class="checkpoint-check" aria-hidden="true">
						<svg viewBox="0 0 20 20" fill="none">
							<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
							<polyline class="check-mark ${isChecked ? 'checked' : ''}" points="5,10 9,14 15,6" />
						</svg>
					</span>
					<span class="checkpoint-flag" aria-hidden="true">🏁</span>
					<span class="checkpoint-label">${cpLabel}</span>
				</button>`;

			const btn = slot.querySelector('button')!;
			btn.onclick = () => toggleCheckpoint(cpId);
		});
	}

	$effect(() => {
		// Re-bind checkpoints whenever checked state or section changes
		void checkedSteps;
		void currentSectionIdx;
		tick().then(bindCheckpointSlots);
	});

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

	<!-- HLTB time remaining -->
	{#if timeRemainingLabel != null}
		<div class="hltb-bar" aria-label="Estimated time remaining based on HowLongToBeat data">
			<span class="hltb-clock" aria-hidden="true">⏱</span>
			<span class="hltb-label">
				{#if progressPct >= 100}
					Complete!
				{:else if progressPct > 0}
					~{timeRemainingLabel} remaining
				{:else}
					~{timeRemainingLabel} {HLTB_MODE_FINISH_LABELS[hltbMode]}
				{/if}
			</span>
			{#if hltbHasToggle}
				{@const nextMode = hltbAvailableModes[(hltbAvailableModes.indexOf(hltbMode) + 1) % hltbAvailableModes.length]}
				<button
					class="hltb-toggle"
					onclick={cycleHltbMode}
					aria-label="Showing {HLTB_MODE_LABELS[hltbMode]} estimate ({timeRemainingLabel}). Switch to {HLTB_MODE_LABELS[nextMode]}"
				>
					{HLTB_MODE_LABELS[hltbMode]} ⇄
				</button>
			{/if}
		</div>
	{/if}

	<!-- Section navigation -->
	<div class="section-nav">
		<button
			class="section-arrow"
			onclick={() => { if (currentSectionIdx > 0) { currentSectionIdx--; focusedStepIdx = 0; } }}
			disabled={currentSectionIdx === 0}
			aria-label="Previous section"
		>‹</button>
		<nav class="section-tabs" bind:this={tabsEl} aria-label="Sections">
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
		<button
			class="section-arrow"
			onclick={() => { if (currentSectionIdx < wt.sections.length - 1) { currentSectionIdx++; focusedStepIdx = 0; } }}
			disabled={currentSectionIdx === wt.sections.length - 1}
			aria-label="Next section"
		>›</button>
	</div>
	<div class="section-counter">{currentSectionIdx + 1} / {wt.sections.length}</div>

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

	<!-- Section content -->
	{#if currentSection?.content}
		<!-- Prose mode: full walkthrough text with embedded checkpoints -->
		<div class="prose-container" bind:this={contentEl}>
			{@html renderContentHtml(currentSection.content)}
		</div>

		<!-- Collapsible granular steps -->
		{#if currentSection.steps && currentSection.steps.length > 0}
			<details class="steps-toggle" bind:open={showSteps}>
				<summary class="steps-toggle-btn">
					<span class="steps-toggle-icon">{showSteps ? '▼' : '▶'}</span>
					Detailed steps ({currentSection.steps.filter(s => s.type !== 'note').length} checkable)
				</summary>
				<main class="steps-list" aria-label="Detailed steps for {currentSection?.title}">
					{#each currentSection.steps as step, i (step.id)}
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
			</details>
		{/if}
	{:else}
		<!-- Classic mode: step list only -->
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
	{/if}

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

	:global(body[data-power-save]) .progress-bar-fill::after {
		animation: none;
		display: none;
	}

	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	/* ── HLTB time bar ── */
	.hltb-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 1rem;
		background: rgba(10, 10, 20, 0.6);
		border-bottom: 1px solid rgba(84, 214, 106, 0.1);
		font-size: 0.78rem;
		color: #54d66a;
	}

	.hltb-clock {
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.hltb-label {
		flex: 1;
		font-variant-numeric: tabular-nums;
	}

	.hltb-toggle {
		background: rgba(84, 214, 106, 0.08);
		border: 1px solid rgba(84, 214, 106, 0.25);
		color: #54d66a;
		border-radius: 10px;
		padding: 0.15rem 0.55rem;
		font-size: 0.72rem;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.2s, border-color 0.2s;
		line-height: 1.4;
	}

	.hltb-toggle:hover {
		background: rgba(84, 214, 106, 0.16);
		border-color: rgba(84, 214, 106, 0.5);
	}
	/* ── Section navigation ── */
	.section-nav {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid rgba(42, 42, 68, 0.6);
	}

	.section-arrow {
		background: none;
		border: none;
		color: #7c6af7;
		font-size: 1.6rem;
		line-height: 1;
		padding: 0.5rem 0.7rem;
		cursor: pointer;
		flex-shrink: 0;
		transition: color 0.2s, background 0.2s, transform 0.15s;
		display: flex;
		align-items: center;
	}

	.section-arrow:hover:not(:disabled) {
		background: rgba(124,106,247,0.1);
		color: #a89df7;
	}

	.section-arrow:active:not(:disabled) {
		transform: scale(0.9);
	}

	.section-arrow:disabled {
		color: #2a2a44;
		cursor: default;
	}

	.section-tabs {
		display: flex;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		flex: 1;
		min-width: 0;
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

	.section-counter {
		text-align: center;
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: #555577;
		padding: 0.3rem 0;
		letter-spacing: 0.5px;
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

	:global(body[data-power-save]) .step-card {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
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

	:global(body[data-power-save]) .legend {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
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

	/* ── Prose container ── */
	.prose-container {
		padding: 1rem 1rem 0.5rem;
		line-height: 1.75;
		color: #d8d8e8;
		font-size: 0.94rem;
	}

	.prose-container :global(h1),
	.prose-container :global(h2),
	.prose-container :global(h3) {
		font-family: 'Rajdhani', system-ui, sans-serif;
		color: #f0f0ff;
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.prose-container :global(h1) { font-size: 1.6rem; }
	.prose-container :global(h2) { font-size: 1.3rem; }
	.prose-container :global(h3) { font-size: 1.1rem; }

	.prose-container :global(p) {
		margin: 0.75rem 0;
	}

	.prose-container :global(strong) {
		color: #f0f0ff;
	}

	.prose-container :global(em) {
		color: #a89df7;
		font-style: italic;
	}

	.prose-container :global(ul),
	.prose-container :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}

	.prose-container :global(li) {
		margin: 0.3rem 0;
	}

	.prose-container :global(blockquote) {
		border-left: 3px solid rgba(124,106,247,0.4);
		padding: 0.5rem 1rem;
		margin: 0.75rem 0;
		background: rgba(124,106,247,0.05);
		border-radius: 0 8px 8px 0;
		color: #a89df7;
	}

	.prose-container :global(code) {
		background: rgba(42,42,68,0.6);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.prose-container :global(hr) {
		border: none;
		border-top: 1px solid rgba(42,42,68,0.6);
		margin: 1.5rem 0;
	}

	/* ── Checkpoint buttons (injected into prose) ── */
	.prose-container :global(.checkpoint-slot) {
		margin: 1rem 0;
	}

	.prose-container :global(.checkpoint-btn) {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		background: rgba(124,106,247,0.06);
		border: 2px solid rgba(124,106,247,0.2);
		border-radius: 14px;
		padding: 0.85rem 1rem;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.prose-container :global(.checkpoint-btn:hover) {
		border-color: rgba(124,106,247,0.5);
		background: rgba(124,106,247,0.1);
		box-shadow: 0 0 16px rgba(124,106,247,0.1);
	}

	.prose-container :global(.checkpoint-btn:active) {
		transform: scale(0.99);
	}

	.prose-container :global(.checkpoint-btn.is-checked) {
		border-color: rgba(84,214,106,0.4);
		background: rgba(84,214,106,0.06);
	}

	.prose-container :global(.checkpoint-check) {
		display: block;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
	}

	.prose-container :global(.checkpoint-check svg) {
		width: 100%;
		height: 100%;
	}

	.prose-container :global(.checkpoint-check .check-bg) {
		stroke: #3a3a5c;
		stroke-width: 1.5;
		fill: rgba(10,10,20,0.5);
		transition: stroke 0.2s, fill 0.2s;
	}

	.prose-container :global(.checkpoint-btn.is-checked .check-bg) {
		stroke: #54d66a;
		fill: rgba(84,214,106,0.15);
	}

	.prose-container :global(.checkpoint-check .check-mark) {
		stroke: #3a3a5c;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 20;
		stroke-dashoffset: 20;
		transition: stroke-dashoffset 0.3s ease, stroke 0.2s;
	}

	.prose-container :global(.checkpoint-check .check-mark.checked) {
		stroke-dashoffset: 0;
		stroke: #54d66a;
	}

	.prose-container :global(.checkpoint-flag) {
		font-size: 1.1rem;
		flex-shrink: 0;
	}

	.prose-container :global(.checkpoint-label) {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: #e8e8f0;
	}

	.prose-container :global(.checkpoint-btn.is-checked .checkpoint-label) {
		color: #54d66a;
	}

	/* ── Steps toggle (collapsible) ── */
	.steps-toggle {
		margin: 0.5rem 0.75rem 0;
		border: 1px solid rgba(42,42,68,0.6);
		border-radius: 12px;
		background: rgba(14,14,24,0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	:global(body[data-power-save]) .steps-toggle {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.steps-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		font-size: 0.85rem;
		color: #8888aa;
		cursor: pointer;
		list-style: none;
		user-select: none;
		transition: color 0.2s;
	}

	.steps-toggle-btn:hover {
		color: #a89df7;
	}

	.steps-toggle-btn::-webkit-details-marker { display: none; }

	.steps-toggle[open] .steps-toggle-btn {
		border-bottom: 1px solid rgba(42,42,68,0.5);
		color: #a89df7;
	}

	.steps-toggle-icon {
		font-size: 0.7rem;
		transition: transform 0.2s;
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
