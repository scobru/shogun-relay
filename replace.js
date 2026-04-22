const fs = require('fs');
const path = require('path');

const dirPath = __dirname;
const excludeDirs = ['node_modules', '.git', 'radata', 'data', 'dist', 'build', '.Jules', '.cursor', 'coverage'];

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        if (excludeDirs.includes(file)) return;
        file = path.resolve(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            results.push(file);
        }
    });
    return results;
}

const files = walk(dirPath);

files.forEach(file => {
    if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.html') || file.endsWith('.yml') || file.endsWith('.env') || file.endsWith('.sh') || file.endsWith('Dockerfile') || file === 'env.example') {
        let content = fs.readFileSync(file, 'utf8');
        let newContent = content
            .replace(/DELAY/g, 'DELAY')
            .replace(/Delay/g, 'Delay')
            .replace(/@shogun\/relay-sdk/g, '@delay/sdk')
            .replace(/delay/g, 'delay')
            .replace(/shogun\/relays/g, 'delay/relays')
            .replace(/"shogun",\s*"relay"/g, '"delay", "decentralized-relay"')
            .replace(/Delay/g, 'Delay');
        
        if (content !== newContent) {
            fs.writeFileSync(file, newContent, 'utf8');
            console.log(`Updated ${file}`);
        }
    }
});
