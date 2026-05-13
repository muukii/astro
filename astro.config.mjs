// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const githubPagesSite = process.env.GITHUB_REPOSITORY_OWNER
  ? `https://${process.env.GITHUB_REPOSITORY_OWNER}.github.io`
  : undefined;

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL || (isGitHubActions ? githubPagesSite : undefined),
  base: process.env.ASTRO_BASE || (isGitHubActions && repositoryName ? `/${repositoryName}` : '/'),
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
  },
});