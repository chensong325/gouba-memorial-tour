# 一盏马灯·照亮苟坝

苟坝会议数字导览网站。游客点亮开场马灯后，跟随虚拟导览员「灯灯」沿五站游线参观：苟坝会议陈列馆、苟坝会议会址、真理小道、红军马灯馆·长五间、花茂村方向。

网站是纯静态单页应用，无框架、无 CDN、无后端，可直接部署到 GitHub Pages、Netlify、Vercel、Nginx 或任意静态网站空间。

## 功能

- 开屏点亮马灯，选择研学或亲子讲解模式。
- 五站手绘游线地图，灯灯与暖光随站点移动。
- 长按地图 0.4 秒提起马灯，可拖动光束探索地图。
- 双模式解说、史实档案、现场图片灯箱与互动问答。
- 五站马灯徽章、首次答题计分、导览评级与 PNG 纪念卡。
- 浏览器实时合成音效、系统中文语音朗读。
- 预设问答「问灯灯」，本地回答；预留未来大模型适配接口。
- 响应式手机、平板、桌面布局，支持键盘左右方向键切换站点。
- 进度保存在浏览器本机，支持站点深链，如 `#station-3`。

## 本地预览

由于页面使用 ES Modules，建议通过本地 HTTP 服务预览，不要直接双击 `index.html`。

```powershell
cd "C:\Users\Administrator\Desktop\苟坝会议会址"
python -m http.server 4173
```

打开 `http://127.0.0.1:4173/`。

如果系统中没有 `python`，任选一种静态服务器即可，例如 VS Code Live Server、Node `serve` 或 Nginx。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个空仓库。
2. 将本目录全部文件上传到仓库根目录：
   - `index.html`
   - `assets/`
   - `README.md`
   - `.nojekyll`
   - 原始文档 `苟坝会议会址.docx` 可上传，也可不放到公开仓库。
3. 进入仓库 `Settings` → `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. 分支选择 `main`，目录选择 `/ (root)`，保存。
6. 等待 GitHub Pages 构建完成，即可获得类似 `https://用户名.github.io/仓库名/` 的公开链接。

项目内所有资源均使用相对路径，因此部署在仓库子路径下也能正常加载。`.nojekyll` 用于避免 GitHub Pages 对静态资源做 Jekyll 处理。

## 部署到其他静态空间

直接把整个目录上传到静态网站根目录即可，无需安装依赖或执行构建。

- Netlify：将目录拖入 Netlify Drop，或将仓库连接到 Netlify。
- Vercel：作为静态项目导入，Framework Preset 选择 Other。
- Nginx/Apache：将目录放入站点根目录，确保 `.webp` 图片以静态文件方式访问。
- 宝塔面板：新建静态 HTML 站点后上传目录内容。

## 目录结构

```text
index.html              页面结构与 SVG 图形
assets/css/styles.css   视觉样式、光照效果和响应式布局
assets/js/data.js       五站文案、史实档案、问答题库、服务信息
assets/js/guide-service.js  预设问答与 AI 适配接口
assets/js/app.js        交互、状态、地图、语音、纪念卡逻辑
assets/images/          从原始文档提取并优化的 WebP 图片
assets/icons/lantern.svg    网站图标
.nojekyll               GitHub Pages 配置
```

## 修改内容

站点主要内容集中在 `assets/js/data.js`：

- `stations`：五站标题、地图坐标、两种解说词、史实档案、图片和问答。
- `services`：交通、票务、电话、美食与体验信息。
- `faqs`：灯灯预设问答及关键词。
- `ratings`：纪念评级规则。

修改图片时，建议在 `assets/images/` 中保留 `-640.webp` 和 `-1280.webp` 两种尺寸，并在 `data.js` 中只写不带尺寸后缀的路径。

## 预留 AI 接口

当前问答完全在浏览器本地完成，不发送网络请求。未来可调用：

```js
window.GoubaGuide.setAdapter(async ({ question, stationId, mode }) => {
  return {
    answer: '由后端或大模型返回的受史料约束的回答',
    source: '馆方材料或知识库出处'
  };
});
```

适配器应由自己的后端代理调用模型，不要把 API 密钥写进前端文件。

## 本地数据与隐私

- 进度保存在 `localStorage` 的 `gouba-tour-v1` 键中。
- 保存内容仅包括模式、到访站点、首次答题结果、昵称和声音偏好。
- 不上传个人信息；语音朗读由设备浏览器提供。
- 服务信息以景区当日公告为准，咨询电话：0851-27481935。

## 内容说明

- 研学模式沿用原始文档附录解说词。
- 亲子模式在不改变史实骨架的前提下做通俗化表达。
- 「灯灯」是虚构数字导览员，不是历史人物。
- 地图为手绘示意图，不作为实际导航依据。
- 历史内容依据馆方提供材料整理，不虚构人物对白或外部出处。