import type { SnippetInput } from '../../../shared/api.ts';

// The preview wraps these in its own document, so HTML is a body fragment.
export const DEFAULT_SNIPPET: SnippetInput = {
  title: '',
  html: `<main>
  <h1>Hello, BinCode!</h1>
  <p>Edit the HTML, CSS and JavaScript tabs to see the preview update live.</p>
  <button id="greet">Click me</button>
</main>
`,
  css: `body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
  line-height: 1.5;
}

h1 {
  color: #2fb47c;
}
`,
  js: `document.getElementById('greet').addEventListener('click', () => {
  console.log('Hello from BinCode');
  alert('Hello!');
});
`,
};
