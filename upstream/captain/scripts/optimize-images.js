const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const imageDir = path.join(root, 'images');
const images = ['home.png', 'default-store.png', 'default-product.png'];

async function main() {
  for (const fileName of images) {
    const source = path.join(imageDir, fileName);
    const destination = path.join(imageDir, fileName.replace(/\.png$/i, '.webp'));
    if (!fs.existsSync(source)) throw new Error(`Missing source image: ${source}`);

    await sharp(source)
      .webp({ quality: 82, effort: 5 })
      .toFile(destination);

    const before = fs.statSync(source).size;
    const after = fs.statSync(destination).size;
    console.log(`${fileName}: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
