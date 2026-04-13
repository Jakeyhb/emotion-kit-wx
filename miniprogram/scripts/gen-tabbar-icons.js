/**
 * 将 tabBar 的 SVG 图标转为 81x81 PNG
 * 运行: npm run gen-icons（需先 npm install）
 */
const fs = require('fs');
const path = require('path');

const SIZE = 81;
const ICONS_DIR = path.join(__dirname, '..', 'images', 'icons');
const PAIRS = [
  ['mood', 'mood-active'],
  ['calm', 'calm-active'],
  ['mine', 'mine-active']
];

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error('请先安装 sharp: npm install --save-dev sharp');
    process.exit(1);
  }

  for (const [base, active] of PAIRS) {
    for (const name of [base, active]) {
      const svgPath = path.join(ICONS_DIR, `${name}.svg`);
      const pngPath = path.join(ICONS_DIR, `${name}.png`);
      if (!fs.existsSync(svgPath)) {
        console.warn('跳过（无 SVG）:', svgPath);
        continue;
      }
      try {
        await sharp(svgPath).resize(SIZE, SIZE).png().toFile(pngPath);
        console.log('生成:', pngPath);
      } catch (err) {
        console.error('失败:', svgPath, err.message);
      }
    }
  }
  console.log('tabBar 图标 PNG 生成完成。');
}

main();
