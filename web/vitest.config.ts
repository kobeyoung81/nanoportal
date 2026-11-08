import { defineConfig } from 'vitest/config'

// Unit tests cover the pure logic only (tab matching, transcript merging, sizing
// helpers): no DOM and no component rendering, so the default node environment is
// enough and no extra dev dependencies are needed. `css: true` is only here so a
// test can import a stylesheet as text (`?raw`): without it vitest stubs every CSS
// import to an empty string, which is what the theme-token check reads.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    css: true,
  },
})
