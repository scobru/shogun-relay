// remove ./radata and ./gun-data and ./uploads

import fs from 'fs';
import path from 'path';




const removeDir = (dir) => {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`Removed ${dir}`);
    } else {
        console.log(`${dir} does not exist`);
    }
}

removeDir('./radata');
removeDir('./uploads');
