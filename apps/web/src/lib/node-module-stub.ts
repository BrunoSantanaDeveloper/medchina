/**
 * An empty module that stands in for a Node built-in inside the CLIENT bundle.
 *
 * `pptxgenjs` (the .pptx export at `/palestra/exportar`) ships one build for
 * both runtimes and reaches for `node:fs` / `node:https` through DYNAMIC
 * imports on its Node-only paths — writing a file to disk, fetching a remote
 * image. In the browser it writes through a Blob and never walks them, but
 * webpack still has to build the graph, and it cannot read a `node:` URL:
 * `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`.
 *
 * `next.config.mjs` points those two specifiers here for the client build. The
 * shapes below are the ones the library destructures (`{ default: fs }` and
 * `{ promises: fs }`), so a path taken by mistake fails as a plain undefined
 * function instead of a confusing module error.
 */
export const promises = {};

export default {};
