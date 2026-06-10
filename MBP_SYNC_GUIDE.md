# MacBook Pro (macOS) 同步与环境指南

为了在您的 MacBook Pro 上无缝继续开发和运行本项目，请遵循以下步骤：

## 1. 代码同步
在 MBP 的终端执行：
```bash
# 克隆您自己的仓库
git clone https://github.com/peter1124/Ear2Finger.git
cd Ear2Finger

# 切换到开发分支
git checkout electron
```

## 2. 环境搭建
由于 Python 虚拟环境和二进制文件没有进 Git，您需要运行以下脚本一键初始化：

```bash
# 1. 自动下载对应系统的 ffmpeg/ffprobe 到 bin/ 目录
./scripts/setup-binaries.sh

# 2. 创建 Python 虚拟环境并安装所有后端依赖，同时构建前端
./scripts/install-desktop-backend-env.sh --with-frontend
```

## 3. 本地运行 (Development)
环境搭建完成后，在 MBP 上启动测试：
```bash
# 激活环境
source ~/.local/share/ear2finger/venv/bin/activate

# 启动后端
cd backend
uvicorn main:app --host 127.0.0.1 --port 18712
```

## 4. 后续开发工作流
*   **拉取更新**：`git pull origin electron`
*   **同步原作者更新**（如有）：`git fetch upstream && git merge upstream/electron`
*   **提交改动**：`git add .` -> `git commit -m "..." ` -> `git push origin electron`

---
*注：`bin/` 目录已被加入 `.gitignore`，因此无论在 Mac 还是 Windows 上，首次部署请务必运行 `./scripts/setup-binaries.sh`。*
