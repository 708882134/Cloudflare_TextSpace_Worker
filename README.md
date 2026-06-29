## ☁️ Cloudflare Text Disk_基于Cloudflare worker打造的文本直连网盘

基于 Cloudflare Workers + D1 (SQLite) 的轻量级纯文本云盘。支持文件夹管理、安全链接分享、多级缓存加速，内置带高亮查找/替换与原生撤销的编辑器。依托 Cloudflare 全球边缘网络，零服务器成本，开箱即用。

[<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/40px-YouTube_full-color_icon_%282017%29.svg.png" width="24"> 查看部署视频 重磅福利 | 拥抱Cloudflare 文本直链网盘 | 拒绝限流 | CDN加速 | 100%免费](https://www.youtube.com/watch?v=QZUx4pHf0J4)

![GitHub License](https://img.shields.io/github/license/yourusername/CF-Text-Cloud?style=flat-square)
![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare)
loudflare TextSpace Worker 的原生 macOS 客户端，SwiftUI 构建，界面风格参考 macOS「备忘录」。

## 功能

- 连接 Cloudflare Worker 文本云盘（Bearer 认证）
- 文件树浏览、文本/JSON 在线编辑、图片预览
- 新建文件 / 文件夹、右键分享 / 重命名 / 删除
- **拖拽**文件到文件夹移动
- 上传 JSON / JPG / PNG
- **自动同步**：MD5 增量备份到本地目录
- 连接状态、使用教程、保存提示

## 系统要求

- macOS 14.0+
- Xcode 15+（自行编译）

## ✨ 核心特性

| 特性               | 说明                                                  |
| ------------------ | ----------------------------------------------------- |
| 🚀 **边缘原生**     | 基于 Cloudflare Workers，全球节点就近响应，延迟极低   |
| 💾 **持久化存储**   | 使用 Cloudflare D1 (Serverless SQLite)，数据安全可靠  |
| ⚡ **三级缓存架构** | `Edge Cache API → KV → D1`，访客访问毫秒级加载        |
| 📁 **完整文件管理** | 树形目录展示、拖拽移动、重命名、删除、新建文件夹/文件 |
| 🔗 **安全分享机制** | 唯一 Token 绑定路径，支持自定义 Token，防越权访问     |
| 📱 **响应式 UI**    | 极简设计，完美适配桌面/平板/手机，支持侧边栏折叠      |
| 🆓 **零成本运行**   | 依托 Cloudflare 免费额度，个人/小团队完全够用         |

---

## 📦 部署前准备

1. 注册并登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 准备一个可用的域名（可选，默认使用 `*.workers.dev` 子域名）！！！免费的可以托管到CF的二级域名一大堆~
3. 生成一个安全的 `ADMIN_UUID`（不要太简单即可~）

---

## 🛠️ 手动部署步骤（推荐新手）

### 第一步：创建 D1 数据库

1. 进入 Cloudflare 控制台 → **Workers & Pages** → 左侧菜单点击 **D1 SQL Database**
2. 点击 **Create a database**，命名为 `text-disk-db`（名称可自定义）
3. 创建成功后，记录生成的 **Database ID**（后续绑定需要）

> 💡 数据库表结构会在 Worker 首次运行时自动创建（`CREATE TABLE IF NOT EXISTS`），无需手动执行 SQL。

### 第二步：创建 Worker

1. 进入 **Workers & Pages** → 点击 **Create Application** → **Create Worker**
2. 命名为 `text-disk`（或你喜欢的名称）→ 点击 **Deploy**
3. 进入 Worker 详情页 → 点击顶部 **Edit code**（或 **Quick Edit**）

### 第三步：上传代码

1. 删除编辑器中的默认代码
2. 粘贴本项目的完整 `index.js` 代码
3. 点击顶部 **Save and Deploy**

### 第四步：配置环境变量与绑定

1. 返回 Worker 详情页 → 点击 **Settings** → **Variables**

2. **Environment Variables** 区域点击 **Add variable**：

   | 变量名       | 值                      | 加密   |
   | ------------ | ----------------------- | ------ |
   | `ADMIN_UUID` | 你的管理员密钥          | ✅ 勾选 |
   | `FILENAME`   | `CF-Text-Cloud`（可选） | ❌      |

3. 向下滚动至 **Bindings** 区域，点击 **Add binding**：

   | 变量名     | 值            | 选择值                                           |
   | ---------- | --------------- | ------------------------------------------------ |
   | `DB`       | text-disk-db | 选择第一步创建的数据库                           |
   | `KV` | SHARE_KV    | 选择或新建一个 KV 命名空间（强烈建议绑定以加速） |

4. 点击 **Save** 保存配置

### 第五步：访问与初始化

- 管理员后台：默认`https://<你的worker名称>.<你的域名或workers.dev>/admin` ~看清楚后面有带/admin 👀
- 推荐用自己的绑定在域名，懂得都懂~ https://<你的域名>/admin
- 首次访问 `/admin` 会显示登录框，输入环境变量中设置的 `ADMIN_UUID` 即可进入
- 进入后点击左侧新建文件，开始使用！

---

## 💻 命令行部署（Wrangler CLI）

适合熟悉终端的用户，支持版本控制与 CI/CD。

```bash
# 1. 安装 Wrangler
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 初始化项目
mkdir cf-text-disk && cd cf-text-disk
wrangler init --no-deploy

# 4. 配置 wrangler.toml
cat > wrangler.toml << 'EOF'
name = "text-disk"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "text-disk-db"
database_id = "你的D1数据库ID"

[[kv_namespaces]]
binding = "SHARE_KV"
id = "你的KV命名空间ID"

[vars]
ADMIN_UUID = "你的管理员UUID"
FILENAME = "CF-Text-Cloud"
EOF

# 5. 部署
wrangler deploy
```

---

### 📄 许可证

本项目采用 GPLv3 License 开源协议。您可以自由使用、修改和分发，但请保留原作者声明。

### 💡 支持与反馈

💬 TG：[好软推荐](https://t.me/yt_hytj)
🎬 YT：[好软推荐](https://www.youtube.com/@%E5%A5%BD%E8%BD%AF%E6%8E%A8%E8%8D%90)

⭐ 如果这个项目对你有帮助，欢迎 Star 支持开发！
