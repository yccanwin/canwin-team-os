# CanWin Team OS 启动指南

## 启动开发服务器

```bash
npm run dev
```

## 局域网访问

1. 启动后终端会显示局域网地址，如 `Network: http://192.168.x.x:5173`
2. 也可手动查看本机IP：终端运行 `ifconfig | grep inet`
3. 团队其他成员浏览器访问：`http://你的IP:5173`

## 构建生产版本

```bash
npm run build
npm run preview
```

## 技术栈

- React 18 + TypeScript + Vite
- Tailwind CSS + Zustand
- Chart.js + Lucide React

## 数据存储

所有数据存储在浏览器 localStorage，刷新不丢失。首次访问会使用 Mock 数据初始化。
