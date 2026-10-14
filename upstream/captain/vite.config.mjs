import { createLogger, defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, 'dist');

/* scripts/build-version.js is CommonJS and shared with the native builds,
   which are plain node scripts. One copy, read from both. */
const require = createRequire(import.meta.url);

// Application scripts intentionally remain classic scripts because they share
// browser globals. copyClassicAssets() packages them unchanged for web/APK.
// Hide only Vite's module-conversion warning; all other warnings still surface.
const logger = createLogger();
const defaultWarn = logger.warn.bind(logger);
logger.warn = (message, options) => {
  if (String(message).includes('can\'t be bundled without type="module" attribute')) return;
  defaultWarn(message, options);
};

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyIfMissing(src, dest) {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

function ensureImageFallbacks(imagesDest) {
  copyIfMissing(
    path.join(imagesDest, 'default-product.png'),
    path.join(imagesDest, 'placeholder.png')
  );
  copyIfMissing(
    path.join(imagesDest, 'home.png'),
    path.join(imagesDest, 'banner.jpg')
  );
}

function copyClassicAssets() {
  return {
    name: 'copy-classic-assets',
    closeBundle() {
      const excludeDirs = new Set(['node_modules', '.git', '.vite', 'dist', 'android']);

      function walk(dir, rel = '') {
        for (const item of fs.readdirSync(dir)) {
          if (excludeDirs.has(item)) continue;
          const abs = path.join(dir, item);
          const relPath = rel ? `${rel}/${item}` : item;

          if (fs.statSync(abs).isDirectory()) {
            walk(abs, relPath);
          } else if (item.endsWith('.js')) {
            const dest = path.join(DIST, relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(abs, dest);
          }
        }
      }

      // Only application code belongs in the installable bundle. Tests,
      // build helpers and superseded presentations stay in the repository.
      walk(path.join(ROOT, 'assets'), 'assets');
      for (const entry of ['config.js', 'indexedDB.js']) {
        fs.copyFileSync(path.join(ROOT, entry), path.join(DIST, entry));
      }

      const imagesDir = path.join(ROOT, 'images');
      const rootImages = path.join(DIST, 'images');
      const assetImages = path.join(DIST, 'assets', 'images');
      copyDir(imagesDir, rootImages);
      copyDir(imagesDir, assetImages);
      ensureImageFallbacks(rootImages);
      ensureImageFallbacks(assetImages);

      /*
       * AND THE CACHE BUSTERS, written here rather than typed into the pages.
       *
       * They used to be literals: indexedDB.js?v=5 on six screens and ?v=6 on
       * a seventh. One file behind two query strings is two entries in the
       * WebView's cache, and after an update one screen can go on serving what
       * it cached while the screen beside it gets the new copy.
       *
       * Last, because it rewrites the HTML this build has just finished
       * emitting, and the classic assets above have to be in place first.
       */
      const stamp = require('./scripts/build-version');
      stamp.stampBundle(DIST, {version:stamp.resolveVersion(ROOT), commit:stamp.resolveCommit(ROOT), at:new Date().toISOString()});
      const marked = stamp.stampAssetLinks(DIST, stamp.resolveVersion(ROOT));
      if (marked) logger.info(`Stamped the scripts on ${marked} pages.`);
      for (const legacyName of ['home.png', 'default-store.png', 'default-product.png']) {
        fs.rmSync(path.join(rootImages, legacyName), { force: true });
        fs.rmSync(path.join(assetImages, legacyName), { force: true });
      }
    }
  };
}

export default defineConfig({
  root: ROOT,
  customLogger: logger,
  build: {
    outDir: DIST,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(ROOT, 'index.html'),
        products: path.resolve(ROOT, 'products.html'),
        cart: path.resolve(ROOT, 'cart.html'),
        discount: path.resolve(ROOT, 'discount.html'),
        'kot-management': path.resolve(ROOT, 'kot-management.html'),
        'order-history': path.resolve(ROOT, 'order-history.html'),
        thankyou: path.resolve(ROOT, 'thankyou.html'),
        'access-denied': path.resolve(ROOT, 'access-denied.html'),
        'number-card': path.resolve(ROOT, 'number-card.html'),
        me: path.resolve(ROOT, 'me.html'),
        kitchenMessage: path.resolve(ROOT, 'kitchen-message.html'),
        help: path.resolve(ROOT, 'help.html'),
        tables: path.resolve(ROOT, 'tables.html'),
        pending: path.resolve(ROOT, 'pending.html'),
        paymentSettings: path.resolve(ROOT, 'payment-settings.html'),
        branchDetails: path.resolve(ROOT, 'branch-details.html'),
        'my-sales': path.resolve(ROOT, 'my-sales.html')
      }
    }
  },
  plugins: [copyClassicAssets(), {
    name: 'fresh-captain-preview',
    apply: 'serve',
    handleHotUpdate(context) {
      // These app scripts are classic scripts, outside Vite's module graph.
      if (context.file.endsWith('.js') && !context.file.includes('node_modules')) {
        context.server.ws.send({type:'custom',event:'captain:preview-updated'});
      }
    },
    transformIndexHtml(html, context) {
      if (!['/kot-management.html','/cart.html'].some(page=>context.path.endsWith(page))) return html;
      return {html, tags:[{tag:'script',attrs:{type:'module'},injectTo:'head',children:`
        import { createHotContext } from '/@vite/client';
        const previewHot = createHotContext('/captain-preview-updates');
        previewHot.on('captain:preview-updated', () => {
          if(document.getElementById('captain-preview-update')) return;
          const button=document.createElement('button');
          button.id='captain-preview-update';button.type='button';
          button.textContent='Preview updated · Reload';
          button.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border:1px solid #2458db;border-radius:12px;background:#fff;color:#183f9f;font:600 14px system-ui;box-shadow:0 4px 20px #17233533';
          button.onclick=()=>{
            if (window.InlineOrderEditor?.active || document.querySelector('.modal.show,dialog[open],#cart-notes-modal[style*=flex]')) {
              button.textContent='Finish or close the open edit, then reload';return;
            }
            window.location.reload();
          };
          document.body.append(button);
        });
      `},{tag:'script', injectTo:'head', children:`
        window.addEventListener('pageshow', function(event) {
          if (!event.persisted) return;
          // Keep in-memory drafts and open dialogs intact. Plain floor views
          // restored by browser Back should use the files currently served.
          if (window.InlineOrderEditor?.active || document.querySelector('.modal.show,dialog[open],#item-picker:not([hidden])')) return;
          window.location.reload();
        });
      `}]};
    }
  }],
  server: {
    port: 5173,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
    open: '/index.html'
  }
});
