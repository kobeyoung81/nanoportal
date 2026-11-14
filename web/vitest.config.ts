import { defineConfig } from 'vitest/config'

// Most tests cover pure logic only (tab matching, transcript merging, sizing
// helpers): no DOM, so the node environment is the default and they stay fast.
// A file that needs a real render opts in with `// @vitest-environment jsdom`
// (see portal/PluginPage.render.test.tsx, which pins the two update loops that
// only appear when React actually renders). `css: true` is only here so a test
// can import a stylesheet as text (`?raw`): without it vitest stubs every CSS
// import to an empty string, which is what the theme-token check reads.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    css: true,
  },
})
