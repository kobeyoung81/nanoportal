declare module 'postcss-media-minmax' {
  import type { Plugin } from 'postcss'
  const mediaMinmax: () => Plugin
  export default mediaMinmax
}
