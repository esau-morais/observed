declare module 'fixture-variant' {
  export const title: string;

  export function loadItems(): Promise<readonly import('./items').Item[]>;
}
