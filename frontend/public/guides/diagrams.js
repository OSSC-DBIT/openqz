// Draws the flow diagrams in the user guides (CSP allows only same-origin scripts, so this is a file).
/* global mermaid */
mermaid.initialize({
  startOnLoad: true,
  securityLevel: 'strict',
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
});
