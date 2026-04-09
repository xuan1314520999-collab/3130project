const CACHE_NAME = 'school-finder-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './data.json'
];

// 安装时缓存文件
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// 拦截请求：优先从缓存读取，实现离线功能
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});