/**
 * Builds the pre-configured workspace images locally on THIS Docker
 * host. Copy of backend/scripts/pullImages.js, kept here too because in
 * a multi-node setup every orchestrator host needs its own local copies
 * of the images - containers can't run on an image that only exists on
 * a different host. Run once per host during setup:
 *   node scripts/pullImages.js
 */
const { execSync } = require('child_process');
const path = require('path');

const dockerDir = path.join(__dirname, '..', '..', 'docker');

const images = [
  { tag: 'cloud-dev-base:latest', file: 'base.Dockerfile' },
  { tag: 'cloud-dev-node:latest', file: 'node.Dockerfile' },
  { tag: 'cloud-dev-python:latest', file: 'python.Dockerfile' },
];

for (const { tag, file } of images) {
  console.log(`\nBuilding ${tag} from ${file}...`);
  execSync(`docker build -t ${tag} -f ${path.join(dockerDir, file)} ${dockerDir}`, {
    stdio: 'inherit',
  });
}

console.log('\nAll images built successfully.');
