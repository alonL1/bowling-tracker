const fs = require('fs');
const path = require('path');

for (const folder of ['dist', 'web-build']) {
  fs.rmSync(path.join(__dirname, '..', folder), {
    recursive: true,
    force: true,
  });
}
