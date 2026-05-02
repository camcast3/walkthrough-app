import { fetchWalkthroughs, fetchIngestJobs, fetchDevices } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
	const [configResult, walkthroughsResult, jobsResult, devicesResult] = await Promise.allSettled([
		fetch('/api/config').then((r) => (r.ok ? r.json() : {})),
		fetchWalkthroughs(),
		fetchIngestJobs(),
		fetchDevices()
	]);

	const config =
		configResult.status === 'fulfilled'
			? (configResult.value as { appMode?: string })
			: {};
	const walkthroughs =
		walkthroughsResult.status === 'fulfilled' ? walkthroughsResult.value : [];
	const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
	const devices = devicesResult.status === 'fulfilled' ? devicesResult.value : [];

	return {
		appMode: (config.appMode as string) ?? '',
		walkthroughs,
		jobs,
		devices
	};
};
