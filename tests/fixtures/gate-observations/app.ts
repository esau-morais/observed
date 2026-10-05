let painted = 0;
function paint() {
  painted += 1;
  document.body.style.backgroundColor = painted === 1 ? '#fafafa' : '#dcf0ff';
  const description = document.querySelector('#description');
  if (description === null) {
    throw new Error('Missing description');
  }

  description.textContent = `Paint ${painted}`;
}

const repetitions = 1;
const button = document.querySelector('button');
const result = document.querySelector('#result');
if (button === null || result === null) {
  throw new Error('Missing elements');
}

button.addEventListener('click', () => {
  for (let index = 0; index < repetitions; index += 1) {
    paint();
  }

  fetch('/api/items')
    .then(() => {
      result.textContent = 'Items loaded';
      document.body.dataset.done = 'true';
    })
    .catch(console.error);
});
