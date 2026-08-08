# Skill Manager 页面 AI 开发提示词

## 目标

你是一名资深桌面端产品设计师和前端架构师，请开发一个 macOS 风格的 Skill Manager 管理工具页面。

目标：
- 用于管理本地 AI Agent Skill
- 支持 Skill 浏览、搜索、查看详情
- 支持选择安装目标（Cursor / Claude / Codex）
- 展示 Skill 文件结构和 SKILL.md 内容
- 整体风格参考 Linear、Raycast、VS Code 的简洁专业感

不要过度设计：
- 不添加不存在的数据
- 不添加版本、作者、更新时间等信息
- 不添加安装按钮
- 不添加变更记录
- 保持工具型产品风格


# 页面整体布局

## 窗口

创建一个 macOS 桌面应用窗口：

- 宽度约 1440px
- 高度约 900px
- 顶部 macOS 标题栏
- 左上角三个圆点：
  - 红色关闭
  - 黄色最小化
  - 绿色最大化

背景：
- 主背景 #FFFFFF
- 分割线 #E5E7EB
- 圆角 8px


# 三栏布局

页面分为：

1. 左侧导航栏
2. 中间 Skill 列表
3. 右侧 Skill 详情


比例：

左侧：
240px

中间：
340px

右侧：
剩余宽度


---

# 左侧导航栏设计

背景：

深色渐变：
#111827

宽度：
240px


顶部 Logo 区：

包含：

圆角方形 Logo：

尺寸：
40x40

内容：
字母 S

背景：
深灰蓝

下面：

Skill Manager

字体：
16px
font-weight:600

副标题：

本地 Skill 管理工具

字体：
12px


---

导航菜单：

分组：

## 技能库

Skill 库
右侧数字：

90


## 本机

已安装
数字：

8

Cursor
数字：

7

Claude
数字：

0

Codex
数字：

1


## 数据

项目
数字：

2

备份记录
数字：

0


底部：

设置


菜单状态：

选中：

背景：
rgba(255,255,255,0.12)

圆角：

8px


---

# 中间 Skill 列表


顶部：

标题：

Skill 库

副标题：

浏览和管理可用的 Skills


搜索框：

高度：
38px

圆角：
8px

placeholder:

搜索名称或描述


下面：

过滤 Tab：

全部
未安装
已安装
自定义


当前选中：

全部

蓝色数字 badge：

90


---

# Skill 卡片


每个 Skill 使用列表卡片。

高度：

80px


结构：

第一行：

Skill 名称

右侧状态：

未安装


第二行：

简介文本


例如：

auto-code

自主编码全链路流程包。


状态：

灰色文字


hover：

背景：
#F8FAFC


选中：

边框：

#2563EB

浅蓝背景


不要显示：
- 收藏按钮
- 使用次数
- 评分


---

# 右侧详情区域


顶部：

Skill 名称：

auto-code

字体：

28px

font-weight:700


下面：

Skill 描述：

多行文本。


显示：

来源路径

例如：

/Users/xuzhi/dd/dmc-predict-transfer/plan-skills/auto-code


路径右侧：

复制 icon


---

# 安装目标区域


这是重点。

不要做大卡片。

使用紧凑横向布局。


标题：

安装目标


说明：

选择要安装此 Skill 的工具目录


三个横向选项：


Cursor

Claude

Codex


每个：

高度：

56px


宽度：

200px


包含：

checkbox

应用 icon

名称

状态


例如：

蓝色 C icon

Cursor

未安装


排列：

Cursor | Claude | Codex


不要：

安装按钮

版本信息

额外说明


---

# 文件区域


下面分两栏：

左：

目录结构


右：

SKILL.md 内容


整体：

border:

#E5E7EB


---

## 左侧目录树


标题：

目录结构


树形：

auto-code/

    .gitkeep

    agents/

        autonomous-engineer.md

        custom-explore.md

        custom-plan.md

        database-reviewer.md

    rules/

    scripts/


样式：

类似 VS Code explorer


---

## 右侧 Markdown 查看器


顶部：

SKILL.md


下面显示 markdown 渲染结果。


内容：

name: auto-code

description:

正文内容。


字体：

正文：
14px

标题：
20px


---

# 颜色规范

主色：

#2563EB


文字：

一级：
#111827

二级：
#475569

辅助：
#94A3B8


边框：

#E2E8F0


---

# 交互要求

实现：

1. 点击 Skill 列表切换详情

2. 搜索实时过滤

3. Tab 切换状态

4. 点击安装目标 checkbox

5. 文件树展开收起


---

# 技术要求

推荐：

React + TypeScript

UI:

Tailwind CSS

组件：

- Sidebar
- SkillList
- SkillCard
- SkillDetail
- TargetSelector
- FileTree
- MarkdownViewer


代码要求：

- 组件拆分
- 类型定义完整
- 数据 mock 分离
- 不写死 UI
- 支持后续接真实 Skill 文件系统


# 最终效果

设计目标：

像一个专业开发者工具。

类似：

VS Code
Raycast
Linear

而不是：

后台管理系统

不要：
- 大量卡片
- 数据面板
- 商业 SaaS 风格
- 多余信息
