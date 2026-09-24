import { requestItems, type Item } from './items';

export const title = 'Item collection';

export async function loadItems(): Promise<readonly Item[]> {
  return requestItems();
}
