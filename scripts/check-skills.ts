import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const section = /^## Skills\n([\s\S]*?)(?=^## )/m.exec(read('AGENTS.md'))?.[1] ?? '';
const listed = section
  .split('\n')
  .filter((line) => line.startsWith('- '))
  .flatMap(
    (line) =>
      line
        .slice(2)
        .split(':')[0]
        ?.split(/, | and /) ?? [],
  );

const locked = Object.keys((JSON.parse(read('skills-lock.json')) as { skills: object }).skills);
const installed = readdirSync(join(root, '.agents/skills'));

const problems = [
  ...(listed.length === 0 ? ['AGENTS.md lists no skills under "## Skills"'] : []),
  ...[...new Set([...listed, ...locked])].flatMap((name) =>
    ['.agents/skills', '.claude/skills']
      .map((dir) => join(dir, name, 'SKILL.md'))
      .filter((path) => !existsSync(join(root, path)))
      .map((path) => `${path} is missing`),
  ),
  ...installed
    .filter((name) => !listed.includes(name))
    .map((name) => `.agents/skills/${name} is not listed in AGENTS.md`),
];

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${String(listed.length)} skills present in .agents/skills and .claude/skills`);
