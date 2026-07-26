/**
 * Builds the pre-configured workspace images from the Dockerfiles in /docker.
 * Run once during setup: `npm run seed:images`
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
