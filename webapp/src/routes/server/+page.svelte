<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { PageData } from './$types.js';
	import { submitIngest, fetchIngestJob, timeAgo } from '$lib/sync.js';
	import type { IngestJob, DeviceActivity } from '$lib/sync.js';
	import type { WalkthroughSummary } from '$lib/types.js';

	let { data }: { data: PageData } = $props();

	// ── Add Walkthrough ──────────────────────────────────────────────────────
	let ingestInput = $state('');
	let activeJob = $state<IngestJob | null>(null);
	let ingestError = $state('');
	let submitting = $state(false);

	// Recent jobs list — starts from server-loaded data, refreshed locally.
	let recentJobs = $state<IngestJob[]>(data.jobs as IngestJob[]);

	// Library — starts from server-loaded walkthroughs, updated after successful ingest.
	let walkthroughs = $state<WalkthroughSummary[]>(data.walkthroughs as WalkthroughSummary[]);

	// Devices
	let devices = $state<DeviceActivity[]>(data.devices as DeviceActivity[]);

	// Track the active polling timeout so it can be cleared on destroy or completion.
	let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

	onDestroy(() => {
		if (pollTimeoutId !== null) {
			clearTimeout(pollTimeoutId);
			pollTimeoutId = null;
		}
	});

	async function handleIngestSubmit(e: SubmitEvent) {
		e.preventDefault();
		const input = ingestInput.trim();
		if (!input) return;

		ingestError = '';
		submitting = true;
		activeJob = null;

		// Clear any existing poll before starting a new one.
		if (pollTimeoutId !== null) {
			clearTimeout(pollTimeoutId);
			pollTimeoutId = null;
		}

		try {
			const job = await submitIngest(input);
			activeJob = job;
			pollJob(job.id);
		} catch (err) {
			ingestError = err instanceof Error ? err.message : 'Failed to start ingest';
		} finally {
			submitting = false;
		}
	}

	function pollJob(id: string) {
		async function tick() {
			try {
				const job = await fetchIngestJob(id);
				activeJob = job;

				if (job.status === 'done' || job.status === 'error') {
					if (pollTimeoutId !== null) {
						clearTimeout(pollTimeoutId);
						pollTimeoutId = null;
					}

					// Prepend to recent jobs list.
					recentJobs = [job, ...recentJobs.filter((j) => j.id !== job.id)].slice(0, 20);

					// On success, reload the walkthrough list to include the new one.
					if (job.status === 'done') {
						ingestInput = '';
						try {
							const res = await fetch('/api/walkthroughs');
							if (res.ok) walkthroughs = await res.json();
						} catch {
							// Non-fatal
						}
					}
					return;
				}
			} catch {
				// Transient network error — keep polling until the job reaches a
				// terminal state rather than silently giving up.
			}
			pollTimeoutId = setTimeout(tick, 1000);
		}

		tick(); // start immediately; subsequent polls are rescheduled inside tick()
	}

	const STEP_ICONS: Record<string, string> = {
		pending: '○',
		running: '⟳',
		done: '✓',
		error: '✗'
	};

	function walkthroughLabel(id: string): string {
		const wt = walkthroughs.find((w) => w.id === id);
		return wt ? `${wt.game} — ${wt.title}` : id;
	}
</script>

<svelte:head>
	<title>Library Manager — Walkthrough Checklist</title>
</svelte:head>

<div class="page">
	<header class="hero">
		<a href="/" class="back-link" aria-label="Back to walkthroughs">← Back</a>
		<div class="hero-icon" aria-hidden="true">🗂️</div>
		<h1 class="hero-title">Library Manager</h1>
		<p class="subtitle">Add walkthroughs and monitor device activity</p>
	</header>

	{#if data.appMode !== 'server'}
		<div class="banner warning" role="alert">
			<span>⚠ Library management is only available in server mode.</span>
		</div>
	{:else}
		<!-- ── Add Walkthrough ───────────────────────────────────────────── -->
		<section class="section">
			<h2 class="section-title">
				<span aria-hidden="true">➕</span> Add Walkthrough
			</h2>
			<p class="section-desc">
				Paste a URL pointing to a walkthrough JSON file, or paste the raw JSON content directly.
			</p>

			<form class="ingest-form" onsubmit={handleIngestSubmit}>
				<textarea
					class="ingest-input"
					placeholder="https://raw.githubusercontent.com/…/walkthrough.json  or paste JSON directly"
					rows="4"
					bind:value={ingestInput}
					disabled={submitting}
					aria-label="Walkthrough URL or JSON content"
				></textarea>
				<button class="submit-btn" type="submit" disabled={submitting || !ingestInput.trim()}>
					{#if submitting}
						<span class="spinner" aria-hidden="true"></span>
						Starting…
					{:else}
						🚀 Start Ingest
					{/if}
				</button>
			</form>

			{#if ingestError}
				<div class="banner warning" role="alert" style="margin-top: 0.75rem;">
					<span>⚠ {ingestError}</span>
				</div>
			{/if}

			<!-- Active pipeline progress ─────────────────────────────────── -->
			{#if activeJob}
				<div class="pipeline" role="region" aria-label="Ingest pipeline progress">
					<div class="pipeline-header">
						<span class="pipeline-title">
							{#if activeJob.status === 'running'}
								<span class="spinner-sm" aria-hidden="true"></span>
								Pipeline running…
							{:else if activeJob.status === 'done'}
								<span class="status-icon done" aria-hidden="true">✓</span>
								Ingest complete!
							{:else}
								<span class="status-icon error" aria-hidden="true">✗</span>
								Ingest failed
							{/if}
						</span>
						<span class="pipeline-input" title={activeJob.input}>
							{activeJob.input.length > 60 ? activeJob.input.slice(0, 57) + '…' : activeJob.input}
						</span>
					</div>

					<ol class="steps" aria-label="Pipeline steps">
						{#each activeJob.steps as step}
							<li class="step" class:step-done={step.status === 'done'} class:step-error={step.status === 'error'} class:step-running={step.status === 'running'}>
								<span class="step-icon" aria-hidden="true">{STEP_ICONS[step.status] ?? '○'}</span>
								<div class="step-body">
									<span class="step-label">{step.label}</span>
									{#if step.message}
										<span class="step-msg">{step.message}</span>
									{/if}
								</div>
								{#if step.status === 'running'}
									<span class="spinner-sm" aria-hidden="true" style="margin-left:auto;"></span>
								{/if}
							</li>
						{/each}
					</ol>

					{#if activeJob.status === 'done' && activeJob.walkthrough_id}
						<div class="pipeline-success">
							✓ Added <a href="/{activeJob.walkthrough_id}" class="wt-link">{walkthroughLabel(activeJob.walkthrough_id)}</a>
						</div>
					{/if}
					{#if activeJob.status === 'error' && activeJob.error}
						<div class="pipeline-error">
							{activeJob.error}
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ── Library ──────────────────────────────────────────────────── -->
		<section class="section">
			<h2 class="section-title">
				<span aria-hidden="true">📚</span> Library ({walkthroughs.length})
			</h2>

			{#if walkthroughs.length === 0}
				<p class="empty-msg">No walkthroughs in the library yet.</p>
			{:else}
				<ul class="wt-list" role="list">
					{#each walkthroughs as wt (wt.id)}
						{@const devicesWithCheckout = devices.filter((d) => d.checked_out?.includes(wt.id))}
						<li class="wt-card">
							<div class="wt-info">
								<a href="/{wt.id}" class="wt-game">{wt.game}</a>
								<span class="wt-title">{wt.title}</span>
								<span class="wt-author">by {wt.author}</span>
							</div>
							<div class="wt-devices">
								{#if devicesWithCheckout.length === 0}
									<span class="no-device">no devices</span>
								{:else}
									{#each devicesWithCheckout as dev}
										<span class="device-badge" title="Last seen {timeAgo(dev.last_seen)}">
											🖥 {dev.device_id}
										</span>
									{/each}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ── Devices ──────────────────────────────────────────────────── -->
		<section class="section">
			<h2 class="section-title">
				<span aria-hidden="true">🖥️</span> Devices ({devices.length})
			</h2>

			{#if devices.length === 0}
				<p class="empty-msg">No devices have synced progress yet.</p>
			{:else}
				<ul class="device-list" role="list">
					{#each devices as dev (dev.device_id)}
						<li class="device-card">
							<div class="device-header">
								<span class="device-id">🖥 {dev.device_id}</span>
								<span class="device-seen">last seen {timeAgo(dev.last_seen)}</span>
							</div>
							{#if dev.checked_out?.length}
								<div class="device-section-label">Checked out</div>
								<ul class="device-wts" role="list">
									{#each dev.checked_out as id}
										<li>
											<a href="/{id}" class="device-wt-link">{walkthroughLabel(id)}</a>
										</li>
									{/each}
								</ul>
							{/if}
							{#if dev.walkthroughs?.length}
								<div class="device-section-label">Progress synced</div>
								<ul class="device-wts" role="list">
									{#each dev.walkthroughs as id}
										<li>
											<a href="/{id}" class="device-wt-link">{walkthroughLabel(id)}</a>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ── Ingest History ────────────────────────────────────────────── -->
		{#if recentJobs.length > 0}
			<section class="section">
				<h2 class="section-title">
					<span aria-hidden="true">📋</span> Ingest History
				</h2>
				<ul class="history-list" role="list">
					{#each recentJobs as job (job.id)}
						<li class="history-item" class:history-done={job.status === 'done'} class:history-error={job.status === 'error'} class:history-running={job.status === 'running'}>
							<span class="history-icon" aria-hidden="true">
								{#if job.status === 'done'}✓{:else if job.status === 'error'}✗{:else}⟳{/if}
							</span>
							<div class="history-body">
								<span class="history-input" title={job.input}>
									{job.input.length > 70 ? job.input.slice(0, 67) + '…' : job.input}
								</span>
								<span class="history-meta">
									{timeAgo(job.started_at)}
									{#if job.walkthrough_id}
										·
										<a href="/{job.walkthrough_id}" class="wt-link">{walkthroughLabel(job.walkthrough_id)}</a>
									{/if}
									{#if job.error}· {job.error}{/if}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
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
		filter: drop-shadow(0 0 10px rgba(124,106,247,0.35));
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
		background: rgba(255,180,0,0.08);
		border: 1px solid rgba(255,180,0,0.25);
		color: #ffd060;
	}

	/* ── Sections ─────────────────────────────────────────────────────── */
	.section {
		margin-bottom: 2rem;
	}

	.section-title {
		font-size: 1.15rem;
		font-weight: 600;
		color: #c8c0f8;
		margin-bottom: 0.6rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.section-desc {
		font-size: 0.85rem;
		color: #6a6a8a;
		margin-bottom: 0.75rem;
	}

	/* ── Ingest form ──────────────────────────────────────────────────── */
	.ingest-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.ingest-input {
		width: 100%;
		background: rgba(20, 20, 36, 0.7);
		border: 1px solid rgba(124,106,247,0.2);
		border-radius: 12px;
		color: #e8e8f0;
		font-family: 'Courier New', monospace;
		font-size: 0.82rem;
		padding: 0.75rem 1rem;
		resize: vertical;
		transition: border-color 0.2s;
	}
	.ingest-input::placeholder {
		color: #444466;
	}
	.ingest-input:focus {
		outline: none;
		border-color: rgba(124,106,247,0.5);
	}
	.ingest-input:disabled {
		opacity: 0.55;
	}

	.submit-btn {
		align-self: flex-start;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(124,106,247,0.18);
		border: 1px solid rgba(124,106,247,0.45);
		border-radius: 10px;
		color: #c8c0f8;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.55rem 1.2rem;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s;
	}
	.submit-btn:hover:not(:disabled) {
		background: rgba(124,106,247,0.28);
		border-color: rgba(124,106,247,0.7);
	}
	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Pipeline ─────────────────────────────────────────────────────── */
	.pipeline {
		margin-top: 1rem;
		background: rgba(14, 14, 28, 0.7);
		border: 1px solid rgba(124,106,247,0.18);
		border-radius: 14px;
		padding: 1rem 1.25rem;
	}

	.pipeline-header {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 0.9rem;
	}

	.pipeline-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #c8c0f8;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.pipeline-input {
		font-size: 0.78rem;
		color: #5a5a7a;
		font-family: 'Courier New', monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.steps {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.step {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.55rem 0.75rem;
		border-radius: 8px;
		background: rgba(255,255,255,0.02);
		border: 1px solid transparent;
		transition: border-color 0.2s;
	}

	.step-done {
		border-color: rgba(84,214,106,0.2);
		background: rgba(84,214,106,0.04);
	}
	.step-error {
		border-color: rgba(220,60,60,0.25);
		background: rgba(220,60,60,0.04);
	}
	.step-running {
		border-color: rgba(124,106,247,0.3);
		background: rgba(124,106,247,0.06);
	}

	.step-icon {
		font-size: 1rem;
		width: 1.2rem;
		flex-shrink: 0;
		text-align: center;
	}
	.step-done .step-icon { color: #54d66a; }
	.step-error .step-icon { color: #e05555; }
	.step-running .step-icon {
		color: #a89df7;
		animation: spin 1s linear infinite;
	}

	.step-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.step-label {
		font-size: 0.87rem;
		font-weight: 500;
		color: #d0d0e8;
	}

	.step-msg {
		font-size: 0.78rem;
		color: #6a6a8a;
	}

	.status-icon { font-size: 1rem; }
	.status-icon.done { color: #54d66a; }
	.status-icon.error { color: #e05555; }

	.pipeline-success {
		margin-top: 0.75rem;
		font-size: 0.87rem;
		color: #54d66a;
	}
	.pipeline-error {
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #e05555;
		background: rgba(220,60,60,0.06);
		border: 1px solid rgba(220,60,60,0.2);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
	}

	/* ── Library ──────────────────────────────────────────────────────── */
	.wt-list {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.wt-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(20, 20, 36, 0.65);
		border: 1px solid rgba(124,106,247,0.1);
		border-radius: 12px;
		padding: 0.75rem 1rem;
	}

	.wt-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.wt-game {
		font-weight: 600;
		font-size: 0.95rem;
		color: #e8e8f0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wt-game:hover { color: #a89df7; }

	.wt-title {
		font-size: 0.8rem;
		color: #8888aa;
	}

	.wt-author {
		font-size: 0.75rem;
		color: #555577;
	}

	.wt-devices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.device-badge {
		font-size: 0.72rem;
		background: rgba(84,214,106,0.08);
		border: 1px solid rgba(84,214,106,0.2);
		color: #54d66a;
		border-radius: 20px;
		padding: 0.15rem 0.55rem;
		white-space: nowrap;
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.no-device {
		font-size: 0.75rem;
		color: #444466;
		font-style: italic;
	}

	/* ── Devices ──────────────────────────────────────────────────────── */
	.device-list {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.device-card {
		background: rgba(20, 20, 36, 0.65);
		border: 1px solid rgba(124,106,247,0.1);
		border-radius: 12px;
		padding: 0.85rem 1.1rem;
	}

	.device-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.device-id {
		font-weight: 600;
		font-size: 0.92rem;
		color: #d0d0e8;
	}

	.device-seen {
		font-size: 0.75rem;
		color: #555577;
		margin-left: auto;
	}

	.device-wts {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-left: 1.5rem;
	}

	.device-section-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #555577;
		margin: 0.45rem 0 0.2rem;
	}

	.device-wts li::before {
		content: '·';
		margin-right: 0.4rem;
		color: #444466;
	}

	.device-wt-link {
		font-size: 0.82rem;
		color: #8888aa;
		transition: color 0.15s;
	}
	.device-wt-link:hover { color: #a89df7; }

	.wt-link {
		color: #a89df7;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* ── History ──────────────────────────────────────────────────────── */
	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.history-item {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		background: rgba(16, 16, 30, 0.55);
		border: 1px solid rgba(255,255,255,0.04);
		border-radius: 10px;
		padding: 0.55rem 0.85rem;
	}

	.history-done { border-color: rgba(84,214,106,0.15); }
	.history-error { border-color: rgba(220,60,60,0.15); }
	.history-running { border-color: rgba(124,106,247,0.2); }

	.history-icon {
		font-size: 0.9rem;
		width: 1rem;
		flex-shrink: 0;
		text-align: center;
		margin-top: 1px;
	}
	.history-done .history-icon { color: #54d66a; }
	.history-error .history-icon { color: #e05555; }
	.history-running .history-icon {
		color: #a89df7;
		animation: spin 1s linear infinite;
	}

	.history-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.history-input {
		font-size: 0.82rem;
		color: #d0d0e8;
		font-family: 'Courier New', monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-meta {
		font-size: 0.75rem;
		color: #555577;
	}

	.empty-msg {
		font-size: 0.88rem;
		color: #444466;
		font-style: italic;
	}

	/* ── Spinners ─────────────────────────────────────────────────────── */
	.spinner,
	.spinner-sm {
		display: inline-block;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	.spinner { width: 0.85rem; height: 0.85rem; }
	.spinner-sm { width: 0.75rem; height: 0.75rem; }

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner, .spinner-sm, .history-running .history-icon, .step-running .step-icon {
			animation: none;
		}
	}
</style>
