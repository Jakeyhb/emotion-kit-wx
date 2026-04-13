/**
 * Mirrors WeChat DevTools "构建 npm" for @vant/weapp: copies package.json
 * "miniprogram" (lib) into miniprogram_npm so @vant/weapp/... paths resolve.
 */
const fs = require("fs");
const path = require("path");

const miniprogramRoot = path.join(__dirname, "..");
const src = path.join(miniprogramRoot, "node_modules", "@vant", "weapp", "lib");
const dest = path.join(miniprogramRoot, "miniprogram_npm", "@vant", "weapp");

if (!fs.existsSync(src)) {
  console.warn(
    "[pack-vant-npm] skip: node_modules/@vant/weapp/lib not found (run npm install in miniprogram/)"
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log("[pack-vant-npm] synced @vant/weapp -> miniprogram_npm/@vant/weapp");

/** 协议相对字体 url(//at.alicdn…) 在小程序里常被当成 http，导致 ERR_CACHE_MISS / 加载失败，强制改为 https */
function patchAlicdnFontUrls(rootDir) {
  const wxssFiles = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".wxss")) wxssFiles.push(p);
    }
  };
  walk(rootDir);
  let patched = 0;
  for (const f of wxssFiles) {
    const s = fs.readFileSync(f, "utf8");
    const next = s.replace(/url\(\/\/at\.alicdn\.com/g, "url(https://at.alicdn.com");
    if (next !== s) {
      fs.writeFileSync(f, next, "utf8");
      patched++;
      console.log(
        "[pack-vant-npm] fixed font CDN scheme:",
        path.relative(miniprogramRoot, f)
      );
    }
  }
  if (patched === 0) {
    console.log("[pack-vant-npm] no //at.alicdn.com font urls to patch (ok)");
  }
}
patchAlicdnFontUrls(dest);
