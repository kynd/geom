import { defineConfig } from 'astro/config';

export default defineConfig({
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
