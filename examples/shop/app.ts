const form = document.querySelector('form');
const input = document.querySelector('input');
const status = document.querySelector('[role="status"]');

if (form === null || input === null || status === null) {
  throw new Error('Shop markup is incomplete');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  fetch('/orders', {
    method: 'POST',
    body: JSON.stringify({ name: input.value }),
  })
    .then((response) => {
      if (response.status !== 201) {
        throw new Error('Order failed');
      }

      status.textContent = `Order received for ${input.value}`;
    })
    .catch(() => {
      status.textContent = 'Order failed';
    });
});

export {};
