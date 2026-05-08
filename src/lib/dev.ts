/**
 * Verbose logging gated to dev builds. Vite replaces `import.meta.env.DEV`
 * with a literal `false` in production, so the call site is dead-code-
 * eliminated and never serializes its arguments.
 */
export const devLog = import.meta.env.DEV ? console.log.bind(console, "%c[vibe]", "color:#53a9ff") : () => {};
export const devWarn = import.meta.env.DEV ? console.warn.bind(console, "[vibe]") : () => {};
