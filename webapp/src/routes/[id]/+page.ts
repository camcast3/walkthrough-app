import { fetchWalkthrough } from '$lib/sync.js';
import type { PageLoad } from './$types.js';
import type { Walkthrough } from '$lib/types.js';
import { error } from '@sveltejs/kit';

export const load: PageLoad = async ({ params }) => {
	const [walkthroughResult, configResult, checkoutsResult] = await Promise.allSettled([
		fetchWalkthrough(params.id) as Promise<Walkthrough>,
		fetch('/api/config').then((r) => (r.ok ? r.json() : {})),
		fetch('/api/checkouts').then((r) => (r.ok ? r.json() : []))
	]);

	if (walkthroughResult.status === 'rejected') {
		error(404, `Walkthrough "${params.id}" not found.`);
	}

	const config =
		configResult.status === 'fulfilled'
			? (configResult.value as { appMode?: string })
			: {};
	const checkedOutIds =
		checkoutsResult.status === 'fulfilled' ? (checkoutsResult.value as string[]) : [];

	return {
		walkthrough: walkthroughResult.value,
		appMode: config.appMode ?? '',
		isCheckedOut: checkedOutIds.includes(params.id)
	};
};
