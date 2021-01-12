let fs = require('fs');
let json = require('./package.json');

let [major, minor, patch] = json.version.split('.');
patch++;
json.version = `${major}.${minor}.${patch}`;

fs.writeFile('package.json', JSON.stringify(json), 'utf8', () => {
    console.log("Patched", json.version);
});