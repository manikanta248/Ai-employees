import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCss } from './tokens';

const target = fileURLToPath(new URL('./tokens.css', import.meta.url));
writeFileSync(target, buildCss());
console.warn(`wrote ${target}`);
