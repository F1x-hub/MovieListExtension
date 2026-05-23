const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const distDir = path.join(__dirname, '..', 'dist');

async function processDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            await processDirectory(fullPath);
        } else if (fullPath.endsWith('.js') && !fullPath.endsWith('.min.js')) {
            console.log(`Minifying: ${fullPath.replace(distDir, '')}`);
            const code = fs.readFileSync(fullPath, 'utf8');
            const mapFileName = `${file}.map`;
            
            try {
                const result = await minify(code, {
                    sourceMap: {
                        filename: file,
                        url: mapFileName
                    },
                    compress: {
                        dead_code: true,
                        drop_console: false, // Keep consoles for now, or true to remove
                        unused: true
                    }
                });

                if (result.code) {
                    fs.writeFileSync(fullPath, result.code, 'utf8');
                }
                if (result.map) {
                    fs.writeFileSync(fullPath + '.map', result.map, 'utf8');
                }
            } catch (e) {
                console.error(`Error minifying ${fullPath}:`, e);
            }
        }
    }
}

processDirectory(distDir).then(() => {
    console.log('Minification complete.');
}).catch(console.error);
