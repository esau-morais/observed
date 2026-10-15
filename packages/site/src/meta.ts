export const siteUrl = 'https://observed.software';
export const docsUrl = 'https://docs.observed.software';
export const repoUrl = 'https://github.com/esau-morais/observed';

const title = 'Observed';
const description =
  "Run any coding agent and see what its change actually did to your app, with evidence a model can't fake.";

export const meta = [
  { charSet: 'utf-8' },
  { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  { title },
  { name: 'description', content: description },
  { name: 'theme-color', content: '#eceef1' },
  { property: 'og:title', content: title },
  { property: 'og:description', content: description },
  { property: 'og:url', content: siteUrl },
  { property: 'og:image', content: `${siteUrl}/og.png` },
  { property: 'og:image:width', content: '1200' },
  { property: 'og:image:height', content: '630' },
  { property: 'og:type', content: 'website' },
  { name: 'twitter:card', content: 'summary_large_image' },
];
