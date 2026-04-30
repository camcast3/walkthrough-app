# Walkthrough Checklist App

A touch and controller-optimized PWA for game walkthroughs. Works on Steam Deck, ROG Ally (Bazzite), and Windows PC. Syncs to k8s when online, works offline via service worker.

## Structure

- \`.github/copilot/skills/\` - Copilot walkthrough ingestion skill
- \`.github/workflows/\` - CI: schema validation + k8s deploy
- \`walkthroughs/\` - Curated walkthrough JSON files
- \`webapp/\` - SvelteKit PWA
- \`server/\` - Go sync server + k8s manifests
- \`docs/\` - Device setup guides
