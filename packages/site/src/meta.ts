export const siteUrl = 'https://observed.software';

const title = 'Observed';
const description =
  "Run any coding agent and see what its change actually did to your app, with evidence a model can't fake.";

export const meta = [
  { charSet: 'utf-8' },
  { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  { title },
  { name: 'description', content: description },
  { property: 'og:title', content: title },
  { property: 'og:description', content: description },
  { property: 'og:url', content: siteUrl },
  { property: 'og:image', content: `${siteUrl}/og.png` },
  { property: 'og:image:width', content: '1200' },
  { property: 'og:image:height', content: '630' },
  { name: 'twitter:card', content: 'summary_large_image' },
];
