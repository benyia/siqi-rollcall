# 星星点名机

一个可直接部署到 Cloudflare Pages 的班级随机点名网站：

- 老师后台用密码登录，可新建、编辑、删除班级。
- 学生名单一行一个名字，粘贴后保存到 Cloudflare D1。
- 不设置班级人数硬上限，学生名单会分批写入 D1，80、200、400 人的班级都可使用。
- 打开首页先选班级，再直接点名。
- 支持不重复点名、速度切换、历史记录、音效和全屏。
- 无外部字体、图片和前端依赖，部署后所有资源由同一域名提供。

## 最终网址

- 点名页：`https://siqi.lovie.me/`
- 老师后台：`https://siqi.lovie.me/admin/`

## 方案选择

本项目选择 **Cloudflare Pages + Pages Functions + D1 + GitHub**。

选择原因：

- 不需要购买服务器，免费额度足够一个学校或几个班级使用。
- GitHub 推送后可以自动重新部署。
- 自带 HTTPS、静态资源全球加速和数据库。
- `siqi.lovie.me` 目前是独立的 LovieMe DNS 托管区，可以用 CNAME 接入 Cloudflare Pages，不需要先把整个 `lovie.me` 迁到 Cloudflare。

GitHub Pages 不适合这个需求：它只有静态文件，没有登录接口和数据库。

## 部署前准备

需要准备：

1. 一个 GitHub 账号。
2. 一个 Cloudflare 账号。
3. 本机安装 Node.js 18 或更高版本。
4. 当前项目目录：`F:\codex\output\siqi-rollcall`。

## 第一步：创建 D1 数据库

在 PowerShell 中进入项目目录：

```powershell
cd F:\codex\output\siqi-rollcall
npm install
npx wrangler login
npx wrangler d1 create siqi-rollcall --location apac --binding DB
```

`--location apac` 会把数据库主区域优先放在亚太，更适合国内课堂。`--binding DB` 必须和代码保持一致，不要改成 `siqi_rollcall`。

创建成功后会输出一段包含 `database_id` 的内容。打开 `wrangler.toml`，把：

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

替换成刚创建的数据库 ID。

如果数据库是在 WNAM（北美西部）创建且还没有数据，建议删除后按上面的亚太命令重建：

```powershell
npx wrangler d1 delete siqi-rollcall -y
npx wrangler d1 create siqi-rollcall --location apac --binding DB
```

重建后把新的 `database_id` 再填进 `wrangler.toml`。

然后初始化远程数据库：

```powershell
npm run db:migrate
```

命令会询问是否继续，输入 `y` 并回车。

## 第二步：推送到 GitHub

先在 GitHub 创建一个空仓库，例如 `siqi-rollcall`，不要勾选自动生成 README。

在项目目录执行：

```powershell
git init
git add .
git commit -m "Add classroom roll call"
git branch -M main
git remote add origin https://github.com/你的用户名/siqi-rollcall.git
git push -u origin main
```

`.dev.vars`、`.wrangler` 和 `node_modules` 已被 `.gitignore` 排除，不会上传。

## 第三步：创建 Cloudflare Pages 项目

1. 打开 Cloudflare 控制台。
2. 进入 **Workers & Pages**。
3. 点击 **Create application** → **Pages** → **Connect to Git**。
4. 选择刚推送的 GitHub 仓库。
5. 项目名称填：`siqi-rollcall`。
6. 生产分支选择：`main`。
7. Framework preset 选择：`None`。
8. Build command 留空。
9. Build output directory 填：`public`。
10. 保存并部署。

项目中的 `functions` 目录会被识别为 Pages Functions。

如果部署日志提示找不到 `DB` 绑定，打开：

**Pages 项目 → Settings → Bindings → Add → D1 database**

- Variable name：`DB`
- D1 database：选择 `siqi-rollcall`

保存后重新部署。

## 第四步：设置后台密码

进入：

**Pages 项目 → Settings → Variables and Secrets**

在生产环境中添加两个 **Secret**：

| 名称 | 值 |
| --- | --- |
| `ADMIN_PASSWORD` | 至少 16 位的强密码，不要用生日、姓名或 123456 |
| `SESSION_SECRET` | 至少 32 位的随机字符串，不要和后台密码相同 |

可以用 PowerShell 生成随机会话密钥：

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

添加完成后，在 Deployments 里重新部署一次，环境变量才会生效。

## 第五步：绑定自定义域名

先在 Cloudflare Pages 项目里：

1. 打开 **Custom domains**。
2. 点击 **Set up a custom domain**。
3. 输入：`siqi.lovie.me`。
4. 按提示继续，记下 Cloudflare 给出的 CNAME 目标，通常类似：

```text
siqi-rollcall.pages.dev
```

然后回到 LovieMe 的 `siqi.lovie.me` DNS 面板：

1. 删除现有的 A 记录：

```text
Type: A
Host: @
Value: 8.8.8.8
```

2. 删除后添加 Cloudflare Pages 预设。如果面板有 **1-Click Presets → Cloudflare Pages**，优先使用预设并填入 `siqi-rollcall.pages.dev`。

3. 如果手动添加，填写：

```text
Type: CNAME
Host: @
Content: siqi-rollcall.pages.dev
TTL: 3600 / Auto
Proxy: DNS only / 关闭代理
```

如果面板不允许在根域名填写 `@`，按面板提示留空或使用根域选项。

4. 如果 Cloudflare Pages 同时给出了 TXT 验证记录，按页面显示的名称和值原样添加。

5. 等 Pages 的 Custom domains 状态变成 **Active**，SSL 生效后访问：

```text
https://siqi.lovie.me/
```

不要同时保留旧的 A 记录和新的 CNAME。

## 第六步：添加第一个班级

打开：

```text
https://siqi.lovie.me/admin/
```

输入 `ADMIN_PASSWORD` 登录，然后：

1. 点击“新建班级”。
2. 填写班级名称和排序。
3. 粘贴学生名单，一行一个名字。
4. 点击“保存班级”。

保存后打开：

```text
https://siqi.lovie.me/
```

就能看到班级卡片并开始点名。

## 本地开发

复制环境变量示例：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```env
ADMIN_PASSWORD=本地测试密码
SESSION_SECRET=本地测试会话密钥至少三十二位字符
```

初始化本地数据库并启动：

```powershell
npm run db:migrate:local
npm run dev
```

打开 `http://127.0.0.1:8788/`。

## 手动重新部署

Cloudflare Pages 的 GitHub 连接断开时，项目仍然可以在线运行。修复 Git 连接之前，也可以在项目目录手动发布：

```powershell
npx wrangler pages deploy public --project-name siqi-rollcall --branch main
```

新增 `ADMIN_PASSWORD`、`SESSION_SECRET` 或修改 D1 绑定后，都必须重新部署一次，新的环境配置才会对线上生效。

## 国内访问说明

Cloudflare Pages 免费版会通过 Cloudflare 的海外边缘节点服务中国用户。项目已经做了以下优化：

- 不使用 Google Fonts、国外 CDN 或外部图片。
- 页面、CSS、JavaScript 和图标都由同一域名提供。
- API 和静态页面同域，不产生额外跨域连接。

但需要说明：**免费 Cloudflare 无法保证中国大陆所有地区、所有运营商都同样流畅**，偶尔可能出现晚高峰延迟或个别网络无法访问。

`siqi.lovie.me` 是免费二级域名，不能以你本人名义办理中国大陆 ICP 备案，因此不能直接使用阿里云、腾讯云等中国大陆节点做正规加速。如果以后必须做到国内稳定、低延迟，建议：

1. 购买自己的 `.com` 或 `.cn` 域名。
2. 完成 ICP 备案。
3. 将前端和 API 迁移到腾讯云 EdgeOne / 阿里云 ESA 等国内节点。

## 安全与隐私

- 后台 API 使用 HttpOnly、SameSite=Strict 的签名会话 Cookie。
- 修改接口会检查请求来源。
- 所有 SQL 都使用 D1 参数绑定，避免 SQL 注入。
- 学生名单接口是公开只读的，任何知道网址的人都能读取班级和姓名。不要公开敏感信息。
- `robots.txt` 禁止搜索引擎抓取。
- 建议使用 20 位以上随机后台密码，并定期更换。

## 目录结构

```text
siqi-rollcall/
├─ functions/api/[[path]].js   API、登录和 D1 查询
├─ migrations/0001_initial.sql 数据库表结构
├─ public/
│  ├─ index.html               班级选择与点名页
│  ├─ admin/index.html         老师后台
│  └─ assets/                  样式和脚本
├─ wrangler.toml               Cloudflare 配置
└─ package.json
```
