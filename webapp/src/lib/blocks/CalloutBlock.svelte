<script lang="ts">
	import type { CalloutBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block }: { block: CalloutBlock } = $props();

	const SEVERITY_CONFIG: Record<string, { icon: string; cls: string }> = {
		info: { icon: 'ℹ', cls: 'severity-info' },
		warning: { icon: '⚠', cls: 'severity-warning' },
		danger: { icon: '🚨', cls: 'severity-danger' }
	};

	const config = $derived(SEVERITY_CONFIG[block.severity ?? 'info'] ?? SEVERITY_CONFIG.info);
	const html = $derived(marked.parseInline(block.content));
</script>

<div class="callout-block {config.cls}" role="note">
	<span class="callout-icon" aria-hidden="true">{config.icon}</span>
	<div class="callout-content">{@html html}</div>
</div>

<style>
	.callout-block {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		margin: 0.75rem 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.callout-block.severity-info {
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		color: #93c5fd;
	}
	.callout-block.severity-warning {
		background: rgba(234, 179, 8, 0.1);
		border: 1px solid rgba(234, 179, 8, 0.3);
		color: #fde047;
	}
	.callout-block.severity-danger {
		background: rgba(220, 38, 38, 0.1);
		border: 1px solid rgba(220, 38, 38, 0.3);
		color: #fca5a5;
	}
	.callout-icon {
		font-size: 1.1rem;
		flex-shrink: 0;
		margin-top: 0.05rem;
	}
	.callout-content {
		flex: 1;
	}
</style>
