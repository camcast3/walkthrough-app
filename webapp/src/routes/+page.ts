import { fetchWalkthroughs, fetchCheckouts } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
	const [walkthroughsResult, configResult, checkoutsResult] = await Promise.allSettled([
		fetchWalkthroughs(),
		fetch('/api/config').then((r) => (r.ok ? r.json() : {})),
		fetchCheckouts()
	]);

	const walkthroughs =
		walkthroughsResult.status === 'fulfilled' ? walkthroughsResult.value : [];
	const config =
		configResult.status === 'fulfilled'
			? (configResult.value as { appMode?: string })
			: {};
	const checkedOutIds =
		checkoutsResult.status === 'fulfilled' ? checkoutsResult.value : [];

	return {
		walkthroughs,
		error:
			walkthroughs.length === 0 && walkthroughsResult.status === 'rejected'
				? 'Could not load walkthroughs — showing cached content if available.'
				: null,
		appMode: (config.appMode as string) ?? '',
		checkedOutIds: checkedOutIds as string[]
	};
};
