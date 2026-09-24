import { requestItems, type Item } from './items';

export const title = 'Request lab';

export async function loadItems(): Promise<readonly Item[]> {
  return requestItems();
}
