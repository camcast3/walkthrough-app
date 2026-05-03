import { redirect } from '@sveltejs/kit';
import { fetchWalkthroughs, fetchCheckouts } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
	const configResult = await fetch('/api/config').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
	const config = configResult as { appMode?: string; online?: boolean };

	// In server app mode, the homepage is the library manager
	if (config.appMode === 'server') {
		redirect(307, '/server');
	}

	const [walkthroughsResult, checkoutsResult] = await Promise.allSettled([
		fetchWalkthroughs(),
		fetchCheckouts()
	]);

	const walkthroughs =
		walkthroughsResult.status === 'fulfilled' ? walkthroughsResult.value : [];
	const checkedOutIds =
		checkoutsResult.status === 'fulfilled' ? checkoutsResult.value : [];

	return {
		walkthroughs,
		error:
			walkthroughs.length === 0 && walkthroughsResult.status === 'rejected'
				? 'Could not load walkthroughs — showing cached content if available.'
				: null,
		appMode: (config.appMode as string) ?? '',
		// `online` is only meaningful in client mode; undefined/null in other modes.
		online: config.online ?? true,
		checkedOutIds: checkedOutIds as string[]
	};
};
