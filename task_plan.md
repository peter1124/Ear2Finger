# Task Plan - 后续任务计划与实施细节

本文件作为一份独立、清晰的开发实施指导文档，为后续的 Agent 或开发者提供了具体的代码改造细节与接口规范：

---

## 任务一：播放器“打开原视频”菜单自适应与安全唤起

### 1. 前端课件菜单动态化判定
*   **修改文件**：`frontend/src/components/` 下的课件下拉菜单组件。
*   **核心逻辑**：
    *   增加一个工具判定函数，分析 `youtube_url` 归属：
        *   `url.startsWith('local://')` $\rightarrow$ `'local'` (本地文件)
        *   `url.includes('bilibili.com') || url.includes('b23.tv')` $\rightarrow$ `'bilibili'` (B站视频)
        *   `url.includes('youtube.com') || url.includes('youtu.be')` $\rightarrow$ `'youtube'` (YouTube 视频)
        *   默认 $\rightarrow$ `'default'`
    *   根据模式渲染对应的菜单项文案：
        *   `local`: `Open local file`
        *   `bilibili`: `Open original Bilibili video`
        *   `youtube`: `Open original YouTube video`
        *   `default`: `Open original video`
    *   点击事件绑定：
        *   如果为 `local`：发送 `POST /api/local/open` 请求，Payload 为 `{"video_id": video.id}`。
        *   如果为其他模式：直接执行 `window.open(url, '_blank')`。

### 2. 后端安全唤起接口实现
*   **修改文件**：`backend/routers/user_config.py` 或新建专门的路由模块。
*   **功能接口**：`POST /api/local/open`
    *   **安全要求 ⚠️**：接收参数必须**只能是 `video_id`**，绝对不能允许前端传盘符或文件路径。
    *   **执行逻辑**：
        1. 在数据库中查询对应 `video_id` 的记录。
        2. 读取该视频记录的 `original_local_path` 字段。
        3. 验证本地文件是否存在：如果 `not os.path.exists(path)`，则返回 `HTTP 404 {"error": "本地原始文件已失效或已被移动"}`。
        4. 安全地唤起系统关联播放器：
            *   Windows：`os.startfile(path)`
            *   macOS：`subprocess.run(['open', path])`
            *   Linux：`subprocess.run(['xdg-open', path])`

---

## 任务二：本地 Whisper ASR 二进制打包与回退机制

### 1. PyInstaller 外部资源与打包优化
*   **修改文件**：`Run_Ear2Finger.spec` 或 `backend.spec` (PyInstaller 配置文件)
*   **资源归属规划**：
    *   把编译好的 Windows 版 `whisper.exe` 放入项目的 `bin/` 目录下（同级有 `ffmpeg.exe`），将 `bin/` 目录通过 `datas` 打包进单文件 `exe`。
    *   将 140MB 的 ASR 模型文件 `base.en.gguf` 作为**外部静态资产**分发。打包脚本不将其硬打包进 exe 内部，而是作为软件发行包在同级目录下的 `storage/models/` 进行配送，或者在运行时首次使用时进行在线下载。

### 2. 编写本地 ASR 处理器 (`backend/services/local_asr.py`)
*   **创建文件**：在 `services/` 目录下新建 `local_asr.py`。
*   **核心实现逻辑**：
    1.  **音频预处理**：使用 `ffmpeg` 将目标音频（如已下载的 MP3）转换为 `whisper` 独家支持的 `16kHz, mono, s16le PCM WAV`。
        ```bash
        ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le -y temp.wav
        ```
    2.  **静默执行**：调用 `bin/whisper` 进行转录：
        ```bash
        # 限制 -t 4 以保证 CPU 占用率合理，不造成 Windows 电脑卡死
        whisper.exe -m storage/models/base.en.gguf -f temp.wav -osrt -of temp_output -t 4
        ```
        在 Windows 环境下，调用 `subprocess.run` 时必须加入 `creationflags=subprocess.CREATE_NO_WINDOW` 防止黑框闪烁。
    3.  **获取结果与清理**：读取生成的 `temp_output.srt` 文件内容后，删除 `temp.wav` 和 `temp_output.srt`，释放磁盘空间。

### 3. 后台非阻塞异步任务（进程生命周期监控与心跳防死锁）
*   **接口超时优化**：
    *   在主导入接口 `POST /api/youtube/process` 中，如果通过 `yt-dlp` 获取不到 CC 字幕（对 B 站常见），自动进入 ASR 处理。
    *   因为本地 ASR 转录耗时长，**不能同步等待**。将转录任务提交至 FastAPI `BackgroundTasks` 或子线程中异步运行，并在启动子进程时，将其 `subprocess.Popen` 句柄以 `task_id` 为键存入全局的内存字典（如 `active_asr_processes = {}`）。立即向前端返回 `202 Accepted` 并包含该 `task_id`。
*   **心跳监控与假死熔断（Watchdog）**：
    *   在状态查询接口 `GET /api/tasks/{task_id}/status` 中，实现主动扫描机制：
        1. **闪退主动判定**：如果数据库中该任务状态为 `running`，从内存字典中取出 `Popen` 句柄并调用 `process.poll()`。若返回了非 None 的退出码且数据库任务仍为 `running`，表明 ASR 子进程发生异常闪退。后端立即将数据库状态变更为 `failed`（原因：“ASR进程意外中止”），从而防止前端因不知道进程已死而无限转菊花。
        2. **绝对超时与死锁熔断**：如果任务的 `start_time` 距离当前时间已超过最大转录阈值（例如：绝对阈值 10 分钟），则判定为进程发生假死或死锁。后端执行 `process.kill()` 强行干掉假死进程，并将数据库任务变更为 `failed`（原因：“转录执行超时假死，已触发熔断保护”）。
        3. **资源清理**：一旦转录结束或熔断，从 `active_asr_processes` 字典中弹回并释放该句柄，防止内存泄露。
        4. **自杀锁联动（Suicide Lock Protection）**：在 `/api/health` 健康检查接口中，返回字段 `"has_active_asr_task": len(active_asr_processes) > 0`。启动器 `Run_Ear2Finger.py` 判定自杀时，若该字段为 True，自动挂起退出判定，确保后台转录不中断。
    *   前端使用 Task ID 轮询查询转录状态（如 `GET /api/tasks/{task_id}/status`），直到转录完成（或失败报错）后，前端展示相应成功切片或错误提示。

### 4. 启动器端口自适应与单例重定向
*   **修改文件**：`Run_Ear2Finger.py` (启动器主入口)
*   **修改逻辑**：
    1.  **单例唤醒**：在启动 Popen 之前，发送 HTTP 请求到 `127.0.0.1:18712/api/health`。如果能够成功响应，说明已有本软件实例在运行。直接调用 `webbrowser.open` 打开当前服务页面，随后启动器脚本直接 `sys.exit(0)` 秒退，彻底防止后台进程重复堆积。
    2.  **端口冲突自动递增**：如果 `18712` 端口被非本程序的服务所占用，启动器进入一个循环：在 `18712` 至 `18722` 范围内递增寻找可用端口（使用 `socket.bind` 进行空闲测试）。
    3.  **动态绑定**：找到空闲端口后，更新 `PORT` 参数，并通过环境变量 `E2F_PORT` 传递给后端 Popen 子进程。后端 FastAPI 在 `main.py` 启动时自适应监听在这个新端口上，实现 100% 成功启动。
