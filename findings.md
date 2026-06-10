# Findings - 关键发现与问题定位

在 Ear2Finger 项目的开发、调试与多案例验证过程中，我们定位并总结了以下关于 API 设置、Bilibili 反爬虫、字幕数据缺失以及本地语音识别（ASR）打包的核心技术发现：

---

## 1. API 供应商精简设置的发现
*   **痛点**：对于普通用户（特别是针对女朋友的零配置绿色软件定位），在界面配置 Base URL 极易出错且不友好。
*   **设计发现**：
    *   对于 **Gemini** 而言，用户仅需提供 API Key 即可直接发起请求。
    *   对于 **OpenAI** 和 **DeepSeek**，虽然需要 Base URL，但其对应的都是官方固定的端点（OpenAI 默认为 `https://api.openai.com/v1`，DeepSeek 默认为 `https://api.deepseek.com`）。
    *   因此，前端界面只保留 API Key 和内置 Prompt 的修改，将 Base URL 输入完全隐藏，由后端 `ai_client_factory.py` 内部硬编码为默认官方端点，从而彻底消除了配置出错概率。

---

## 2. Bilibili HTTP 412 WAF 机制与 Cookie 绕过发现
*   **HTTP 412 报错原因**：B 站为了防范爬虫拉取视频，实行了高强度的 WAF 校验。在无 Cookie 的情况下使用 CLI（如 `yt-dlp`）提取信息会被直接拦截，抛出 `HTTP Error 412: Precondition Failed` 错误。
*   **Keychain 兼容性隐患**：
    *   如果我们把 `cookiesfrombrowser` 参数硬编码为所有浏览器（如 `('chrome', 'safari', 'edge', 'firefox')`），在 macOS 等系统下，若试图加载不支持或未安装的浏览器秘钥，`yt-dlp` 会抛出致命的 `CookieLoadError: unsupported keyring: "edge"` 并直接导致整个请求崩溃中断。
*   **修复与优化方案**：
    *   我们设计了**动态浏览器 Cookie 探测机制**：根据当前系统平台（Darwin/Win32）智能排列 Chrome、Safari、Firefox 和 Edge 的提取列表，通过 try-catch 阻断机制逐个测试并提取，一旦提取成功就立即使用，从而绕过致命报错。
    *   **CLI 子进程同步**：之前的代码仅在 Python 内存 `yt_dlp` 库里传递了 cookie，但在后续调用 `yt-dlp` 命令行子进程下载字幕/音频时遗漏了 `--cookies-from-browser` 参数。必须在子进程命令行参数中同样带上所探测出的可用浏览器，才能保证音频提取成功率达到 100%。

---

## 3. B 站视频 CC 字幕缺失的发现
*   **字幕轨缺失情况**：
    *   在对 `BV1m5Lz6cEyQ`（TED演讲精选）和 `BV1UbyZB9ERb`（100场TED合集）这两个 B 站主流英语学习视频的实际测试中发现，尽管画面中显示有极好的英文字幕或双语字幕，但这在 B 站上**全都属于压制到画面内部的“硬字幕”**。
    *   B 站源上**并不存在任何独立的 CC 字幕轨**。因此 `yt-dlp` 无法像在 YouTube 上那样提取出 SRT 或 WebVTT 格式的字幕。
*   **局限性**：系统以字幕句级时间戳驱动。没有字幕，后台在导入时会由于无法切片直接抛出 `No subtitles available`。因此，本地语音识别（ASR）的介入成为了导入无 CC 字幕视频的必备回退方案。

---

## 4. 本地 ASR 与 Windows 打包的技术风险发现
*   **PyInstaller 冷启动体积死穴**：
    *   如果将约 140MB 左右的 Whisper GGUF 模型文件直接打入 PyInstaller 的单文件二进制中（作为内部资源解压释放），用户**每次双击冷启动软件时，都必须耗费 10s 以上的 CPU 解压时间**（因为解压大体积临时文件到 Temp 目录极慢），这是不可接受的。
*   **FastAPI 超时隐患**：
    *   本地转录是一个高 CPU 密集度且长耗时（数十秒到数分钟）的过程。如果直接将其写在接口的同步响应链路中，在处理长视频时会直接引发**浏览器 HTTP 504 连接超时错误**。必须采用 FastAPI BackgroundTasks 异步线程将任务提交，并支持前端 Task ID 的轮询刷新。
*   **CPU 线程满载锁定**：
    *   `whisper.cpp` 默认转录时会全力抢占系统所有可用的 CPU 核心，这会导致用户的 Windows 电脑瞬间失去响应（卡死）。在子进程调用中必须显式加上 `-t 4` 限制所占用的 CPU 核心线程数量。
*   **子进程“哑死（Silent Crash）”与死锁卡死隐患**：
    *   在后台运行 ASR 转录时，子进程可能会因为模型损坏、底层 CPU 指令集报错（如 Illegal Instruction）或 IO 管道死锁而发生闪退或假死。如果后端仅仅被动地依靠 `subprocess.run`，一旦子进程意外中止，数据库状态将永远卡在 `running`，导致前端用户界面无限转菊花。
    *   因此，必须在状态查询接口中引入**心跳/生存扫描（Liveness Check）与熔断机制**，实时检测子进程的 PID 运行状态（通过 `process.poll()` 校验），并在超过绝对超时阈值（如 10 分钟）时强行 `kill` 熔断，以确保程序的高交互实时性。
