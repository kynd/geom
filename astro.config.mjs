import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  site: 'https://kynd.github.io',
  base: '/geom',
  output: 'static',
  build: {
    assets: 'assets',
  },
  devToolbar: {
    enabled: false,
  },
});
