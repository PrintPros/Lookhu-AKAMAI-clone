const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('FastFasts')) {
    content = content.replace(/FastFasts/g, 'FasterFasts');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated ' + filePath);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'public') {
        walkDir(filePath);
      }
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.json')) {
        replaceInFile(filePath);
      }
    }
  }
}

walkDir('.');
console.log('Done');
