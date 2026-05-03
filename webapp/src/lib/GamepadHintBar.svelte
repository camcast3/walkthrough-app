<script lang="ts">
	export interface Hint {
		badge: string;
		label: string;
	}

	let { hints }: { hints: Hint[] } = $props();
</script>

<div class="hint-bar" role="status" aria-label="Controller button hints">
	{#each hints as hint (hint.badge + hint.label)}
		<span class="hint-item">
			<span class="hint-badge">{hint.badge}</span>
			<span class="hint-label">{hint.label}</span>
		</span>
	{/each}
</div>

<style>
	.hint-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1.25rem;
		padding: 0.4rem 1rem;
		background: rgba(10, 10, 20, 0.88);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid rgba(124, 106, 247, 0.1);
		z-index: 50;
		flex-wrap: wrap;
	}

	:global(body[data-power-save]) .hint-bar {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.hint-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.hint-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.4rem;
		padding: 0 0.3rem;
		background: rgba(124, 106, 247, 0.15);
		border: 1px solid rgba(124, 106, 247, 0.35);
		border-radius: 5px;
		color: #a89df7;
		font-size: 0.68rem;
		font-weight: 700;
		font-family: 'Rajdhani', system-ui, sans-serif;
		letter-spacing: 0.3px;
		white-space: nowrap;
	}

	.hint-label {
		font-size: 0.7rem;
		color: #5a5a7a;
		white-space: nowrap;
	}
</style>
