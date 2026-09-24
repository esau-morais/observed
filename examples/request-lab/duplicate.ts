import { requestItems, type Item } from './items';

export const title = 'Request lab';

export async function loadItems(): Promise<readonly Item[]> {
  const [first, second] = await Promise.allSettled([
    requestItems(),
    requestItems(),
  ]);

  if (first.status === 'rejected') {
    throw first.reason;
  }

  if (second.status === 'rejected') {
    throw second.reason;
  }

  return first.value;
}
